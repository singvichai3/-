const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadSecondarySettings: () => ipcRenderer.invoke('load-secondary-settings'),
  saveSecondarySettings: (settings) => ipcRenderer.invoke('save-secondary-settings', settings),
  discoverMainByRoom: (payload) => ipcRenderer.invoke('discover-main-by-room', payload),
  testMainConnection: (payload) => ipcRenderer.invoke('test-main-connection', payload),
  submitIntakeBatch: (payload) => ipcRenderer.invoke('submit-intake-batch', payload),
  exportPrintPdf: (payload) => ipcRenderer.invoke('export-print-pdf', payload),
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close')
});
