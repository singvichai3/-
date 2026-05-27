/**
 * main.js — Optimized Main Process
 * Industrial Worker Management + Bulletproof Error Handling
 * Anti-freeze + Memory Management + Auto-recovery
 */

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const DBManager = require('./db.js');
const Database = require('better-sqlite3');
const xlsx = require('xlsx');
const { createLocalNetworkServer } = require('./local-network-server');

let mainWindow;
let dbWorker;
let db;
let requestId = 0;
const pendingRequests = new Map();
let isQuitting = false;
let autoBackupTimer = null;
let isExportingPdf = false;
let memoryMonitorTimer = null;
let localNetworkServer = null;
let workerInitPromise = null;
const allowedExcelFilePaths = new Set();

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_BACKUP_CHECK_MS = 60 * 60 * 1000;
const BACKUP_RETENTION_COUNT = 1;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();

    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'เปิดโปรแกรมซ้ำ',
      message: 'โปรแกรมเปิดใช้งานอยู่แล้ว',
      detail: 'ระบบจะพาคุณกลับไปยังหน้าต่างที่เปิดอยู่'
    }).catch(() => {
      // Ignore dialog failures when the window is busy.
    });
  }
});

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
  if (!raw) throw new Error('ยังไม่ได้ตั้งค่า URL อัปเดต');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL อัปเดตไม่ถูกต้อง');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL อัปเดตรองรับเฉพาะ http หรือ https');
  }

  return parsed.toString();
}

function getDatabasePath() {
  return global.dbPath || path.join(app.getPath('userData'), 'database.db');
}

function isAllowedExcelExtension(filePath) {
  return ['.xls', '.xlsx'].includes(path.extname(String(filePath || '')).toLowerCase());
}

function rememberAllowedExcelFile(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!isAllowedExcelExtension(resolved)) throw new Error('รองรับเฉพาะไฟล์ Excel .xls/.xlsx');
  allowedExcelFilePaths.add(resolved);
  return resolved;
}

function assertAllowedExcelFile(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!isAllowedExcelExtension(resolved)) throw new Error('รองรับเฉพาะไฟล์ Excel .xls/.xlsx');
  if (!allowedExcelFilePaths.has(resolved)) throw new Error('ไฟล์นี้ไม่ได้ถูกเลือกผ่านหน้าต่างเลือกไฟล์ของโปรแกรม');
  return resolved;
}

function getNetworkRoomSettingsPath() {
  return path.join(app.getPath('userData'), 'network-room.json');
}

function loadPersistedRoomCode() {
  try {
    const filePath = getNetworkRoomSettingsPath();
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const code = String(parsed?.roomCode || '').replace(/\D/g, '');
    return /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

function persistRoomCode(roomCode) {
  try {
    const code = String(roomCode || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) return;
    fs.mkdirSync(path.dirname(getNetworkRoomSettingsPath()), { recursive: true });
    fs.writeFileSync(getNetworkRoomSettingsPath(), JSON.stringify({ roomCode: code }, null, 2), 'utf8');
  } catch (error) {
    console.warn('⚠️ บันทึกรหัสห้องไม่สำเร็จ:', error.message);
  }
}

function getBackupDirectory() {
  return path.join(path.dirname(getDatabasePath()), 'backup');
}

function ensureBackupDirectory() {
  const backupDir = getBackupDirectory();
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

function buildBackupFilePath(prefix = 'database') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(ensureBackupDirectory(), `${prefix}_${stamp}.db`);
}

function cleanupOldBackups() {
  const backupDir = ensureBackupDirectory();
  const files = fs.readdirSync(backupDir)
    .filter(name => name.toLowerCase().endsWith('.db'))
    .map(name => ({
      name,
      fullPath: path.join(backupDir, name),
      stat: fs.statSync(path.join(backupDir, name))
    }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  for (const file of files.slice(BACKUP_RETENTION_COUNT)) {
    try {
      fs.unlinkSync(file.fullPath);
    } catch (error) {
      console.warn('⚠️ Failed to remove old backup:', file.fullPath, error.message);
    }
  }
}

function readBackupSummary() {
  const backupDir = ensureBackupDirectory();
  const files = fs.readdirSync(backupDir)
    .filter(name => name.toLowerCase().endsWith('.db'))
    .map(name => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        path: fullPath,
        sizeBytes: stat.size,
        modifiedAt: new Date(stat.mtimeMs).toISOString()
      };
    })
    .sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));

  return {
    backupDir,
    count: files.length,
    latest: files[0] || null
  };
}

function removeSQLiteSidecarFiles(dbPath) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecarPath = `${dbPath}${suffix}`;
    if (!fs.existsSync(sidecarPath)) continue;
    try {
      fs.unlinkSync(sidecarPath);
    } catch (error) {
      console.warn('⚠️ Failed to remove SQLite sidecar:', sidecarPath, error.message);
    }
  }
}

function validateDatabaseFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('ไม่พบไฟล์ฐานข้อมูลที่เลือก');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error('ไม่พบไฟล์ฐานข้อมูลที่เลือก');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error('ไฟล์ฐานข้อมูลไม่ถูกต้องหรือไฟล์ว่าง');
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.db', '.sqlite', '.sqlite3'].includes(ext)) {
    throw new Error('รองรับเฉพาะไฟล์ .db, .sqlite หรือ .sqlite3');
  }

  let candidate;
  try {
    candidate = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrityRows = candidate.pragma('integrity_check');
    const integrityRaw = Array.isArray(integrityRows) ? integrityRows[0] : integrityRows;
    const integrity = typeof integrityRaw === 'string'
      ? integrityRaw
      : String(integrityRaw?.integrity_check || Object.values(integrityRaw || {})[0] || 'unknown');

    if (integrity.toLowerCase() !== 'ok') {
      throw new Error(`ฐานข้อมูลไม่ผ่าน integrity check: ${integrity}`);
    }

    const recordsTable = candidate.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='records'
    `).get();
    if (!recordsTable) {
      throw new Error('ไฟล์นี้ไม่ใช่ฐานข้อมูลของระบบรับเล่ม: ไม่พบตาราง records');
    }

    const settingsTable = candidate.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='settings'
    `).get();
    const recordCount = candidate.prepare('SELECT COUNT(*) AS total FROM records').get()?.total || 0;

    return {
      filePath,
      fileName: path.basename(filePath),
      sizeBytes: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      recordCount: Number(recordCount || 0),
      hasSettings: Boolean(settingsTable),
      integrity: 'ok'
    };
  } finally {
    if (candidate) {
      try { candidate.close(); } catch (error) { /* ignore */ }
    }
  }
}

function shutdownDatabaseForReplacement() {
  rejectAllPendingRequests('Database replacement in progress');

  if (dbWorker) {
    try { dbWorker.terminate(); } catch (error) { /* ignore */ }
    dbWorker = null;
  }

  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (error) {
      console.warn('⚠️ Failed to close database before replacement:', error.message);
    }
    db = null;
  }
}

function reinitializeDatabaseAfterReplacement() {
  const dbManager = new DBManager(app);
  const initResult = dbManager.init();
  db = initResult.db;
  global.dbPath = initResult.dbPath;
  createWorker();
  scheduleAutoBackup();
  return initResult.dbPath;
}

async function createDatabaseBackup({ automatic = false } = {}) {
  const backupPath = buildBackupFilePath(automatic ? 'auto-backup' : 'manual-backup');
  const { data } = await sendToWorker('backupDatabase', { backupPath });
  cleanupOldBackups();

  const settingsPayload = {
    lastBackupAt: data?.createdAt || new Date().toISOString(),
    lastBackupPath: data?.backupPath || backupPath,
    autoBackupEnabled: 'true'
  };
  await sendToWorker('saveSettings', settingsPayload);

  return {
    backupPath: settingsPayload.lastBackupPath,
    createdAt: settingsPayload.lastBackupAt,
    automatic
  };
}

async function ensureAutoBackup(force = false) {
  try {
    const { data: settings } = await sendToWorker('loadSettings');
    const autoBackupEnabled = String(settings?.autoBackupEnabled ?? 'true') !== 'false';
    if (!autoBackupEnabled && !force) return null;

    const lastBackupAt = settings?.lastBackupAt ? Date.parse(settings.lastBackupAt) : 0;
    if (!force && lastBackupAt && (Date.now() - lastBackupAt) < AUTO_BACKUP_INTERVAL_MS) {
      return null;
    }

    return await createDatabaseBackup({ automatic: true });
  } catch (error) {
    console.warn('⚠️ Auto backup skipped:', error.message);
    return null;
  }
}

async function getSystemHealth() {
  const dbPath = getDatabasePath();
  const dbExists = fs.existsSync(dbPath);
  const dbStat = dbExists ? fs.statSync(dbPath) : null;
  const backup = readBackupSummary();
  const statsResult = await sendToWorker('loadStats');
  const integrityResult = await sendToWorker('checkIntegrity');
  const settingsResult = await sendToWorker('loadSettings');
  const integrityRows = Array.isArray(integrityResult?.data) ? integrityResult.data : [];
  const integrityRaw = integrityRows[0];
  const integrityValue = typeof integrityRaw === 'string'
    ? integrityRaw
    : (integrityRaw && typeof integrityRaw === 'object' ? Object.values(integrityRaw)[0] : 'unknown');

  return {
    dbPath,
    dbSizeBytes: dbStat?.size || 0,
    dbUpdatedAt: dbStat ? new Date(dbStat.mtimeMs).toISOString() : null,
    totalRecords: Number(statsResult?.data?.total || 0),
    pendingRecords: Number(statsResult?.data?.pending || 0),
    receivedRecords: Number(statsResult?.data?.received || 0),
    todayRecords: Number(statsResult?.data?.today || 0),
    integrity: integrityValue,
    backup,
    settings: settingsResult?.data || {}
  };
}

function scheduleAutoBackup() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
  }

  autoBackupTimer = setInterval(() => {
    ensureAutoBackup(false).catch(error => {
      console.warn('⚠️ Scheduled backup error:', error.message);
    });
  }, AUTO_BACKUP_CHECK_MS);
}

async function startLocalNetworkServer() {
  if (localNetworkServer) return localNetworkServer.getStatus();

  localNetworkServer = createLocalNetworkServer({
    version: app.getVersion(),
    roomCode: loadPersistedRoomCode(),
    sendToWorker,
    broadcastRefresh,
    logger: console
  });

  try {
    const status = await localNetworkServer.start();
    persistRoomCode(status?.roomCode);
    return status;
  } catch (error) {
    console.warn('⚠️ เปิดระบบเชื่อมต่อเครื่องรองไม่สำเร็จ:', error.message);
    try { localNetworkServer.stop(); } catch (_) { /* ignore */ }
    localNetworkServer = null;
    return { ok: false, error: error.message };
  }
}

async function resolveUpdateManifest(manifestUrl) {
  const safeUrl = sanitizeUpdateUrl(manifestUrl);
  const response = await fetch(safeUrl, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`โหลดข้อมูลอัปเดตไม่สำเร็จ (${response.status})`);
  }

  const manifest = await response.json();
  const latestVersion = String(manifest?.version || '').trim();
  const installerUrl = String(manifest?.url || '').trim();

  if (!latestVersion) throw new Error('ไฟล์อัปเดตไม่มี version');
  if (!installerUrl) throw new Error('ไฟล์อัปเดตไม่มี url ของตัวติดตั้ง');

  return {
    currentVersion: app.getVersion(),
    latestVersion,
    available: compareVersions(latestVersion, app.getVersion()) > 0,
    url: sanitizeUpdateUrl(installerUrl),
    notes: String(manifest?.notes || '').trim(),
    publishedAt: String(manifest?.publishedAt || '').trim()
  };
}

async function downloadInstaller(updateInfo) {
  const response = await fetch(updateInfo.url, { cache: 'no-store' });
  if (!response.ok || !response.body) {
    throw new Error(`ดาวน์โหลดตัวติดตั้งไม่สำเร็จ (${response.status})`);
  }

  const totalBytes = Number(response.headers.get('content-length') || '0');
  const tempDir = path.join(app.getPath('temp'), 'rab-lem-rot-tro-updates');
  fs.mkdirSync(tempDir, { recursive: true });

  const fileName = `รับเล่มรถ ตรอ Setup ${updateInfo.latestVersion}.exe`;
  const installerPath = path.join(tempDir, fileName);
  const writer = fs.createWriteStream(installerPath);
  const reader = response.body.getReader();
  let downloadedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      downloadedBytes += chunk.length;

      await new Promise((resolve, reject) => {
        writer.write(chunk, (error) => error ? reject(error) : resolve());
      });

      if (mainWindow && !mainWindow.isDestroyed()) {
        const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : null;
        mainWindow.webContents.send('update-download-progress', {
          version: updateInfo.latestVersion,
          downloadedBytes,
          totalBytes,
          percent
        });
      }
    }
  } finally {
    await new Promise(resolve => writer.end(resolve));
  }

  return installerPath;
}

function launchInstaller(installerPath) {
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

/**
 * Create main window with optimized settings
 */
function createWindow() {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    mainWindow = new BrowserWindow({
      width: Math.min(1920, width),
      height: Math.min(1080, height),
      minWidth: 1280,
      minHeight: 720,
      frame: false,
      backgroundColor: '#0f172a',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
        devTools: false,
        backgroundThrottling: false,
        offscreen: false
      }
    });

    mainWindow.loadFile('index.html');

    // Block DevTools shortcuts in production UI
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
        return;
      }
      if (input.key === 'F12') {
        event.preventDefault();
        return;
      }
    });

    mainWindow.once('ready-to-show', () => {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      }, 100);
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    mainWindow.on('unresponsive', () => {
      console.warn('⚠️ Window became unresponsive, reloading...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
      }
    });

    // Memory monitoring — keep the timer handle so closing the app can really exit.
    if (memoryMonitorTimer) clearInterval(memoryMonitorTimer);
    memoryMonitorTimer = setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const mem = process.memoryUsage();
        if (mem.heapUsed > 1.5 * 1024 * 1024 * 1024) { // 1.5GB threshold
          console.warn('⚠️ High memory usage, triggering GC...');
          if (global.gc) global.gc();
        }
      }
    }, 60000);

  } catch (error) {
    console.error('❌ createWindow error:', error);
    dialog.showErrorBox('Critical Error', `Failed to create window:\n${error.message}`);
    app.quit();
  }
}

/**
 * Initialize database and worker with auto-recovery
 */
function initDatabase() {
  try {
    // Initialize main DB
    const dbManager = new DBManager(app);
    const initResult = dbManager.init();
    db = initResult.db;
    global.dbPath = initResult.dbPath;

    // Create worker with restart capability
    createWorker();

  } catch (error) {
    console.error('❌ initDatabase error:', error);
    dialog.showErrorBox('Database Error', `Failed to initialize database:\n${error.message}`);
  }
}

/**
 * Create worker with auto-restart
 */
function createWorker() {
  try {
    if (dbWorker) {
      try { dbWorker.removeAllListeners(); } catch { /* ignore */ }
      try { dbWorker.terminate(); } catch { /* ignore */ }
      dbWorker = null;
    }

    dbWorker = new Worker(path.join(__dirname, 'db-worker.js'));

    const dbPath = global.dbPath || (app.getPath('userData') + '/database.db');
    workerInitPromise = sendToWorker('init', { dbPath }, 0, 30000);
    workerInitPromise.catch(err => {
      if (isQuitting) return;
      console.error('❌ Worker init failed, retrying...', err);
      setTimeout(() => {
        if (!isQuitting) createWorker();
      }, 1000);
    });

    dbWorker.on('message', (msg) => handleWorkerMessage(msg));
    dbWorker.on('error', (err) => handleWorkerError(err));
    dbWorker.on('exit', (code) => handleWorkerExit(code));

    return workerInitPromise;
  } catch (error) {
    if (isQuitting) return Promise.resolve();
    console.error('❌ createWorker error:', error);
    setTimeout(() => {
      if (!isQuitting) createWorker();
    }, 2000);
    workerInitPromise = Promise.reject(error);
    return workerInitPromise;
  }
}

/**
 * Handle worker messages
 */
function handleWorkerMessage(msg) {
  try {
    const { id, success, error, type, payload, ...data } = msg;

    // Forward progress to renderer
    if (type === 'import-progress' || type === 'export-progress') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(type, payload);
      }
      return;
    }

    // Handle pending request
    if (id && pendingRequests.has(id)) {
      const { resolve, reject, timer } = pendingRequests.get(id);
      if (timer) clearTimeout(timer);
      pendingRequests.delete(id);

      if (success) {
        resolve({ success: true, ...data });
      } else {
        reject(new Error(error || 'Unknown worker error'));
      }
    }
  } catch (error) {
    console.error('❌ handleWorkerMessage error:', error);
  }
}

/**
 * Reject all pending worker requests and clear the queue
 * ต้องเรียกก่อนทุกครั้งที่ restart worker — ป้องกัน request ค้างนาน 30 วินาที
 */
function rejectAllPendingRequests(reason = 'Worker restarting') {
  if (pendingRequests.size === 0) return;
  console.warn(`⚠️ Rejecting ${pendingRequests.size} pending request(s): ${reason}`);
  pendingRequests.forEach(({ reject, timer }) => {
    if (timer) clearTimeout(timer);
    try { reject(new Error(reason)); } catch (e) { /* ignore */ }
  });
  pendingRequests.clear();
}

/**
 * Handle worker errors with auto-restart
 */
function handleWorkerError(error) {
  if (isQuitting) return;
  console.error('❌ Worker error, restarting...', error);
  rejectAllPendingRequests('Worker crashed');
  if (dbWorker) {
    try { dbWorker.removeAllListeners(); } catch { /* ignore */ }
    try { dbWorker.terminate(); } catch (e) { /* ignore */ }
    dbWorker = null;
  }
  workerInitPromise = null;
  setTimeout(() => {
    if (!isQuitting) createWorker();
  }, 1000);
}

/**
 * Handle worker exit with auto-restart
 */
function handleWorkerExit(code) {
  rejectAllPendingRequests(`Worker exited (code ${code})`);
  if (dbWorker) {
    try { dbWorker.removeAllListeners(); } catch { /* ignore */ }
    dbWorker = null;
  }
  workerInitPromise = null;
  if (!isQuitting) {
    console.warn(`⚠️ Worker exited with code ${code}, restarting...`);
    setTimeout(() => {
      if (!isQuitting) createWorker();
    }, 2000);
  }
}

/**
 * Send message to worker with timeout and retry
 * ใช้ async function แทน new Promise(async) เพื่อป้องกัน unhandled rejection leak
 */
async function sendToWorker(type, payload, retries = 2, timeoutMs = 30000) {
  if (!dbWorker && type !== 'init') {
    await createWorker();
  }
  const WORKER_TIMEOUT = timeoutMs;
  const id = ++requestId;

  const responsePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Worker timeout (${WORKER_TIMEOUT / 1000}s): ${type}`));
      }
    }, WORKER_TIMEOUT);

    pendingRequests.set(id, { resolve, reject, timer });
  });

  try {
    if (!dbWorker) throw new Error('Worker is not available');
    dbWorker.postMessage({ type, payload, id });
  } catch (postError) {
    // ลบ pending ออกก่อน — timer cancel ด้วย
    const entry = pendingRequests.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      pendingRequests.delete(id);
    }

    if (retries > 0) {
      console.warn(`⚠️ PostMessage failed, restarting worker & retrying (${retries} left)...`);
      rejectAllPendingRequests('Worker postMessage failed — restarting');
      try { dbWorker.terminate(); } catch (e) { /* ignore */ }
      dbWorker = null;
      await createWorker();
      return sendToWorker(type, payload, retries - 1, timeoutMs);
    }
    throw postError;
  }

  return responsePromise;
}

/**
 * App lifecycle
 */
app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    // Set app path
    app.setPath('userData', path.join(app.getPath('appData'), 'rab-lem-rot-tro'));

    initDatabase();
    createWindow();
    await startLocalNetworkServer();
    await ensureAutoBackup(false);
    scheduleAutoBackup();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

  } catch (error) {
    console.error('❌ App ready error:', error);
    dialog.showErrorBox('Startup Error', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  cleanup();
});

process.on('SIGTERM', () => {
  isQuitting = true;
  cleanup();
  app.quit();
});

/**
 * Cleanup resources
 */
function cleanup() {
  try {
    if (isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.removeAllListeners('close'); } catch (e) { /* ignore */ }
    }

    // Clear pending requests
    rejectAllPendingRequests('App closing');

    if (localNetworkServer) {
      try { localNetworkServer.stop(); } catch (e) { /* ignore */ }
      localNetworkServer = null;
    }

    // Terminate worker
    if (dbWorker) {
      try {
        dbWorker.terminate();
      } catch (e) {
        // Ignore
      }
      dbWorker = null;
    }

    // Close database
    if (db) {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
      } catch (e) {
        // Ignore
      }
      db = null;
    }

    if (autoBackupTimer) {
      clearInterval(autoBackupTimer);
      autoBackupTimer = null;
    }

    if (memoryMonitorTimer) {
      clearInterval(memoryMonitorTimer);
      memoryMonitorTimer = null;
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// ==========================================
// IPC Handlers (All wrapped in Try-Catch)
// ==========================================

// Window Controls
ipcMain.on('win-minimize', () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  } catch (error) { console.error('minimize error:', error); }
});

ipcMain.on('win-maximize', () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  } catch (error) { console.error('maximize error:', error); }
});

ipcMain.on('win-close', () => {
  try { app.quit(); } catch (error) { console.error('close error:', error); }
});

ipcMain.handle('focus-window', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win && !win.isDestroyed()) {
      app.focus({ steal: true });
      if (win.isMinimized()) win.restore();
      win.show();
      win.moveTop();
      win.setFocusable(true);
      win.setAlwaysOnTop(true);
      win.focus();
      win.webContents.focus();
      win.setAlwaysOnTop(false);
      return true;
    }
  } catch (error) {
    console.error('focus-window error:', error);
  }
  return false;
});

ipcMain.handle('reset-window-focus', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!win || win.isDestroyed()) return false;

    win.blur();
    await new Promise(resolve => setTimeout(resolve, 40));

    app.focus({ steal: true });
    if (win.isMinimized()) win.restore();
    win.show();
    win.moveTop();
    win.setFocusable(true);
    win.setAlwaysOnTop(true);
    win.focus();
    win.webContents.focus();
    await new Promise(resolve => setTimeout(resolve, 30));
    win.setAlwaysOnTop(false);
    return true;
  } catch (error) {
    console.error('reset-window-focus error:', error);
  }
  return false;
});

// Database Operations (All through Worker)
ipcMain.handle('load-records', async (event, params) => {
  try {
    const { data } = await sendToWorker('search', params || {});
    return data || [];
  } catch (error) {
    console.error('❌ load-records error:', error);
    return [];
  }
});

ipcMain.handle('load-records-bundle', async (event, params) => {
  try {
    const { data } = await sendToWorker('searchBundle', params || {});
    return data || { records: [], total: 0, insights: { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] } };
  } catch (error) {
    console.error('load-records-bundle error:', error);
    return { records: [], total: 0, insights: { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] } };
  }
});

ipcMain.handle('get-records-count', async (event, params) => {
  try {
    const { data } = await sendToWorker('count', params || {});
    return data || 0;
  } catch (error) {
    console.error('get-records-count error:', error);
    return 0;
  }
});

ipcMain.handle('get-search-insights', async (event, params) => {
  try {
    const { data } = await sendToWorker('searchInsights', params || {});
    return data || { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] };
  } catch (error) {
    console.error('get-search-insights error:', error);
    return { totalMatched: 0, byType: {}, byStatus: {}, topBrands: [] };
  }
});

ipcMain.handle('save-records', async (event, payload) => {
  try {
    const records = payload.records || payload;
    const batchSize = payload.batchSize || 1000;

    const result = await sendToWorker('importBatch', { records, batchSize });
    
    // Broadcast refresh after successful import
    broadcastRefresh(event.sender.id);
    
    return result;
  } catch (error) {
    console.error('❌ save-records error:', error);
    console.error('❌ Error stack:', error.stack);
    throw error;
  }
});

// Helper: Broadcast refresh signal to all renderer windows
function broadcastRefresh(skipWebContentsId = null) {
  try {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (!win || win.isDestroyed()) return;
      const wc = win.webContents;
      // ข้าม sender เอง, ข้าม window ที่กำลัง navigate/load (webContents ยังไม่พร้อม)
      if (wc.id === skipWebContentsId) return;
      if (wc.isDestroyed() || wc.isLoading() || wc.isCrashed()) return;
      try {
        wc.send('refresh-required');
      } catch (e) {
        console.warn('⚠️ broadcastRefresh send failed for webContents', wc.id, e.message);
      }
    });
  } catch (error) {
    console.error('❌ broadcastRefresh error:', error);
  }
}

ipcMain.handle('delete-records', async (event, payload) => {
  try {
    const ids = payload.ids || payload;
    const sequenceId = payload.sequenceId;

    const result = await sendToWorker('deleteRecords', ids || []);
    broadcastRefresh(event.sender.id);

    return { ...result, sequenceId };
  } catch (error) {
    console.error('delete-records error:', error);
    throw error;
  }
});

ipcMain.handle('mark-received', async (event, payload) => {
  try {
    const ids = payload.ids || payload;
    const sequenceId = payload.sequenceId;
    
    const result = await sendToWorker('markReceived', ids || []);
    
    // Broadcast refresh after successful update
    broadcastRefresh(event.sender.id);
    
    return { ...result, sequenceId };
  } catch (error) {
    console.error('mark-received error:', error);
    throw error;
  }
});

ipcMain.handle('undo-received', async (event, payload) => {
  try {
    const ids = payload.ids || payload;
    const sequenceId = payload.sequenceId;
    
    const result = await sendToWorker('undoReceived', ids || []);
    
    // Broadcast refresh after successful update
    broadcastRefresh(event.sender.id);
    
    return { ...result, sequenceId };
  } catch (error) {
    console.error('undo-received error:', error);
    throw error;
  }
});


ipcMain.handle('mark-completed', async (event, payload) => {
  try {
    const ids = payload.ids || payload;
    const sequenceId = payload.sequenceId;
    const result = await sendToWorker('markCompleted', ids || []);
    broadcastRefresh(event.sender.id);
    return { ...result, sequenceId };
  } catch (error) {
    console.error('mark-completed error:', error);
    throw error;
  }
});

ipcMain.handle('mark-returned', async (event, payload) => {
  try {
    const ids = payload.ids || payload;
    const sequenceId = payload.sequenceId;
    const result = await sendToWorker('markReturned', ids || []);
    broadcastRefresh(event.sender.id);
    return { ...result, sequenceId };
  } catch (error) {
    console.error('mark-returned error:', error);
    throw error;
  }
});

ipcMain.handle('load-audit-log', async (event, payload) => {
  try {
    const { data } = await sendToWorker('loadAuditLog', payload || {});
    return data || [];
  } catch (error) {
    console.error('load-audit-log error:', error);
    throw error;
  }
});

ipcMain.handle('update-field', async (event, payload) => {
  try {
    const sequenceId = payload.sequenceId;
    const result = await sendToWorker('updateField', payload || {});
    
    // Broadcast refresh after successful update
    broadcastRefresh(event.sender.id);
    
    return { ...result, sequenceId };
  } catch (error) {
    console.error('update-field error:', error);
    throw error;
  }
});

ipcMain.handle('bulk-update-field', async (event, payload) => {
  try {
    const result = await sendToWorker('bulkUpdateField', payload || {});
    broadcastRefresh(event.sender.id);
    return result;
  } catch (error) {
    console.error('bulk-update-field error:', error);
    throw error;
  }
});

// Settings
ipcMain.handle('load-settings', async () => {
  try {
    const { data } = await sendToWorker('loadSettings');
    return data || {};
  } catch (error) {
    console.error('load-settings error:', error);
    return {};
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const result = await sendToWorker('saveSettings', settings || {});
    return result;
  } catch (error) {
    console.error('save-settings error:', error);
    throw error;
  }
});

ipcMain.handle('get-app-version', async () => app.getVersion());

ipcMain.handle('get-network-server-status', async () => {
  if (!localNetworkServer) {
    return await startLocalNetworkServer();
  }
  return localNetworkServer.getStatus();
});

ipcMain.handle('regenerate-network-room-code', async () => {
  if (!localNetworkServer) {
    await startLocalNetworkServer();
  }
  return localNetworkServer ? (() => {
    const status = localNetworkServer.regenerateRoomCode();
    persistRoomCode(status?.roomCode);
    return status;
  })() : { ok: false };
});

ipcMain.handle('set-network-room-code', async (event, payload = {}) => {
  try {
    if (!localNetworkServer) {
      await startLocalNetworkServer();
    }
    if (!localNetworkServer) throw new Error('ระบบเชื่อมต่อเครื่องรองยังไม่พร้อม');
    const status = localNetworkServer.setRoomCode(payload?.roomCode);
    persistRoomCode(status?.roomCode);
    return status;
  } catch (error) {
    console.error('set-network-room-code error:', error);
    throw error;
  }
});

ipcMain.handle('disconnect-network-client', async (_event, payload = {}) => {
  try {
    if (!localNetworkServer) await startLocalNetworkServer();
    if (!localNetworkServer) throw new Error('ระบบเชื่อมต่อเครื่องรองยังไม่พร้อม');
    return localNetworkServer.disconnectClient(payload?.clientKey, payload?.reason);
  } catch (error) {
    console.error('disconnect-network-client error:', error);
    throw error;
  }
});

ipcMain.handle('allow-network-client', async (_event, payload = {}) => {
  try {
    if (!localNetworkServer) await startLocalNetworkServer();
    if (!localNetworkServer) throw new Error('ระบบเชื่อมต่อเครื่องรองยังไม่พร้อม');
    return localNetworkServer.allowClient(payload?.clientKey);
  } catch (error) {
    console.error('allow-network-client error:', error);
    throw error;
  }
});

ipcMain.handle('check-for-updates', async (event, payload) => {
  try {
    return await resolveUpdateManifest(payload?.manifestUrl);
  } catch (error) {
    console.error('check-for-updates error:', error);
    throw error;
  }
});

ipcMain.handle('download-and-install-update', async (event, payload) => {
  try {
    const updateInfo = await resolveUpdateManifest(payload?.manifestUrl);
    if (!updateInfo.available) {
      return { success: false, message: 'ยังไม่มีเวอร์ชันใหม่' };
    }

    const installerPath = await downloadInstaller(updateInfo);
    launchInstaller(installerPath);
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 500);

    return { success: true, installerPath, version: updateInfo.latestVersion };
  } catch (error) {
    console.error('download-and-install-update error:', error);
    throw error;
  }
});

// Dashboard Stats
ipcMain.handle('get-dashboard-stats', async () => {
  try {
    const { data } = await sendToWorker('loadStats');
    return data || { today: 0, pending: 0, received: 0, byType: [], daily: [] };
  } catch (error) {
    console.error('get-dashboard-stats error:', error);
    return { today: 0, pending: 0, received: 0, byType: [], daily: [] };
  }
});

// Excel Dialog & Parse
ipcMain.handle('open-excel-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      app.focus({ steal: true });
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.focus();
    }
    if (result.canceled || result.filePaths.length === 0) return null;
    return rememberAllowedExcelFile(result.filePaths[0]);
  } catch (error) {
    console.error('open-excel-dialog error:', error);
    return null;
  }
});

ipcMain.handle('confirm-dialog', async (event, payload = {}) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showMessageBox(win, {
      type: payload.type || 'question',
      title: payload.title || 'ยืนยันการทำรายการ',
      message: payload.message || 'ยืนยันหรือไม่',
      detail: payload.detail || '',
      buttons: Array.isArray(payload.buttons) && payload.buttons.length > 0 ? payload.buttons : ['ยืนยัน', 'ยกเลิก'],
      defaultId: typeof payload.defaultId === 'number' ? payload.defaultId : 0,
      cancelId: typeof payload.cancelId === 'number' ? payload.cancelId : 1,
      noLink: true,
      normalizeAccessKeys: true
    });

    if (win && !win.isDestroyed()) {
      app.focus({ steal: true });
      win.show();
      win.focus();
      win.webContents.focus();
    }

    return {
      confirmed: result.response === (typeof payload.confirmedIndex === 'number' ? payload.confirmedIndex : 0),
      response: result.response,
      checkboxChecked: Boolean(result.checkboxChecked)
    };
  } catch (error) {
    console.error('confirm-dialog error:', error);
    return { confirmed: false, response: -1, checkboxChecked: false };
  }
});

ipcMain.handle('parse-excel', async (event, input) => {
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — ป้องกัน RAM พุ่ง
  try {
    let workbook;

    // Accept both file path and arrayBuffer (for drag-and-drop)
    if (typeof input === 'string') {
      // File path mode
      const safeInput = assertAllowedExcelFile(input);
      if (!fs.existsSync(safeInput)) {
        return { success: false, error: 'File not found' };
      }
      const stat = fs.statSync(safeInput);
      if (stat.size > MAX_FILE_SIZE) {
        return { success: false, error: `ไฟล์ใหญ่เกินไป (${(stat.size / 1024 / 1024).toFixed(1)}MB) — รองรับสูงสุด 50MB` };
      }
      workbook = xlsx.readFile(safeInput, {
        cellDates: true,
        cellStyles: false,
        cellNF: false,
        cellText: false,
        sheetStubs: false,
        codepage: 65001
      });
    } else if (input && input.type === 'Buffer' && input.data) {
      // ArrayBuffer mode (from drag-and-drop)
      const buffer = Buffer.from(input.data);
      if (buffer.length > MAX_FILE_SIZE) {
        return { success: false, error: `ไฟล์ใหญ่เกินไป (${(buffer.length / 1024 / 1024).toFixed(1)}MB) — รองรับสูงสุด 50MB` };
      }
      workbook = xlsx.read(buffer, {
        type: 'buffer',
        cellDates: true,
        cellText: false,
        codepage: 65001
      });
    } else {
      console.error('❌ Invalid input:', input);
      return { success: false, error: 'Invalid input' };
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    
    const jsonData = xlsx.utils.sheet_to_json(firstSheet, {
      header: 1,
      defval: '',
      raw: false
    });
    
    return {
      success: true,
      data: jsonData,
      sheetName: workbook.SheetNames[0],
      sheetCount: workbook.SheetNames.length,
      sheetNames: workbook.SheetNames
    };
  } catch (error) {
    console.error('❌ parse-excel error:', error);
    console.error('❌ Error stack:', error.stack);
    return { success: false, error: error.message };
  }
});

// Delete File
// Parse Excel Sheet by Index
ipcMain.handle('parse-excel-sheet', async (event, input) => {
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — ป้องกัน RAM พุ่ง
  try {
    let workbook;
    const { data: inputData, sheetIndex } = input;
    
    if (typeof inputData === 'string') {
      // File path mode
      const safeInput = assertAllowedExcelFile(inputData);
      if (!fs.existsSync(safeInput)) {
        return { success: false, error: 'File not found' };
      }
      const stat = fs.statSync(safeInput);
      if (stat.size > MAX_FILE_SIZE) {
        console.error('parse-excel-sheet file too large:', stat.size);
        return { success: false, error: `ไฟล์ใหญ่เกินไป (${(stat.size / 1024 / 1024).toFixed(1)}MB) — รองรับสูงสุด 50MB` };
      }
      workbook = xlsx.readFile(safeInput, {
        cellDates: true,
        cellStyles: false,
        cellNF: false,
        cellText: false,
        sheetStubs: false,
        codepage: 65001
      });
    } else if (inputData && inputData.type === 'Buffer' && inputData.data) {
      // ArrayBuffer mode
      const buffer = Buffer.from(inputData.data);
      if (buffer.length > MAX_FILE_SIZE) {
        console.error('parse-excel-sheet buffer too large:', buffer.length);
        return { success: false, error: `ไฟล์ใหญ่เกินไป (${(buffer.length / 1024 / 1024).toFixed(1)}MB) — รองรับสูงสุด 50MB` };
      }
      workbook = xlsx.read(buffer, { 
        type: 'buffer',
        cellDates: true,
        cellText: false,
        codepage: 65001
      });
    } else {
      return { success: false, error: 'Invalid input' };
    }
    
    const sheetIdx = Math.max(0, Math.min(sheetIndex || 0, workbook.SheetNames.length - 1));
    const sheet = workbook.Sheets[workbook.SheetNames[sheetIdx]];
    const jsonData = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false
    });
    return {
      success: true,
      data: jsonData,
      sheetName: workbook.SheetNames[sheetIdx],
      sheetIndex: sheetIdx
    };
  } catch (error) {
    console.error('parse-excel-sheet error:', error);
    return { success: false, error: error.message };
  }
});

// Delete File
ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    const safePath = assertAllowedExcelFile(filePath);
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
      allowedExcelFilePaths.delete(safePath);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Export CSV
ipcMain.handle('export-csv', async (event, params) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export CSV',
      defaultPath: `export_${new Date().toISOString().split('T')[0]}.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (result.canceled || !result.filePath) return null;

    const { data } = await sendToWorker('exportData', params || {});
    const BOM = '\uFEFF';
    const headers = ['id', 'plate', 'province', 'type', 'brand', 'name', 'phone', 'status', 'importedAt', 'receivedAt'];
    const csvRows = [headers.join(',')];

    for (const row of data) {
      const values = headers.map(h => {
        const val = row[h] || '';
        return `"${val.toString().replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    }

    fs.writeFileSync(result.filePath, BOM + csvRows.join('\n'), 'utf-8');
    return { success: true, path: result.filePath, count: data.length };
  } catch (error) {
    console.error('export-csv error:', error);
    throw error;
  }
});

ipcMain.handle('export-print-pdf', async (event, payload = {}) => {
  if (isExportingPdf) throw new Error('กำลังบันทึก PDF อยู่ กรุณารอสักครู่');
  isExportingPdf = true;
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!win || win.isDestroyed()) {
      throw new Error('ไม่พบหน้าต่างสำหรับสร้าง PDF');
    }

    const result = await dialog.showSaveDialog(win, {
      title: 'บันทึกไฟล์ PDF',
      defaultPath: `รับเล่มรถ-${new Date().toISOString().split('T')[0]}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (result.canceled || !result.filePath) return null;

    const pdfBuffer = await Promise.race([
      win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        landscape: false,
        margins: { marginType: 'printableArea' },
        preferCSSPageSize: true
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PDF export timeout (25s) — ลอง reload แล้วลองใหม่')), 25000)
      )
    ]);

    fs.writeFileSync(result.filePath, pdfBuffer);
    return {
      success: true,
      path: result.filePath,
      bytes: pdfBuffer.length,
      rowCount: Number(payload?.rowCount || 0)
    };
  } catch (error) {
    console.error('export-print-pdf error:', error);
    throw error;
  } finally {
    isExportingPdf = false;
  }
});

// Database Management
ipcMain.handle('vacuum-database', async () => {
  try {
    // VACUUM อาจใช้เวลานานบน DB ใหญ่ — timeout 120s, no retry
    await sendToWorker('vacuum', undefined, 0, 120000);
    return { success: true };
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('purge-old-data', async () => {
  try {
    const result = await sendToWorker('purgeOldData', {});
    return result;
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('check-integrity', async () => {
  try {
    const result = await sendToWorker('checkIntegrity');
    const rows = Array.isArray(result?.data) ? result.data : [result?.data];
    const firstRow = rows[0];

    if (typeof firstRow === 'string') {
      return firstRow;
    }

    if (firstRow && typeof firstRow === 'object') {
      return String(firstRow.integrity_check || Object.values(firstRow)[0] || 'unknown');
    }

    return 'unknown';
  } catch (error) {
    return 'error';
  }
});

ipcMain.handle('get-system-health', async () => {
  try {
    return await getSystemHealth();
  } catch (error) {
    console.error('get-system-health error:', error);
    throw error;
  }
});

ipcMain.handle('create-backup-now', async () => {
  try {
    const result = await createDatabaseBackup({ automatic: false });
    return { success: true, ...result };
  } catch (error) {
    console.error('create-backup-now error:', error);
    throw error;
  }
});

ipcMain.handle('import-database-file', async (event) => {
  let selectedFile = null;
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(win, {
      title: 'เลือกไฟล์ฐานข้อมูลจากเครื่องเดิม',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return { cancelled: true, success: false };
    }

    selectedFile = result.filePaths[0];
    const sourceInfo = validateDatabaseFile(selectedFile);
    const targetPath = getDatabasePath();

    if (path.resolve(selectedFile) === path.resolve(targetPath)) {
      throw new Error('ไฟล์ที่เลือกคือฐานข้อมูลที่ใช้งานอยู่แล้ว');
    }

    const currentHealth = await getSystemHealth();
    const confirmResult = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'ยืนยันการย้ายฐานข้อมูล',
      message: 'ต้องการนำฐานข้อมูลนี้มาใช้แทนฐานข้อมูลปัจจุบันหรือไม่?',
      detail: [
        `ไฟล์ใหม่: ${sourceInfo.fileName}`,
        `จำนวนข้อมูลในไฟล์ใหม่: ${sourceInfo.recordCount.toLocaleString()} รายการ`,
        `ฐานข้อมูลปัจจุบัน: ${Number(currentHealth.totalRecords || 0).toLocaleString()} รายการ`,
        '',
        'ระบบจะสำรองฐานข้อมูลปัจจุบันให้อัตโนมัติก่อนแทนที่ และรีเฟรชหน้ารายการหลังนำเข้าเสร็จ'
      ].join('\n'),
      buttons: ['นำเข้าและแทนที่', 'ยกเลิก'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });

    if (confirmResult.response !== 0) {
      return { cancelled: true, success: false, sourceInfo };
    }

    const backupResult = await createDatabaseBackup({ automatic: false });

    shutdownDatabaseForReplacement();
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    removeSQLiteSidecarFiles(targetPath);
    fs.copyFileSync(selectedFile, targetPath);
    removeSQLiteSidecarFiles(targetPath);

    const activeDbPath = reinitializeDatabaseAfterReplacement();
    const importedHealth = await getSystemHealth();
    broadcastRefresh(event.sender.id);

    return {
      success: true,
      sourceInfo,
      backupPath: backupResult.backupPath,
      dbPath: activeDbPath,
      totalRecords: Number(importedHealth.totalRecords || 0),
      integrity: importedHealth.integrity
    };
  } catch (error) {
    console.error('import-database-file error:', error);
    try {
      if (!db) reinitializeDatabaseAfterReplacement();
    } catch (reopenError) {
      console.error('Failed to reinitialize database after import error:', reopenError);
    }
    throw error;
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        app.focus({ steal: true });
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.focus();
      } catch (error) { /* ignore */ }
    }
  }
});

// Global Error Handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system-error', { message: error.message });
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});
