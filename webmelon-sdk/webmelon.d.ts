// This file is manually updated with TypeScript bindings for most public facing functions in webmelon.js

type DsInputButtonType = (
  'A'|'B'|'SELECT'|'START'|'DPAD_RIGHT'|'DPAD_LEFT'|'DPAD_UP'|'DPAD_DOWN'|'R'|'L'|'X'|'Y'
);

interface WebMelonFirmwareLanguage {
  name: string;
  id: number;
};

interface WebMelonConstants {
  DEFAULT_KEYBOARD_BINDINGS: {[key: string]: number};
  DEFAULT_GAMEPAD_BINDINGS: {[key: string]: number[]};
  DS_BUTTON_NAME_MAP: {[key: DsInputButtonType]: string};
  DS_INPUT_MAP: {[key: DsInputButtonType]: number};
  DS_OUTPUT_AUDIO_SAMPLE_RATE: number;
  DS_SCREEN_WIDTH: number;
  DS_SCREEN_HEIGHT: number;
  DS_SCREEN_SIZE: number;
  FIRMWARE_LANGUAGES: WebMelonFirmwareLanguage[];
};

interface WebMelonRecvPacketResponse {
  data: UInt8Array;
  timestamp: number;
};

interface WebMelonRecvReplyPacketResponse {
  data: UInt8Array;
  timestamp: number;
  aid: number;
};

interface WebMelonMPController {
  initialize: () => void;
  end: () => void;
  sendPacket: (data: UInt8Array, timestamp: number) => void;
  recvPacket: () => WebMelonRecvPacketResponse?;
  sendCmd: (data: UInt8Array, timestamp: number) => void;
  sendReply:(data: UInt8Array, timestamp: number, aid: number) => void;
  sendAck: (data: Uint8Array, timestamp: number) => void;
  recvHostPacket: () => WebMelonRecvPacketResponse?;
  recvReplies: (timestamp: number, aidmask: number) => WebMelonRecvReplyPacketResponse[];
};

interface WebMelonCart {
  createCart: () => void;
  loadFileIntoCart: (filename: string) => boolean;
  getUnloadedCartName: () => string;
  getUnloadedCartCode: () => string;
};

interface WebMelonStorage {
  createDirectory: (path: string) => void;
  mountIndexedDB: (path: string) => void;
  onPrepare: (callback: () => any) => void;
  onSaveInitiate: (callback: () => any) => void;
  onSaveComplete: (callback: () => any) => void;
  prepareVirtualFilesystem: () => void;
  sync: () => void;
  write: (path: string, data: Uint8Array) => void;
};

interface WebMelonEmulator {
  hasEmulator: () => boolean;
  createEmulator: () => void;
  loadFreeBIOS: () => void;
  loadUserBIOS: () => void;
  loadCart: () => void;
  startEmulation: (topScreenElementId: string, bottomScreenElementId: string) => void;
  setSavePath: (pathname: string) => void;
  getGameTitle: () => string|null;
  addShutdownListener: (callback: () => void) => void;
  shutdown: () => void;
  pause: () => void;
  resume: () => void;
  setEmulatorSpeed: (multiplier: number) => void;
};

interface WebMelonFirmwareSettings {
  nickname: string;
  birthdayMonth: number;
  birthdayDay: number;
  language: number;
  shouldFirmwareBoot: boolean;
};

interface WebMelonFirmwareBiosFileResponse {
  hasBios7: boolean;
  hasBios9: boolean;
  hasFirmware: boolean; 
}

interface WebMelonFirmware {
  getFirmwareSettings: () => WebMelonFirmwareSettings;
  setFirmwareSettings: (settings: WebMelonFirmwareSettings) => WebMelonFirmwareSettings;
  uploadBiosFile: (filename: string, biosData: UInt8Array) => void;
  getActiveBiosFiles: () => WebMelonFirmwareBiosFileResponse;
  canFirmwareBoot: () => boolean;
};

interface WebMelonInputSettings {
  rumbleEnabled: boolean;
  keybinds: {[key: string]: number};
  alternateKeybinds: string[];
  gamepadAxisSensitivity: number;
  gamepadBinds: {[key: string]: number[]};
  gamepadRumbleIntensity: number;
};

interface WebMelonInput {
  getInputSettings: () => WebMelonInputSettings;
  setInputSettings: (settings: WebMelonInputSettings) => void;
  setRumbleEnabled: (enabled: boolean) => void;
};

interface WebMelonMultiplayer {
  setInterface: (interface: WebMelonMPController) => void;
  removeInterface: () => void;
};

interface WebMelonInterface {
  cart: WebMelonCart;
  constants: WebMelonConstants;
  storage: WebMelonStorage;
  emulator: WebMelonEmulator;
  firmware: WebMelonFirmware;
  input: WebMelonInput;
  multiplayer: WebMelonMultiplayer;
};

interface Window {
  WebMelon: WebMelonInterface;
}
