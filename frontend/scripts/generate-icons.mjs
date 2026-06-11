// Generates the PWA icon set into public/icons without any image dependencies.
// Run with: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');

// --- Minimal PNG encoder (RGBA, 8-bit) ---

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

const encodePng = (width, height, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // Prefix each scanline with filter byte 0 (none)
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
};

// --- Icon rendering ---
// Shapes are defined in a 512x512 design space and rendered with 4x supersampling.

const THEME_TEAL = [0x65, 0xc3, 0xc8, 255];   // daisyUI cupcake primary
const SCREEN_OFFWHITE = [0xfa, 0xf7, 0xf5, 255];

const inRoundedRect = (u, v, { x, y, w, h, r }) => {
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const dx = Math.max(x + r - u, u - (x + w - r), 0);
  const dy = Math.max(y + r - v, v - (y + h - r), 0);
  return dx * dx + dy * dy <= r * r;
};

const renderIcon = (size, { fullBleed }) => {
  // Full-bleed icons (maskable/apple-touch) fill the square and shrink the
  // artwork into the central safe zone; "any" icons get rounded corners.
  const shapes = [
    { x: 0, y: 0, w: 512, h: 512, r: fullBleed ? 0 : 116, color: THEME_TEAL }
  ];
  const k = fullBleed ? 0.8 : 1;
  const scaled = (x, y, w, h) => ({
    x: 256 + (x - 256) * k,
    y: 256 + (y - 256) * k,
    w: w * k,
    h: h * k,
    r: 20 * k,
    color: SCREEN_OFFWHITE
  });
  shapes.push(scaled(144, 80, 224, 168));   // top screen
  shapes.push(scaled(144, 264, 224, 168));  // bottom screen

  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((px + (sx + 0.5) / SS) * 512) / size;
          const v = ((py + (sy + 0.5) / SS) * 512) / size;
          let color = null;
          for (const shape of shapes) {
            if (inRoundedRect(u, v, shape)) color = shape.color;
          }
          if (color) {
            r += color[0]; g += color[1]; b += color[2]; a += color[3];
          }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, rgba);
};

mkdirSync(outDir, { recursive: true });

const icons = [
  ['icon-192.png', 192, { fullBleed: false }],
  ['icon-512.png', 512, { fullBleed: false }],
  ['icon-maskable-512.png', 512, { fullBleed: true }],
  ['apple-touch-icon.png', 180, { fullBleed: true }]
];

for (const [name, size, opts] of icons) {
  writeFileSync(join(outDir, name), renderIcon(size, opts));
  console.log(`wrote icons/${name}`);
}
