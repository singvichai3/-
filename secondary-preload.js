const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadSecondarySettings: () => ipcRenderer.invoke('load-secondary-settings'),
  saveSecondarySettings: (settings) => ipcRenderer.invoke('save-secondary-settings', settings),
  discoverMainByRoom: (payload) => ipcRenderer.invoke('discover-main-by-room', payload),
  testMainConnection: (payload) => ipcRenderer.invoke('test-main-connection', payload),
  submitIntakeBatch: (payload) => ipcRenderer.invoke('submit-intake-batch', payload),
  exportPrintPdf: (payload) => ipcRenderer.invoke('export-print-pdf', payload),
  getSecondaryAppVersion: () => ipcRenderer.invoke('get-secondary-app-version'),
  checkSecondaryUpdates: (payload) => ipcRenderer.invoke('check-secondary-updates', payload),
  downloadAndInstallSecondaryUpdate: (payload) => ipcRenderer.invoke('download-and-install-secondary-update', payload),
  onSecondaryUpdateDownloadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('secondary-update-download-progress', listener);
    return () => ipcRenderer.removeListener('secondary-update-download-progress', listener);
  },
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close')
});
