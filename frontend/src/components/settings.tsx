import { useEffect, useRef, useState } from "preact/hooks";
import './settings.css';
import { LuSave, LuUser } from "react-icons/lu";
import { IoGameControllerOutline, IoHardwareChipOutline } from "react-icons/io5";
import { FaRegKeyboard } from "react-icons/fa";
import { FC, ReactNode } from "preact/compat";
import InputSettingsMenu from "./settings-menus/input";
import ControlsSettingsMenu from "./settings-menus/controls";
import PersonalizationSettingsMenu from "./settings-menus/personalization";
import FirmwareSettingsMenu from "./settings-menus/firmware";
import SaveDataSettingsMenu from "./settings-menus/savedata";

interface SettingsModalProps {
  showing: boolean;
  onClose: () => void;
};

interface SettingsMenuItem {
  displayName: string;
  icon: ReactNode;
  component: FC;
}

const settingsMenus: {[key: string]: SettingsMenuItem} = {
  controls: {
    displayName: 'Controls',
    icon: (<FaRegKeyboard />),
    component: ControlsSettingsMenu
  },
  personalization: {
    displayName: 'Personalization',
    icon: (<LuUser />),
    component: PersonalizationSettingsMenu
  },
  input: {
    displayName: 'Controller Input',
    icon: (<IoGameControllerOutline />),
    component: InputSettingsMenu
  },
  firmware: {
    displayName: 'Firmware',
    icon: (<IoHardwareChipOutline />),
    component: FirmwareSettingsMenu
  },
  savedata: {
    displayName: 'Save Data',
    icon: (<LuSave />),
    component: SaveDataSettingsMenu
  }
};

export default function SettingsModal({ showing, onClose }: SettingsModalProps){
  const settingsModalRef = useRef<any>(null);
  const [selectedMenu, setSelectedMenu] = useState('controls');

  const closeSettings = () => {
    window.localStorage.setItem('inputSettings', JSON.stringify(window.WebMelon.input.getInputSettings()));
    window.localStorage.setItem('firmwareSettings', JSON.stringify(window.WebMelon.firmware.getFirmwareSettings()));
    onClose();
  };

  useEffect(() => {
    if (!settingsModalRef.current || !window.WebMelon) {
      return;
    }

    if (!showing) {
      settingsModalRef.current.close();
      return;
    }

    const handleEscapePress = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showing) {
        closeSettings();
      }
    };

    window.addEventListener('keydown', handleEscapePress);
    settingsModalRef.current.showModal();
    return () => {
      window.removeEventListener('keydown', handleEscapePress);
    };
  }, [showing]);

  useEffect(() => {
    if (!window.WebMelon) {
      console.error('WebMelon not loaded');
      return;
    }
    const localStorageInputSettings = window.localStorage.getItem('inputSettings');
    const localStorageFirmwareSettings = window.localStorage.getItem('firmwareSettings');
    if (localStorageInputSettings) {
      const inputSettings = JSON.parse(localStorageInputSettings);
      window.WebMelon.input.setInputSettings(inputSettings);
    }
    if (localStorageFirmwareSettings) {
      const firmwareSettings = JSON.parse(localStorageFirmwareSettings);
      window.WebMelon.firmware.setFirmwareSettings(firmwareSettings);
    }
  }, []);

  const SettingsMenuComponent = settingsMenus[selectedMenu].component;

  return (
    <dialog ref={settingsModalRef} id="settings-modal" className="modal">
      <form method="dialog" className="modal-box w-11/12 max-w-5xl">
        <h3 className="font-bold text-lg">Settings</h3>
        <div className="settings-box-container">
          <ul className="menu bg-base-200 rounded-box settings-menu">
            {Object.keys(settingsMenus).map((key) => (
              <li key={key}>
                <a className={selectedMenu === key ? 'active' : ''} onClick={() => setSelectedMenu(key)}>
                  {settingsMenus[key].icon}{' '}
                  {settingsMenus[key].displayName}
                </a>
              </li>
            ))}
          </ul>
          <div className="settings-item">
            {showing ? (
              <SettingsMenuComponent />
            ) : null}
          </div>
        </div>
        <div className="modal-action">
          <button className="btn" onClick={closeSettings}>Close</button>
        </div>
      </form>
    </dialog>
  )
}