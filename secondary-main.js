const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { findMainByRoomCode, submitIntakeBatch, healthCheck } = require('./secondary-network');

let mainWindow;
let connection = null;
let isExportingPdf = false;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'secondary-settings.json');
}

function loadLocalSettings() {
  try {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
  } catch {
    return {};
  }
}

function normalizePortValue(port) {
  const value = Number(port || 39730);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return 39730;
  return value;
}

function saveLocalSettings(settings) {
  const safe = {
    roomCode: String(settings?.roomCode || '').replace(/\D/g, '').slice(0, 6),
    host: String(settings?.host || '').trim(),
    port: normalizePortValue(settings?.port),
    clientName: String(settings?.clientName || '').trim() || 'เครื่องรอง',
    clientId: String(settings?.clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
  };
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    frame: false,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'secondary-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      devTools: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('secondary-index.html');
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('load-secondary-settings', () => ({ ...loadLocalSettings(), connected: Boolean(connection) }));

ipcMain.handle('save-secondary-settings', (_event, settings) => {
  const saved = saveLocalSettings(settings || {});
  connection = saved.host ? saved : connection;
  return saved;
});

ipcMain.handle('discover-main-by-room', async (_event, payload = {}) => {
  const roomCode = payload.roomCode;
  const found = await findMainByRoomCode(roomCode, { timeoutMs: Number(payload.timeoutMs || 5000) });
  if (!found?.host || !Number.isInteger(Number(found.port)) || Number(found.port) < 1 || Number(found.port) > 65535) {
    throw new Error('ค้นพบเครื่องหลัก แต่ข้อมูล IP/พอร์ตไม่สมบูรณ์');
  }
  connection = saveLocalSettings({ ...loadLocalSettings(), ...found, roomCode: found.roomCode });
  return { ok: true, ...found };
});

ipcMain.handle('test-main-connection', async (_event, payload = {}) => {
  const target = payload.host ? payload : (connection || loadLocalSettings());
  const result = await healthCheck(target);
  connection = saveLocalSettings({ ...target, roomCode: payload.roomCode || target.roomCode });
  return { ok: true, ...result };
});

ipcMain.handle('submit-intake-batch', async (_event, payload = {}) => {
  const target = payload.host ? payload : (connection || loadLocalSettings());
  const result = await submitIntakeBatch({
    ...target,
    roomCode: payload.roomCode || target.roomCode,
    rows: payload.rows,
    printableRows: payload.printableRows,
    clientName: payload.clientName || target.clientName,
    clientId: payload.clientId || target.clientId,
    batchSize: payload.batchSize || 500
  });
  connection = saveLocalSettings({
    ...target,
    roomCode: payload.roomCode || target.roomCode,
    clientName: payload.clientName || target.clientName,
    clientId: payload.clientId || target.clientId
  });
  return result;
});

ipcMain.handle('export-print-pdf', async (event, payload = {}) => {
  if (isExportingPdf) throw new Error('กำลังบันทึก PDF อยู่ กรุณารอสักครู่');
  isExportingPdf = true;

  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  try {
    if (!win || win.isDestroyed()) throw new Error('ไม่พบหน้าต่างสำหรับสร้าง PDF');

    const result = await dialog.showSaveDialog(win, {
      title: 'บันทึกไฟล์ PDF',
      defaultPath: `รับเล่มรถ-เครื่องรอง-${new Date().toISOString().split('T')[0]}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return null;

    const printToPdfPromise = win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: false,
      margins: { marginType: 'printableArea' },
      preferCSSPageSize: true
    });
    printToPdfPromise.catch(() => {});
    const pdfBuffer = await Promise.race([
      printToPdfPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('PDF export timeout (25s)')), 25000))
    ]);
    fs.writeFileSync(result.filePath, pdfBuffer);
    return { success: true, path: result.filePath, bytes: pdfBuffer.length, rowCount: Number(payload?.rowCount || 0) };
  } finally {
    isExportingPdf = false;
  }
});

ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win-close', () => {
  try { app.quit(); } catch { mainWindow?.close(); }
});

app.whenReady().then(() => {
  if (!singleInstanceLock) return;
  app.setName('รับเล่มรถ ตรอ. - เครื่องรอง');
  app.setPath('userData', path.join(app.getPath('appData'), 'rab-lem-rot-tro-secondary'));
  connection = loadLocalSettings();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
