import { LuUpload, LuDownload, LuTrash2 } from 'react-icons/lu';
import './savedata.css';
import { useEffect, useState } from 'preact/hooks';
import { ChangeEvent } from 'preact/compat';

const SAVEFILES_ROOT = '/savefiles';

const formatFileSize = (size: number) => {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${size} B`;
};

export default function SaveDataSettingsMenu() {

  const [saveFiles, setSaveFiles] = useState<WebMelonStorageFileEntry[]>([]);
  const [storageReady, setStorageReady] = useState(false);

  const refreshFileList = () => {
    setSaveFiles(window.WebMelon.storage.listFiles(SAVEFILES_ROOT));
  };

  const handleFiles = async (files: FileList) => {
    for (const file of files) {
      // Keep names simple to avoid path tricks; saves load when named <GAMECODE>.sav
      const filename = file.name.replace(/[^a-zA-Z0-9._ -]/g, '');
      if (!filename) continue;
      const data = new Uint8Array(await file.arrayBuffer());
      window.WebMelon.storage.write(`${SAVEFILES_ROOT}/${filename}`, data);
    }
    window.WebMelon.storage.sync();
    refreshFileList();
  };

  const fileSelectHandler = (event: ChangeEvent<HTMLInputElement>) => {
    let input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    handleFiles(input.files);
  };

  const fileDropHandler = (event: DragEvent) => {
    event.preventDefault();
    if (!event.dataTransfer?.files.length) return;
    handleFiles(event.dataTransfer.files);
  };

  const downloadHandler = (filename: string) => {
    const data = window.WebMelon.storage.read(`${SAVEFILES_ROOT}/${filename}`);
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const deleteHandler = (filename: string) => {
    if (!window.confirm(`Delete ${filename}? This cannot be undone.`)) return;
    window.WebMelon.storage.deleteFile(`${SAVEFILES_ROOT}/${filename}`);
    window.WebMelon.storage.sync();
    refreshFileList();
  };

  useEffect(() => {
    window.WebMelon.storage.initializeSavefilesDirectory(() => {
      setStorageReady(true);
      refreshFileList();
    });
  }, []);

  return (
    <div className="savedata-container">
      <label for="savedata-file-input" onDrop={fileDropHandler} onDragOver={(e)=>e.preventDefault()}>
        <div className="savedata-input-container">
          <LuUpload size={30}/>
          <p><b>Upload save files</b></p>
          <p>
            Drag and drop or click to select. Name files <code>GAMECODE.sav</code> (e.g. <code>ADAE.sav</code>)
            so they are picked up when that game starts.
          </p>
        </div>
      </label>
      <input type="file" id="savedata-file-input" multiple onChange={fileSelectHandler} />
      <br />
      {!storageReady ? (
        <span className="loading loading-spinner loading-sm"></span>
      ) : saveFiles.length === 0 ? (
        <p>No save files stored yet. Saves appear here after a game writes its first save.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {saveFiles.map((file) => (
              <tr key={file.name}>
                <td>{file.name}</td>
                <td>{formatFileSize(file.size)}</td>
                <td className="savedata-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    title="Download"
                    onClick={() => downloadHandler(file.name)}
                  >
                    <LuDownload /> Download
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline btn-error"
                    title="Delete"
                    onClick={() => deleteHandler(file.name)}
                  >
                    <LuTrash2 /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
