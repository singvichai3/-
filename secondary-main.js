const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { findMainByRoomCode, submitIntakeBatch, healthCheck } = require('./secondary-network');
const { parseTroReportWorkbook } = require('./secondary-tro-import');
const { verifySecondaryUpdateManifestSignature, SECONDARY_UPDATE_APP_ID, SECONDARY_UPDATE_CHANNEL } = require('./secondary-update-signing');

let mainWindow;
let connection = null;
let isExportingPdf = false;
const SECONDARY_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/singvichai3/-/main/update-secondary.json';
const MAX_SETTINGS_BYTES = 100 * 1024;
const MAX_SECONDARY_INSTALLER_BYTES = 500 * 1024 * 1024;

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
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_SETTINGS_BYTES) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
  } catch {
    return {};
  }
}

function sanitizeFileNamePart(value, fallback = 'unknown') {
  const safe = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
  return safe || fallback;
}

function normalizeExpectedSha256(value) {
  const hash = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) return '';
  return hash;
}

function verifyFileSha256(filePath, expectedHash) {
  const safeExpected = normalizeExpectedSha256(expectedHash);
  if (!safeExpected) throw new Error('ไฟล์อัปเดตเครื่องรองไม่มี SHA-256 สำหรับตรวจสอบความถูกต้อง');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actual !== safeExpected) {
    try { fs.rmSync(filePath, { force: true }); } catch { /* ignore */ }
    throw new Error('ไฟล์อัปเดตเครื่องรองไม่ผ่านการตรวจสอบ SHA-256');
  }
  return actual;
}

function normalizePortValue(port) {
  const value = Number(port || 39730);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return 39730;
  return value;
}

function normalizeServiceRate(value, fallback) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return fallback;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(99999, Math.round(number * 100) / 100);
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

function normalizeBackupDir(value) {
  return String(value || '').replace(/[\0\r\n]/g, '').trim().slice(0, 500);
}

function refocusSecondaryWindow(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  setTimeout(() => {
    try {
      app.focus({ steal: true });
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.focus();
    } catch (error) {
      console.warn('refocusSecondaryWindow failed:', error);
    }
  }, 30);
}

function saveLocalSettings(settings) {
  const existing = loadLocalSettings();
  const input = { ...existing };
  if (settings && typeof settings === 'object') {
    Object.entries(settings).forEach(([key, value]) => {
      if (value !== undefined) input[key] = value;
    });
  }
  const safe = {
    roomCode: String(input?.roomCode || '').replace(/\D/g, '').slice(0, 6),
    host: String(input?.host || '').trim(),
    port: normalizePortValue(input?.port),
    name: String(input?.name || '').trim().slice(0, 120),
    clientName: String(input?.clientName || '').trim() || 'เครื่องรอง',
    clientId: String(input?.clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
    stationName: String(input?.stationName || '').trim().slice(0, 120),
    province: String(input?.province || '').trim().slice(0, 60),
    transportCarRate: normalizeServiceRate(input?.transportCarRate, 20),
    transportMotoRate: normalizeServiceRate(input?.transportMotoRate, 20),
    shopCarRate: normalizeServiceRate(input?.shopCarRate, 50),
    shopMotoRate: normalizeServiceRate(input?.shopMotoRate, 40),
    backupDir: normalizeBackupDir(input?.backupDir),
    printLayout: ['auto', 'half-left', 'full-page'].includes(String(input?.printLayout || '')) ? String(input.printLayout) : 'auto',
    printStyle: normalizePrintStyleSettings(input?.printStyle)
  };
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}


const BACKUP_RETENTION_DAYS = 5;
const BACKUP_DIR_NAME = 'excel-backups-secondary';

function getBackupDir(settings = loadLocalSettings()) {
  const customBackupDir = normalizeBackupDir(settings?.backupDir);
  return customBackupDir || path.join(app.getPath('userData'), BACKUP_DIR_NAME);
}

function generateExcelBuffer(rows, tableMeta, settings) {
  const safeRows = Array.isArray(rows) ? rows.filter(row => {
    const plate = String(row && row.plate || '').trim();
    return plate.length > 0;
  }) : [];

  const dataHeaders = ['ลำดับ', 'ทะเบียนรถ', 'ประเภทรถ', 'ราคาภาษี', 'หมายเหตุ', 'ยี่ห้อ', 'จังหวัด'];
  const dataRows = safeRows.map((row, index) => [
    index + 1,
    String(row.plate || '').trim(),
    row.type === 'จยย' ? 'จยย' : 'รย',
    String(row.taxAmount || '').trim(),
    String(row.note || '').trim(),
    String(row.brand || '').trim(),
    String(row.province || '').trim()
  ]);

  const wsData = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
  wsData['!cols'] = [
    { wch: 8 }, { wch: 18 }, { wch: 10 },
    { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 16 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsData, 'ข้อมูลตาราง');

  const meta = (tableMeta && typeof tableMeta === 'object') ? tableMeta : {};
  const stationName = String(meta.stationName || settings?.stationName || 'รับเล่มรถ ตรอ.').trim();
  const documentDate = String(meta.documentDate || '').trim();
  const appointmentDate = String(meta.appointmentDate || '').trim();
  const todayStr = new Date().toISOString().slice(0, 10);

  const metaRows = [
    { รายการ: 'ชื่อร้าน/ตรอ.', ค่า: stationName },
    { รายการ: 'วันที่เอกสาร', ค่า: documentDate || todayStr },
    { รายการ: 'วันที่นัด', ค่า: appointmentDate || '-' },
    { รายการ: 'วันที่ส่งออก', ค่า: todayStr },
    { รายการ: 'จำนวนรายการ', ค่า: String(safeRows.length) },
    { รายการ: 'อายุไฟล์สำรองอัตโนมัติ', ค่า: `${BACKUP_RETENTION_DAYS} วัน (โปรแกรมลบไฟล์เก่าให้อัตโนมัติ)` },
    { รายการ: 'โปรแกรม', ค่า: 'รับเล่มรถ ตรอ. - เครื่องรอง' }
  ];
  const wsMeta = XLSX.utils.json_to_sheet(metaRows);
  wsMeta['!cols'] = [{ wch: 22 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, 'ข้อมูลเอกสาร');

  const taxTotal = safeRows.reduce((sum, row) => sum + (Number(row.taxAmount) || 0), 0);
  const carCount = safeRows.filter(row => row.type !== 'จยย').length;
  const motoCount = safeRows.filter(row => row.type === 'จยย').length;
  const transportCarRate = Number(settings?.transportCarRate || 20);
  const transportMotoRate = Number(settings?.transportMotoRate || 20);
  const serviceTotal = (carCount * transportCarRate) + (motoCount * transportMotoRate);
  const grandTotal = taxTotal + serviceTotal;

  const summaryRows = [
    { รายการ: 'รวมภาษี', จำนวน: String(taxTotal.toFixed(2)) },
    { รายการ: `รย. ${carCount} คัน × ${transportCarRate}`, จำนวน: String((carCount * transportCarRate).toFixed(2)) },
    { รายการ: `จยย. ${motoCount} คัน × ${transportMotoRate}`, จำนวน: String((motoCount * transportMotoRate).toFixed(2)) },
    { รายการ: 'รวมค่าขนส่ง/บริการ', จำนวน: String(serviceTotal.toFixed(2)) },
    { รายการ: 'รวมทั้งหมด', จำนวน: String(grandTotal.toFixed(2)) }
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 36 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'สรุปยอด');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function getBackupFileName(tableMeta, settings) {
  const station = sanitizeFileNamePart(
    tableMeta?.stationName || settings?.stationName || 'รับเล่มรถ',
    'unknown'
  );
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = date.toISOString().slice(11, 23).replace(/[:.]/g, '');
  const nonce = Math.random().toString(36).slice(2, 6);
  return `backup-${station}-${dateStr}_${timeStr}-${nonce}.xlsx`;
}

function saveAutoBackup(rows, tableMeta, settings) {
  const backupDir = getBackupDir(settings);
  fs.mkdirSync(backupDir, { recursive: true });
  const buffer = generateExcelBuffer(rows, tableMeta, settings);
  const fileName = getBackupFileName(tableMeta, settings);
  const filePath = path.join(backupDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return { path: filePath, bytes: buffer.length, fileName };
}

function cleanupOldBackups(settings = loadLocalSettings()) {
  const backupDir = getBackupDir(settings);
  if (!fs.existsSync(backupDir)) return { deleted: 0, errors: 0 };
  const cutoffMs = Date.now() - (BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let deleted = 0;
  let errors = 0;
  try {
    const entries = fs.readdirSync(backupDir);
    for (const entry of entries) {
      if (!entry.endsWith('.xlsx')) continue;
      const fullPath = path.join(backupDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.mtimeMs < cutoffMs) {
          fs.rmSync(fullPath, { force: true });
          deleted++;
        }
      } catch {
        errors++;
      }
    }
  } catch {
    errors++;
  }
  return { deleted, errors };
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
  verifySecondaryUpdateManifestSignature(manifest);
  if (String(manifest?.appId || SECONDARY_UPDATE_APP_ID) !== SECONDARY_UPDATE_APP_ID) {
    throw new Error('ไฟล์อัปเดตเครื่องรองไม่ตรงกับโปรแกรมนี้');
  }
  if (String(manifest?.channel || SECONDARY_UPDATE_CHANNEL) !== SECONDARY_UPDATE_CHANNEL) {
    throw new Error('ไฟล์อัปเดตเครื่องรองไม่ตรงกับช่องทางอัปเดต');
  }
  const latestVersion = String(manifest?.version || '').trim();
  const installerUrl = String(manifest?.url || '').trim();
  if (!latestVersion) throw new Error('ไฟล์อัปเดตเครื่องรองไม่มี version');
  if (!installerUrl) throw new Error('ไฟล์อัปเดตเครื่องรองไม่มี url ของตัวติดตั้ง');

  return {
    currentVersion: app.getVersion(),
    latestVersion,
    available: compareVersions(latestVersion, app.getVersion()) > 0,
    url: sanitizeUpdateUrl(installerUrl),
    sha256: normalizeExpectedSha256(manifest?.sha256),
    notes: String(manifest?.notes || '').trim(),
    publishedAt: String(manifest?.publishedAt || '').trim(),
    manifestUrl: safeUrl
  };
}

async function downloadSecondaryInstaller(updateInfo) {
  const response = await fetch(updateInfo.url, { cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`ดาวน์โหลดตัวติดตั้งเครื่องรองไม่สำเร็จ (${response.status})`);

  const totalBytes = Number(response.headers.get('content-length') || '0');
  if (totalBytes > MAX_SECONDARY_INSTALLER_BYTES) {
    throw new Error('ไฟล์อัปเดตเครื่องรองใหญ่เกินกำหนด');
  }
  const tempDir = path.join(app.getPath('temp'), 'rab-lem-rot-tro-secondary-updates');
  fs.mkdirSync(tempDir, { recursive: true });
  const safeVersion = sanitizeFileNamePart(updateInfo.latestVersion, 'latest');
  const installerPath = path.join(tempDir, `รับเล่มรถ ตรอ เครื่องรอง Setup ${safeVersion}.exe`);
  const writer = fs.createWriteStream(installerPath);
  const reader = response.body.getReader();
  let downloadedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      downloadedBytes += chunk.length;
      if (downloadedBytes > MAX_SECONDARY_INSTALLER_BYTES) {
        throw new Error('ไฟล์อัปเดตเครื่องรองใหญ่เกินกำหนด');
      }
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

  verifyFileSha256(installerPath, updateInfo.sha256);
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

ipcMain.handle('select-secondary-backup-dir', async (event, currentDir = '') => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win || win.isDestroyed()) throw new Error('ไม่พบหน้าต่างสำหรับเลือกโฟลเดอร์สำรอง');
  const saved = loadLocalSettings();
  const defaultPath = normalizeBackupDir(currentDir) || getBackupDir(saved);
  const result = await dialog.showOpenDialog(win, {
    title: 'เลือกโฟลเดอร์เก็บไฟล์สำรอง Excel อัตโนมัติ',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  });
  refocusSecondaryWindow(win);
  if (result.canceled || !result.filePaths?.[0]) return null;
  const backupDir = normalizeBackupDir(result.filePaths[0]);
  const next = saveLocalSettings({ ...saved, backupDir });
  return { success: true, backupDir: next.backupDir };
});

ipcMain.handle('select-and-parse-tro-report', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win || win.isDestroyed()) throw new Error('ไม่พบหน้าต่างสำหรับเลือกไฟล์');
  const result = await dialog.showOpenDialog(win, {
    title: 'เลือกไฟล์ Excel รายงานผลตรวจสภาพรถ ตรอ.',
    properties: ['openFile'],
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
  });
  if (result.canceled || !result.filePaths?.[0]) {
    refocusSecondaryWindow(win);
    return null;
  }
  try {
    return parseTroReportWorkbook(result.filePaths[0], { maxRows: 2000, maxBytes: 25 * 1024 * 1024 });
  } finally {
    refocusSecondaryWindow(win);
  }
});

ipcMain.handle('secondary-confirm-dialog', async (event, payload = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win || win.isDestroyed()) throw new Error('ไม่พบหน้าต่างสำหรับแสดงข้อความยืนยัน');
  const buttons = Array.isArray(payload.buttons) && payload.buttons.length ? payload.buttons.map(String) : ['ตกลง', 'ยกเลิก'];
  const result = await dialog.showMessageBox(win, {
    type: payload.type || 'question',
    title: String(payload.title || 'ยืนยัน'),
    message: String(payload.message || ''),
    detail: String(payload.detail || ''),
    buttons,
    defaultId: Number.isInteger(payload.defaultId) ? payload.defaultId : 0,
    cancelId: Number.isInteger(payload.cancelId) ? payload.cancelId : buttons.length - 1,
    noLink: true
  });
  refocusSecondaryWindow(win);
  return { confirmed: result.response === 0, response: result.response, button: buttons[result.response] || '' };
});

ipcMain.handle('save-secondary-settings', (_event, settings) => {
  const saved = saveLocalSettings(settings || {});
  connection = saved.host ? saved : connection;
  return saved;
});

ipcMain.handle('discover-main-by-room', async (_event, payload = {}) => {
  const roomCode = payload.roomCode;
  const manualHost = String(payload.host || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').slice(0, 253);
  const manualPort = normalizePortValue(payload.port || 39730);
  if (manualHost) {
    const result = await healthCheck({
      host: manualHost,
      port: manualPort,
      roomCode,
      clientName: payload.clientName || loadLocalSettings().clientName || 'เครื่องรอง',
      clientId: payload.clientId || loadLocalSettings().clientId || ''
    });
    connection = saveLocalSettings({ ...loadLocalSettings(), host: manualHost, port: manualPort, roomCode, name: result.name || 'เครื่องหลัก' });
    return { ok: true, host: manualHost, port: manualPort, roomCode: connection.roomCode, name: connection.name, version: result.version || '' };
  }

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
  connection = saveLocalSettings({ ...target, ...payload, roomCode: payload.roomCode || target.roomCode });
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
    ...payload,
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
    refocusSecondaryWindow(win);
  }
});

ipcMain.handle('export-secondary-excel', async (event, payload = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  try {
    if (!win || win.isDestroyed()) throw new Error('ไม่พบหน้าต่างสำหรับบันทึก Excel');
      const safeStation = sanitizeFileNamePart(payload.tableMeta?.stationName || payload.settings?.stationName || 'รับเล่มรถ', 'secondary');
      const today = new Date().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog(win, {
      title: 'บันทึกไฟล์ Excel สำรอง',
      defaultPath: `excel-backup-${safeStation}-${today}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    const buffer = generateExcelBuffer(payload.rows, payload.tableMeta, payload.settings);
    fs.writeFileSync(result.filePath, buffer);
    cleanupOldBackups();
    return { success: true, path: result.filePath, bytes: buffer.length };
  } finally {
    refocusSecondaryWindow(win);
  }
});

ipcMain.handle('auto-backup-secondary-excel', async (_event, payload = {}) => {
  try {
    const backupResult = saveAutoBackup(payload.rows, payload.tableMeta, payload.settings);
    const cleanupResult = cleanupOldBackups();
    return { success: true, backup: backupResult, cleanup: cleanupResult };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cleanup-old-secondary-backups', async () => {
  const result = cleanupOldBackups();
  return { success: true, deleted: result.deleted, errors: result.errors };
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
  cleanupOldBackups();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
