const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { findMainByRoomCode, submitIntakeBatch, healthCheck } = require('./secondary-network');

let mainWindow;
let connection = null;
let isExportingPdf = false;
const SECONDARY_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/singvichai3/-/main/update-secondary.json';

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

function normalizePrintStyleSettings(rawStyle = {}) {
  const style = rawStyle && typeof rawStyle === 'object' ? rawStyle : {};
  const clamp = (value, fallback, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  };
  return {
    mainTitleFontPx: clamp(style.mainTitleFontPx, 9, 6, 18),
    headerLabelFontPx: clamp(style.headerLabelFontPx, style.mainTitleFontPx || 9, 6, 18),
    headerValueFontPx: clamp(style.headerValueFontPx, style.mainTitleFontPx || 9, 6, 18),
    subTitleFontPx: clamp(style.subTitleFontPx, 10, 6, 18),
    tableBodyFontPx: clamp(style.tableBodyFontPx, 8, 5, 16),
    summaryFontPx: clamp(style.summaryFontPx, 8, 5, 16),
    tableWidthPct: clamp(style.tableWidthPct, 100, 60, 100),
    verticalScalePct: clamp(style.verticalScalePct, 100, 60, 140)
  };
}

function saveLocalSettings(settings) {
  const safe = {
    roomCode: String(settings?.roomCode || '').replace(/\D/g, '').slice(0, 6),
    host: String(settings?.host || '').trim(),
    port: normalizePortValue(settings?.port),
    clientName: String(settings?.clientName || '').trim() || 'เครื่องรอง',
    clientId: String(settings?.clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
    stationName: String(settings?.stationName || '').trim().slice(0, 120),
    printLayout: ['auto', 'half-left', 'full-page'].includes(String(settings?.printLayout || '')) ? String(settings.printLayout) : 'auto',
    printStyle: normalizePrintStyleSettings(settings?.printStyle)
  };
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}


function compareVersions(left, right) {
  const normalize = (value) => String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map(part => parseInt(part, 10) || 0);

  const leftParts = normalize(left);
  const rightParts = normalize(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

function sanitizeUpdateUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('ยังไม่ได้ตั้งค่า URL อัปเดตเครื่องรอง');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL อัปเดตเครื่องรองไม่ถูกต้อง');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL อัปเดตรองรับเฉพาะ http หรือ https');
  }
  return parsed.toString();
}

async function resolveSecondaryUpdateManifest(manifestUrl = SECONDARY_UPDATE_MANIFEST_URL) {
  const safeUrl = sanitizeUpdateUrl(manifestUrl || SECONDARY_UPDATE_MANIFEST_URL);
  const response = await fetch(safeUrl, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`โหลดข้อมูลอัปเดตเครื่องรองไม่สำเร็จ (${response.status})`);

  const manifest = await response.json();
  const latestVersion = String(manifest?.version || '').trim();
  const installerUrl = String(manifest?.url || '').trim();
  if (!latestVersion) throw new Error('ไฟล์อัปเดตเครื่องรองไม่มี version');
  if (!installerUrl) throw new Error('ไฟล์อัปเดตเครื่องรองไม่มี url ของตัวติดตั้ง');

  return {
    currentVersion: app.getVersion(),
    latestVersion,
    available: compareVersions(latestVersion, app.getVersion()) > 0,
    url: sanitizeUpdateUrl(installerUrl),
    notes: String(manifest?.notes || '').trim(),
    publishedAt: String(manifest?.publishedAt || '').trim(),
    manifestUrl: safeUrl
  };
}

async function downloadSecondaryInstaller(updateInfo) {
  const response = await fetch(updateInfo.url, { cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`ดาวน์โหลดตัวติดตั้งเครื่องรองไม่สำเร็จ (${response.status})`);

  const totalBytes = Number(response.headers.get('content-length') || '0');
  const tempDir = path.join(app.getPath('temp'), 'rab-lem-rot-tro-secondary-updates');
  fs.mkdirSync(tempDir, { recursive: true });
  const installerPath = path.join(tempDir, `รับเล่มรถ ตรอ เครื่องรอง Setup ${updateInfo.latestVersion}.exe`);
  const writer = fs.createWriteStream(installerPath);
  const reader = response.body.getReader();
  let downloadedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      downloadedBytes += chunk.length;
      await new Promise((resolve, reject) => writer.write(chunk, error => error ? reject(error) : resolve()));
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('secondary-update-download-progress', {
          version: updateInfo.latestVersion,
          downloadedBytes,
          totalBytes,
          percent: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : null
        });
      }
    }
  } finally {
    await new Promise(resolve => writer.end(resolve));
  }

  return installerPath;
}

function launchSecondaryInstaller(installerPath) {
  const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
  child.unref();
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

ipcMain.handle('get-secondary-app-version', () => app.getVersion());

ipcMain.handle('check-secondary-updates', async (_event, payload = {}) => {
  try {
    return await resolveSecondaryUpdateManifest(payload?.manifestUrl || SECONDARY_UPDATE_MANIFEST_URL);
  } catch (error) {
    console.error('check-secondary-updates error:', error);
    throw error;
  }
});

ipcMain.handle('download-and-install-secondary-update', async (_event, payload = {}) => {
  try {
    const updateInfo = await resolveSecondaryUpdateManifest(payload?.manifestUrl || SECONDARY_UPDATE_MANIFEST_URL);
    if (!updateInfo.available) return { success: false, message: 'ยังไม่มีเวอร์ชันใหม่' };
    const installerPath = await downloadSecondaryInstaller(updateInfo);
    launchSecondaryInstaller(installerPath);
    setTimeout(() => app.quit(), 500);
    return { success: true, installerPath, version: updateInfo.latestVersion };
  } catch (error) {
    console.error('download-and-install-secondary-update error:', error);
    throw error;
  }
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
    printToPdfPromise.catch((error) => {
      console.warn('Late PDF export rejection:', error);
    });
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
