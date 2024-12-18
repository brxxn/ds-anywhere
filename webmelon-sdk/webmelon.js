// This is all one JS file. The goal is that it should not be too complex and leave a lot of the logic
// on what to do up to the implementer rather than the SDK. We also should keep TypeScript bindings in
// webmelon.d.ts that correspond to this.

(() => {
  // Utility functions used throughout the SDK not exported outside of it.

  /**
   * Call all subscribers in the array when an event is fired.
   * 
   * @param {Function[]} subscribers All subscribed functions to the event
   * @param {any} callArgs any other arguments you would like to call each subscriber with
   */
  const callAllSubscribers = async (subscribers, ...callArgs) => {
    // We want to execute all events asynchronously, so we will convert each function callback
    // to a promise that allows them to each execute async
    subscribers.map(subscriber => new Promise(() => subscriber(...callArgs)));
  };

  const getRelativeCoords = (touchScreen, clientX, clientY) => {
    const rect = touchScreen.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
  
    const scaleX = rect.width / 256;
    const scaleY = rect.height / 192;
  
    let scaledMouseX = mouseX / scaleX;
    let scaledMouseY = mouseY / scaleY;
  
    const isWide = rect.width / rect.height > 256 / 192;
    const extraPixels = isWide 
      ? (rect.width / 256 - rect.height / 192) * 256 
      : (rect.height / 192 - rect.width / 256) * 192;
  
    if (isWide) {
      scaledMouseX = (mouseX - extraPixels / 2) / (rect.width - extraPixels) * 256;
    } else {
      scaledMouseY = (mouseY - extraPixels / 2) / (rect.height - extraPixels) * 192;
    }
  
    return {
      x: (scaledMouseX > 0 && scaledMouseX <= 256) ? scaledMouseX : 0,
      y: (scaledMouseY > 0 && scaledMouseY <= 192) ? scaledMouseY : 0
    };
  };

  let emulatorFrameRunning = false;
  const DsButtonInput = {
    A: (1 << 0),
    B: (1 << 1),
    SELECT: (1 << 2),
    START: (1 << 3),
    DPAD_RIGHT: (1 << 4),
    DPAD_LEFT: (1 << 5),
    DPAD_UP: (1 << 6),
    DPAD_DOWN: (1 << 7),
    R: (1 << 8),
    L: (1 << 9),
    X: (1 << 10),
    Y: (1 << 11)
  };

  const DefaultKeyboardBindings = {
    w: DsButtonInput.DPAD_UP,
    a: DsButtonInput.DPAD_LEFT,
    s: DsButtonInput.DPAD_DOWN,
    d: DsButtonInput.DPAD_RIGHT,
    q: DsButtonInput.L,
    o: DsButtonInput.R,
    i: DsButtonInput.X,
    l: DsButtonInput.A,
    k: DsButtonInput.B,
    j: DsButtonInput.Y,
    v: DsButtonInput.SELECT,
    b: DsButtonInput.START
  };

  const DefaultGamepadBindings = {
    A: [1],
    B: [0],
    SELECT: [8],
    START: [9],
    DPAD_RIGHT: [15],
    DPAD_LEFT: [14],
    DPAD_UP: [12],
    DPAD_DOWN: [13],
    R: [5, 7],
    L: [4, 6],
    X: [3],
    Y: [2]
  };

  const DefaultSubscribers = {
    wasmLoad: [],
    emuFrameUpdate: [],
    emuShutdown: [],
    saveComplete: [],
    saveInitiate: [],
    vfsInitialized: []
  };

  // This class is used as the initial "offline" multiplayer inteface that just returns nothing
  class OfflineMPInterface {
    constructor() {}
    initialize() {
      console.log('Offline MP initialize called');
    }
    end() {
      console.log('Offline MP end called');
    }
    sendPacket(data, timestamp) {
      console.debug([data, timestamp]);
    }
    recvPacket() {
      return undefined;
    }
    sendCmd(data, timestamp) {
      console.debug([data, timestamp]);
    }
    sendReply(data, timestamp, aid) {
      console.debug([data, timestamp, aid]);
    }
    sendAck(data, timestamp) {
      console.debug([data, timestamp]);
    }
    recvHostPacket() {
      return undefined;
    }
    recvReplies() {
      return [];
    }
  };
  const defaultMpInterface = new OfflineMPInterface();

  let WebMelon = {
    // Things in here should only be used by the SDK itself. This does not need to (and should not be)
    // included in TypeScript bindings. The reason we do not keep it as a local variable here in the
    // function is so that we can inspect it easily through the DevTools JS console.
    _internal: {
      emulator: null,
      emulatorNdsCart: null,
      emulatorAudioCtx: new AudioContext({
        latencyHint: 'interactive',
        sampleRate: 32823
      }),
      emulatorAudioQueue: {
        left: new Int16Array(8192),
        right: new Int16Array(8192),
        fifo: {
          len: 0,
          head: 0,
          cap: 8192
        }
      },
      emulatorElements: {
        topScreen: null,
        bottomScreen: null
      },
      emulatorScreenTouching: false,
      emulatorButtonInput: 0,
      emulatorFirmwareSettings: null,
      emulatorFrameInterval: null,
      emulatorFrameSpeed: 1000 / 60,
      emulatorRumble: false,
      emulatorUsingGamepad: false,
      events: {
        onEmulatorFrameUpdate: () => {
          // We call the frame updater directly since we want it to execute synchronously rather than async
          WebMelon.emulator._eventListeners.frameUpdate();
          callAllSubscribers(WebMelon._internal.subscribers.emuFrameUpdate);
        },
        onWasmLoad: () => {
          callAllSubscribers(WebMelon._internal.subscribers.wasmLoad);
        },
        onRumbleStart: () => {
          WebMelon._internal.emulatorRumble = true;
        },
        onRumbleStop: () => {
          WebMelon._internal.emulatorRumble = false;
        },
        onShutdown: () => {
          const shutdownListeners = WebMelon._internal.subscribers.emuShutdown;
          // Reset all listeners to avoid running callbacks that shouldn't be called anymore
          WebMelon._internal.subscribers = DefaultSubscribers;
          // Call old shutdown listeners
          callAllSubscribers(shutdownListeners);
          // Stop emulator interval and reset state
          if (WebMelon._internal.emulatorFrameInterval) {
            clearInterval(WebMelon._internal.emulatorFrameInterval);
          }
          WebMelon._internal.emulatorAudioCtx.close();
          WebMelon._internal.emulatorAudioCtx = new AudioContext({
            latencyHint: 'interactive',
            sampleRate: 32823
          });
          WebMelon._internal.emulatorFrameSpeed = 1000 / 60;
          WebMelon._internal.emulatorFrameInterval = 1000 / 60;
          WebMelon._internal.emulatorAudioQueue.left = new Int16Array(8192);
          WebMelon._internal.emulatorAudioQueue.right = new Int16Array(8192);
          WebMelon._internal.emulator = null;
        },
        onSaveWrite: () => {
          if (WebMelon._internal.storage.isSaving) {
            // Don't sync if we are already in the process of saving
            return;
          }
          callAllSubscribers(WebMelon._internal.subscribers.saveInitiate);
          // The core emulator writes saves in a buffered manner, so we need to wait until it completes
          // the buffered save writes and then save.
          WebMelon._internal.storage.isSaving = true;
          setTimeout(WebMelon.storage.sync, 500);
        }
      },
      firmwareSettings: {
        nickname: "Player",
        language: 1,
        birthdayMonth: 1,
        birthdayDay: 1,
        shouldFirmwareBoot: false
      },
      inputSettings: {
        rumbleEnabled: true,
        keybinds: DefaultKeyboardBindings,
        alternateKeybinds: [],
        gamepadAxisSensitivity: 0.5,
        gamepadBinds: DefaultGamepadBindings,
        gamepadRumbleIntensity: 0.5
      },
      mpInterface: defaultMpInterface,
      subscribers: DefaultSubscribers,
      storage: {
        initialized: false,
        isSaving: false
      },
      wasmLoaded: false
    },
    // Includes constants that can be used by both the SDK and implementer.
    constants: {
      DS_INPUT_MAP: DsButtonInput,
      DS_BUTTON_NAME_MAP: {
        A: 'A',
        B: 'B',
        SELECT: 'Select',
        START: 'Start',
        DPAD_RIGHT: 'D-Pad Right',
        DPAD_LEFT: 'D-Pad Left',
        DPAD_UP: 'D-Pad Up',
        DPAD_DOWN: 'D-Pad Down',
        R: 'R',
        L: 'L',
        X: 'X',
        Y: 'Y'
      },
      DEFAULT_KEYBOARD_BINDINGS: DefaultKeyboardBindings,
      DEFAULT_GAMEPAD_BINDINGS: DefaultGamepadBindings,
      DEFAULT_EMULATOR_FRAME_SPEED: 1000 / 60,
      DS_OUTPUT_AUDIO_SAMPLE_RATE: 32823.6328125,
      DS_SCREEN_WIDTH: 256,
      DS_SCREEN_HEIGHT: 192,
      DS_SCREEN_SIZE: 256 * 192,
      FIRMWARE_LANGUAGES: [
        {
          name: "日本語", // Japanese
          id: 0
        },
        {
          name: "English",
          id: 1
        },
        {
          name: "Français", // French
          id: 2
        },
        {
          name: "Deutsch", // German
          id: 3
        },
        {
          name: "Italiano", // Italian
          id: 4
        },
        {
          name: "Español", // Spanish
          id: 5
        },
        {
          name: "中国人 (iQue DS, limited support)", // Chinese
          id: 6
        }
      ]
    },
    audio: {
      getAudioContext: () => {
        if (WebMelon._internal.emulatorAudioCtx.state !== 'running') {
          WebMelon._internal.emulatorAudioCtx.resume();
        }
        return WebMelon._internal.emulatorAudioCtx;
      },
      processAudio: (event) => {
        let leftChannel = event.outputBuffer.getChannelData(0);
        let rightChannel = event.outputBuffer.getChannelData(1);
        let queue = WebMelon._internal.emulatorAudioQueue;

        for (let i = 0; i < leftChannel.length && queue.fifo.len !== 0; ++i) {
          queue.fifo.len--;
          leftChannel[i] = queue.left[queue.fifo.head] / WebMelon.constants.DS_OUTPUT_AUDIO_SAMPLE_RATE;
          rightChannel[i] = queue.right[queue.fifo.head] / WebMelon.constants.DS_OUTPUT_AUDIO_SAMPLE_RATE;
          queue.fifo.head = (queue.fifo.head + 1) % queue.fifo.cap;
        }
      },
      createAudioProcessor: () => {
        // TODO: maybe migrate away from createScriptProcessor since it's deprecated?
        // The alternative is to make an AudioWorklet, but I don't know if having a worker run audio would
        // be great for this program.
        const audioSource = WebMelon._internal.emulatorAudioCtx.createBufferSource();
        const audioProcessor = WebMelon._internal.emulatorAudioCtx.createScriptProcessor(2048, 0, 2);
        audioProcessor.addEventListener('audioprocess', WebMelon.audio.processAudio);
        audioSource.connect(audioProcessor);
        audioProcessor.connect(WebMelon._internal.emulatorAudioCtx.destination);
        audioSource.start();
      }
    },
    assembly: {
      hasWasmSupport: () => {
        return window.WebAssembly !== undefined;
      },
      hasLoaded: () => {
        return WebMelon._internal.wasmLoaded;
      },
      addLoadListener: (callback) => {
        if (WebMelon._internal.wasmLoaded) {
          callback();
          return;
        }
        WebMelon._internal.subscribers.wasmLoad.push(callback);
      }
    },
    cart: {
      createCart: () => {
        if (!WebMelon._internal.wasmLoaded) {
          throw new Error('Cannot call createCart before WASM has loaded!');
        }
        WebMelon._internal.emulatorNdsCart = new Module.WasmNdsCart();
      },
      loadFileIntoCart: (filename) => {
        return WebMelon._internal.emulatorNdsCart.loadFromFile(filename);
      },
      getUnloadedCartName: () => {
        return WebMelon._internal.emulatorNdsCart.getCartName();
      },
      getUnloadedCartCode: () => {
        return WebMelon._internal.emulatorNdsCart.getCartCode();
      }
    },
    storage: {
      createDirectory: (path) => {
        // Check if exists first
        if (FS.analyzePath(path).exists) return;
        FS.mkdir(path);
      },
      mountIndexedDB: (path) => {
        FS.mount(IDBFS, {}, path);
      },
      onPrepare: (callback) => {
        if (WebMelon._internal.storage.initialized) {
          console.warn('Called WebMelon.storage.onInitialize when storage is already initialized.');
          callback();
          return;
        }
        WebMelon._internal.subscribers.vfsInitialized.push(callback);
      },
      onSaveInitiate: (callback) => {
        WebMelon._internal.subscribers.saveInitiate.push(callback);
      },
      onSaveComplete: (callback) => {
        WebMelon._internal.subscribers.saveComplete.push(callback);
      },
      initializeFirmwareDirectory: () => {
        if (FS.analyzePath('/firmware').exists) return;
        FS.mkdir('/firmware');
        WebMelon.storage.mountIndexedDB('/firmware');
        FS.syncfs(true, (err) => {
          if (err) {
            console.error('initialization error', err);
          }
        });
      },
      prepareVirtualFilesystem: () => {
        WebMelon.storage.initializeFirmwareDirectory();
        if (!FS.analyzePath('/savefiles').exists) {
          WebMelon.storage.createDirectory('/savefiles');
          WebMelon.storage.mountIndexedDB('/savefiles');
          FS.syncfs(true, (err) => {
            console.debug('synced fs', err);
            callAllSubscribers(WebMelon._internal.subscribers.vfsInitialized);
          });
        } else {
          callAllSubscribers(WebMelon._internal.subscribers.vfsInitialized);
        }
      },
      sync: () => {
        FS.syncfs(false, (err) => {
          WebMelon._internal.storage.isSaving = false;
          callAllSubscribers(WebMelon._internal.subscribers.saveComplete);
          console.debug('storage sync', err);
        });
      },
      write: (path, data) => {
        FS.writeFile(path, data);
      }
    },
    emulator: {
      _eventListeners: {
        mouseDown: (event) => {
          const touchScreen = document.getElementById(WebMelon._internal.emulatorElements.bottomScreen);
          const { x, y } = getRelativeCoords(touchScreen, event.clientX, event.clientY);
          WebMelon._internal.emulator.touchScreen(x, y);
          WebMelon._internal.emulatorScreenTouching = true;
          event.preventDefault();
        },
        mouseMove: (event) => {
          if (!WebMelon._internal.emulatorScreenTouching) {
            return;
          }
          const touchScreen = document.getElementById(WebMelon._internal.emulatorElements.bottomScreen);
          const { x, y } = getRelativeCoords(touchScreen, event.clientX, event.clientY);
          WebMelon._internal.emulator.touchScreen(x, y);
        },
        mouseUp: (event) => {
          WebMelon._internal.emulatorScreenTouching = false;
          WebMelon._internal.emulator.releaseScreen();
          event.preventDefault();
        },
        touchStart: (event) => {
          const touchScreen = document.getElementById(WebMelon._internal.emulatorElements.bottomScreen);
          const { x, y } = getRelativeCoords(touchScreen, event.touches[0].clientX, event.touches[0].clientY);
          WebMelon._internal.emulator.touchScreen(x, y);
          event.preventDefault();
        },
        touchEnd: (event) => {
          WebMelon._internal.emulator.releaseScreen();
          event.preventDefault();
        },
        keyDown: (event) => {
          // TODO: refer to a user-preferenced keyboard bindings map
          const keybinds = WebMelon._internal.inputSettings.keybinds;
          if (keybinds[event.key] === undefined) {
            return;
          }
          if (WebMelon._internal.emulatorUsingGamepad) {
            WebMelon._internal.emulatorButtonInput = 0;
            WebMelon._internal.emulatorUsingGamepad = false;
          }
          WebMelon._internal.emulatorButtonInput |= keybinds[event.key];
        },
        keyUp: (event) => {
          const keybinds = WebMelon._internal.inputSettings.keybinds;
          if (keybinds[event.key] === undefined) {
            return;
          }
          WebMelon._internal.emulatorButtonInput &= (~(keybinds[event.key]) & 0xfff);
        },
        frameUpdate: () => {
          let emulator = WebMelon._internal.emulator;
          let topCtx = document.getElementById(WebMelon._internal.emulatorElements.topScreen).getContext('2d');
          let bottomCtx = document.getElementById(WebMelon._internal.emulatorElements.bottomScreen).getContext('2d');
          let audioQueue = WebMelon._internal.emulatorAudioQueue;

          try {
            let topScreenPtr = emulator.getTopScreen();
            let bottomScreenPtr = emulator.getBottomScreen();
            let audioBufferPtr = emulator.getAudioBuffer();
            let audioSamples = emulator.getAudioSamples();

            let spuOutputArray = new Int16Array(Module.HEAPU8.buffer, audioBufferPtr, audioSamples * 2);
            let topScreenArray = new Uint8Array(Module.HEAPU8.buffer, topScreenPtr, 256 * 192 * 4);
            let bottomScreenArray = new Uint8Array(Module.HEAPU8.buffer, bottomScreenPtr, 256 * 192 * 4);
            let topDataImage = topCtx.createImageData(256, 192);
            let bottomDataImage = bottomCtx.createImageData(256, 192);

            topDataImage.data.set(topScreenArray);
            bottomDataImage.data.set(bottomScreenArray);
            topCtx.putImageData(topDataImage, 0, 0);
            bottomCtx.putImageData(bottomDataImage, 0, 0);

            if (audioSamples !== 0) {
              for (let i = 0; i < audioSamples; i++) {
                if (audioQueue.fifo.len >= audioQueue.fifo.cap) break;
                let j = (audioQueue.fifo.head + audioQueue.fifo.len) % audioQueue.fifo.cap;
                audioQueue.left[j] = spuOutputArray[i * 2];
                audioQueue.right[j] = spuOutputArray[i * 2 + 1];
                audioQueue.fifo.len++;
              }
            }
            if (WebMelon._internal.emulatorAudioCtx.state !== 'running') {
              WebMelon._internal.emulatorAudioCtx.resume();
            }
          } catch (ex) {
            console.error(ex);
          }
        }
      },
      hasEmulator: () => {
        return WebMelon._internal.emulator !== null;
      },
      getEmulator: () => {
        if (!WebMelon._internal.emulator) {
          throw new Error('Call to WebMelon.emulator.getEmulator() without an active emulator object!');
        }
        return WebMelon._internal.emulator;
      },
      createEmulator: () => {
        if (!WebMelon._internal.wasmLoaded) {
          throw new Error('Cannot call WebMelon.emulator.createEmulator() before WebAssembly compilation');
        }
        if (WebMelon._internal.emulator) {
          console.warn('attempted to make new emulator while emulator already exists.');
          return;
        }

        WebMelon._internal.emulator = new Module.WasmEmulator();
        return WebMelon._internal.emulator;
      },
      /**
       * Loads the emulator into direct boot using FreeBIOS
       */
      loadFreeBIOS: () => {
        WebMelon._internal.firmwareSettings.shouldFirmwareBoot = false;
        WebMelon.firmware.getFirmwareSettings();
        WebMelon._internal.emulator.setFirmwareSettings(WebMelon._internal.emulatorFirmwareSettings);
        WebMelon._internal.emulator.loadFreeBIOS();
      },
      loadUserBIOS: () => {
        WebMelon._internal.firmwareSettings.shouldFirmwareBoot = true;
        WebMelon.firmware.getFirmwareSettings();
        WebMelon._internal.emulator.setFirmwareSettings(WebMelon._internal.emulatorFirmwareSettings);
        WebMelon._internal.emulator.loadUserBIOS();
      },
      /**
       * Loads an NDS ROM cart into the emulator
       */
      loadCart: () => {
        if (!WebMelon._internal.emulatorNdsCart) {
          throw new Error('Cannot call WebMelon.emulator.loadCart() without loading a cart!');
        }
        WebMelon._internal.emulator.loadRom(WebMelon._internal.emulatorNdsCart, false);
      },
      /**
       * Initializes the emulator and starts running the frame loop
       * 
       * @param {string} topScreenCanvasId 
       * @param {string} bottomScreenCanvasId 
       */
      startEmulation: (topScreenCanvasId, bottomScreenCanvasId) => {
        console.log('emulation started!');
        WebMelon._internal.emulatorElements.topScreen = topScreenCanvasId;
        WebMelon._internal.emulatorElements.bottomScreen = bottomScreenCanvasId;
        WebMelon._internal.emulator.initialize(!WebMelon._internal.firmwareSettings.shouldFirmwareBoot);
        const touchScreen = document.getElementById(WebMelon._internal.emulatorElements.bottomScreen);
        touchScreen.addEventListener('mousedown', WebMelon.emulator._eventListeners.mouseDown);
        touchScreen.addEventListener('mousemove', WebMelon.emulator._eventListeners.mouseMove);
        touchScreen.addEventListener('mouseup', WebMelon.emulator._eventListeners.mouseUp);
        touchScreen.addEventListener('touchstart', WebMelon.emulator._eventListeners.touchStart);
        touchScreen.addEventListener('touchend', WebMelon.emulator._eventListeners.touchEnd);
        window.addEventListener('keydown', WebMelon.emulator._eventListeners.keyDown);
        window.addEventListener('keyup', WebMelon.emulator._eventListeners.keyUp);
        WebMelon.audio.createAudioProcessor();
        WebMelon._internal.emulatorFrameInterval = setInterval(
          WebMelon.emulator.runFrame,
          WebMelon._internal.emulatorFrameSpeed
        );
      },
      setSavePath: (pathname) => {
        WebMelon._internal.emulator.setSavePath(pathname);
      },
      getGameTitle: () => {
        if (!WebMelon._internal.emulator) {
          return null;
        }

        return WebMelon._internal.emulator.getCartTitle();
      },
      runFrame: () => {
        if (emulatorFrameRunning) {
          return;
        }
        emulatorFrameRunning = true;
        WebMelon._internal.emulatorRumble = false;
        WebMelon.input.processGamepadInput();
        WebMelon._internal.emulator.setInput(WebMelon._internal.emulatorButtonInput);
        WebMelon._internal.emulator.processFrame(false);
        WebMelon.input.processRumble();
        emulatorFrameRunning = false;
      },
      addShutdownListener: (callback) => {
        WebMelon._internal.subscribers.emuShutdown.push(callback);
      },
      shutdown: () => {
        if (!WebMelon._internal.emulator) return;
        // We will just call the onShutdown() handler and let it handle shutdown stuff for us
        WebMelon._internal.events.onShutdown();
      },
      pause: () => {
        if (!WebMelon._internal.emulator) {
          throw new Error('Cannot pause while emulator does not exist!');
        }
        WebMelon._internal.emulatorAudioCtx.suspend();
        clearInterval(WebMelon._internal.emulatorFrameInterval);
      },
      resume: () => {
        if (!WebMelon._internal.emulator) {
          throw new Error('Cannot resume while emulator does not exist!');
        }
        WebMelon._internal.emulatorAudioCtx.resume();
        WebMelon._internal.emulatorFrameInterval = setInterval(
          WebMelon.emulator.runFrame,
          WebMelon._internal.emulatorFrameSpeed
        );
      },
      setEmulatorSpeed: (multiplier) => {
        clearInterval(WebMelon._internal.emulatorFrameInterval);
        WebMelon._internal.emulatorFrameSpeed = 1000 / (60 * multiplier);
        WebMelon._internal.emulatorFrameInterval = setInterval(
          WebMelon.emulator.runFrame,
          WebMelon._internal.emulatorFrameSpeed
        );
      }
    },
    firmware: {
      getFirmwareSettings: () => {
        const settings = WebMelon._internal.firmwareSettings;

        // Update the internal "emulator firmware settings" object used by the emulator as well.
        WebMelon._internal.emulatorFirmwareSettings = new Module.WasmFirmwareSettings();
        WebMelon._internal.emulatorFirmwareSettings.setNickname(settings.nickname);
        WebMelon._internal.emulatorFirmwareSettings.setBirthday(settings.birthdayMonth, settings.birthdayDay);
        WebMelon._internal.emulatorFirmwareSettings.setLanguage(settings.language);

        if (settings.shouldFirmwareBoot) {
          WebMelon._internal.emulatorFirmwareSettings.setFirmwareFile('/firmware/firmware.bin');
        }

        return settings;
      },
      setFirmwareSettings: (settings) => {
        WebMelon._internal.firmwareSettings = settings;
        // Make a call to getFirmwareSettings to update the firmware settings internally as well
        return WebMelon.firmware.getFirmwareSettings();
      },
      uploadBiosFile: (filename, biosData) => {
        console.log('uploading bios file...')
        console.log(filename)
        console.log(biosData)
        WebMelon.storage.initializeFirmwareDirectory();
        if (filename === 'bios7.bin' && biosData.length === 0x4000) {
          WebMelon.storage.write('/firmware/bios7.bin', biosData);
        } else if (filename === 'bios9.bin' && biosData.length === 0x1000) {
          WebMelon.storage.write('/firmware/bios9.bin', biosData);
        } else if (filename === 'firmware.bin') {
          WebMelon.storage.write('/firmware/firmware.bin', biosData);
        }
      },
      getActiveBiosFiles: () => {
        return {
          hasBios7: FS.analyzePath('/firmware/bios7.bin').exists,
          hasBios9: FS.analyzePath('/firmware/bios9.bin').exists,
          hasFirmware: FS.analyzePath('/firmware/firmware.bin').exists
        };
      },
      canFirmwareBoot: () => {
        WebMelon.storage.initializeFirmwareDirectory();
        const activeBiosFiles = WebMelon.firmware.getActiveBiosFiles();
        return (activeBiosFiles.hasBios7 && activeBiosFiles.hasBios9 && activeBiosFiles.hasFirmware);
      }
    },
    input: {
      getInputSettings: () => {
        return WebMelon._internal.inputSettings;
      },
      setInputSettings: (settings) => {
        WebMelon._internal.inputSettings = settings;
      },
      setRumbleEnabled: (enabled) => {
        WebMelon._internal.inputSettings.rumbleEnabled = enabled;
      },
      processGamepadInput: () => {
        let gamepads = navigator.getGamepads();
        if (gamepads.length === 0) return;
        let gamepad = gamepads[0];
        if (!gamepad) return;

        let axisSensitivity = 1 - WebMelon._internal.inputSettings.gamepadAxisSensitivity;

        let gamepadInput = 0;

        // TODO: potentially customizable axis controls
        if (gamepad.axes[0] > axisSensitivity) {
          gamepadInput |= DsButtonInput.DPAD_RIGHT;
        }

        if (gamepad.axes[0] < (-1) * axisSensitivity) {
          gamepadInput |= DsButtonInput.DPAD_LEFT;
        }

        if (gamepad.axes[1] > axisSensitivity) {
          gamepadInput |= DsButtonInput.DPAD_DOWN;
        }

        if (gamepad.axes[1] < (-1) * axisSensitivity) {
          gamepadInput |= DsButtonInput.DPAD_UP;
        }

        // Process button inputs
        for (let buttonName in DsButtonInput) {
          for (let button of WebMelon._internal.inputSettings.gamepadBinds[buttonName]) {
            if (gamepad.buttons[button] && gamepad.buttons[button].pressed) {
              gamepadInput |= DsButtonInput[buttonName];
            }
          }
        }

        // If gamepad input is detected, we will switch to using gamepad controls. Otherwise,
        // we will continue to use keybinds.
        if (!WebMelon._internal.emulatorUsingGamepad && gamepadInput === 0) {
          return;
        }
        
        WebMelon._internal.emulatorUsingGamepad = true;
        WebMelon._internal.emulatorButtonInput = gamepadInput;
      },
      processRumble: () => {
        if (!WebMelon._internal.inputSettings.rumbleEnabled || !WebMelon._internal.emulatorRumble) return;
        if (WebMelon._internal.emulatorUsingGamepad) {
          let gamepads = navigator.getGamepads();
          if (gamepads.length === 0) return;
          let gamepad = gamepads[0];
          gamepad.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: WebMelon.constants.DEFAULT_EMULATOR_FRAME_SPEED,
            weakMagnitude: WebMelon._internal.inputSettings.gamepadRumbleIntensity,
            strongMagnitude: WebMelon._internal.inputSettings.gamepadRumbleIntensity
          });
        }
      }
    },
    multiplayer: {
      _sendPacket: (dataPtr, length, timestamp) => {
        const data = new Uint8Array(Module.HEAPU8.buffer, dataPtr, length);
        WebMelon._internal.mpInterface.sendPacket(data, timestamp);
      },
      _sendCmd: (dataPtr, length, timestamp) => {
        const data = new Uint8Array(Module.HEAPU8.buffer, dataPtr, length);
        WebMelon._internal.mpInterface.sendCmd(data, timestamp);
      },
      _sendReply: (dataPtr, length, timestamp, aid) => {
        const data = new Uint8Array(Module.HEAPU8.buffer, dataPtr, length);
        WebMelon._internal.mpInterface.sendReply(data, timestamp, aid);
      },
      _sendAck: (dataPtr, length, timestamp) => {
        const data = new Uint8Array(Module.HEAPU8.buffer, dataPtr, length);
        WebMelon._internal.mpInterface.sendAck(data, timestamp);
      },
      _recvPacket: (dataPtr, timestampPtr) => {
        const receivedPacket = WebMelon._internal.mpInterface.recvPacket();
        if (!receivedPacket) return;

      },
      setInterface: (mpInterface) => {
        WebMelon._internal.mpInterface = mpInterface;
      },
      removeInterface: () => {
        WebMelon.multiplayer.setInterface(defaultMpInterface);
      }
    }
  };

  window.WebMelon = WebMelon;

  if (window.onWebMelonLoad) {
    window.onWebMelonLoad();
  }
})();

window.Module = {
  onRuntimeInitialized: () => {
    window.WebMelon._internal.wasmLoaded = true;
    window.WebMelon._internal.events.onWasmLoad();
  }
};