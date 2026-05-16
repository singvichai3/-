/**
 * preload.js — Context Bridge
 * Safe API exposure with error handling + sequence ID support
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Database
  loadRecords: (params) => ipcRenderer.invoke('load-records', params),
  loadRecordsBundle: (params) => ipcRenderer.invoke('load-records-bundle', params),
  getRecordsCount: (params) => ipcRenderer.invoke('get-records-count', params),
  getSearchInsights: (params) => ipcRenderer.invoke('get-search-insights', params),
  saveRecords: (records) => ipcRenderer.invoke('save-records', records),
  deleteRecords: (ids, sequenceId) => ipcRenderer.invoke('delete-records', { ids, sequenceId }),
  markReceived: (ids, sequenceId) => ipcRenderer.invoke('mark-received', { ids, sequenceId }),
  undoReceived: (ids, sequenceId) => ipcRenderer.invoke('undo-received', { ids, sequenceId }),
  markCompleted: (ids, sequenceId) => ipcRenderer.invoke('mark-completed', { ids, sequenceId }),
  markReturned: (ids, sequenceId) => ipcRenderer.invoke('mark-returned', { ids, sequenceId }),
  loadAuditLog: (payload) => ipcRenderer.invoke('load-audit-log', payload),
  updateField: (payload) => ipcRenderer.invoke('update-field', payload),
  bulkUpdateField: (payload) => ipcRenderer.invoke('bulk-update-field', payload),
  getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),

  // Settings
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getNetworkServerStatus: () => ipcRenderer.invoke('get-network-server-status'),
  regenerateNetworkRoomCode: () => ipcRenderer.invoke('regenerate-network-room-code'),
  setNetworkRoomCode: (roomCode) => ipcRenderer.invoke('set-network-room-code', { roomCode }),
  disconnectNetworkClient: (clientKey, reason) => ipcRenderer.invoke('disconnect-network-client', { clientKey, reason }),
  allowNetworkClient: (clientKey) => ipcRenderer.invoke('allow-network-client', { clientKey }),
  checkForUpdates: (payload) => ipcRenderer.invoke('check-for-updates', payload),
  downloadAndInstallUpdate: (payload) => ipcRenderer.invoke('download-and-install-update', payload),

  // Files
  openExcelDialog: () => ipcRenderer.invoke('open-excel-dialog'),
  confirmDialog: (payload) => ipcRenderer.invoke('confirm-dialog', payload),
  parseExcel: (filePath) => ipcRenderer.invoke('parse-excel', filePath),
  parseExcelSheet: (input) => ipcRenderer.invoke('parse-excel-sheet', input),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  exportCsv: (params) => ipcRenderer.invoke('export-csv', params),
  exportPrintPdf: (payload) => ipcRenderer.invoke('export-print-pdf', payload),

  // Database Management
  vacuumDatabase: () => ipcRenderer.invoke('vacuum-database'),
  purgeOldData: () => ipcRenderer.invoke('purge-old-data'),
  checkIntegrity: () => ipcRenderer.invoke('check-integrity'),
  getSystemHealth: () => ipcRenderer.invoke('get-system-health'),
  createBackupNow: () => ipcRenderer.invoke('create-backup-now'),
  importDatabaseFile: () => ipcRenderer.invoke('import-database-file'),

  // Window
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  resetWindowFocus: () => ipcRenderer.invoke('reset-window-focus'),

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
