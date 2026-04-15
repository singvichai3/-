/**
 * preload.js — Context Bridge
 * Safe API exposure with error handling + sequence ID support
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Database
  loadRecords: (params) => ipcRenderer.invoke('load-records', params),
  getRecordsCount: (params) => ipcRenderer.invoke('get-records-count', params),
  getSearchInsights: (params) => ipcRenderer.invoke('get-search-insights', params),
  saveRecords: (records) => ipcRenderer.invoke('save-records', records),
  deleteRecords: (ids, sequenceId) => ipcRenderer.invoke('delete-records', { ids, sequenceId }),
  markReceived: (ids, sequenceId) => ipcRenderer.invoke('mark-received', { ids, sequenceId }),
  undoReceived: (ids, sequenceId) => ipcRenderer.invoke('undo-received', { ids, sequenceId }),
  updateField: (payload) => ipcRenderer.invoke('update-field', payload),
  getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),

  // Settings
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: (payload) => ipcRenderer.invoke('check-for-updates', payload),
  downloadAndInstallUpdate: (payload) => ipcRenderer.invoke('download-and-install-update', payload),

  // Files
  openExcelDialog: () => ipcRenderer.invoke('open-excel-dialog'),
  parseExcel: (filePath) => ipcRenderer.invoke('parse-excel', filePath),
  parseExcelSheet: (input) => ipcRenderer.invoke('parse-excel-sheet', input),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  exportCsv: (params) => ipcRenderer.invoke('export-csv', params),

  // Database Management
  vacuumDatabase: () => ipcRenderer.invoke('vacuum-database'),
  purgeOldData: () => ipcRenderer.invoke('purge-old-data'),
  checkIntegrity: () => ipcRenderer.invoke('check-integrity'),

  // Window
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),

  // Event Listeners
  onImportProgress: (callback) => {
    ipcRenderer.on('import-progress', (event, payload) => callback(payload));
  },
  onRefreshRequired: (callback) => {
    ipcRenderer.on('refresh-required', () => callback());
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('update-download-progress', (event, payload) => callback(payload));
  }
});
