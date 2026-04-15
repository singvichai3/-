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
const xlsx = require('xlsx');

let mainWindow;
let dbWorker;
let db;
let requestId = 0;
const pendingRequests = new Map();
let isQuitting = false;

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

    // Memory monitoring
    setInterval(() => {
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
    dbWorker = new Worker(path.join(__dirname, 'db-worker.js'));

    const dbPath = global.dbPath || (app.getPath('userData') + '/database.db');
    sendToWorker('init', { dbPath }).catch(err => {
      console.error('❌ Worker init failed, retrying...', err);
      setTimeout(() => createWorker(), 1000);
    });

    dbWorker.on('message', (msg) => handleWorkerMessage(msg));
    dbWorker.on('error', (err) => handleWorkerError(err));
    dbWorker.on('exit', (code) => handleWorkerExit(code));

  } catch (error) {
    console.error('❌ createWorker error:', error);
    setTimeout(() => createWorker(), 2000);
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
      const { resolve, reject } = pendingRequests.get(id);
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
 * Handle worker errors with auto-restart
 */
function handleWorkerError(error) {
  console.error('❌ Worker error, restarting...', error);
  if (dbWorker) {
    try {
      dbWorker.terminate();
    } catch (e) {
      // Ignore termination errors
    }
  }
  setTimeout(() => createWorker(), 1000);
}

/**
 * Handle worker exit with auto-restart
 */
function handleWorkerExit(code) {
  console.warn(`⚠️ Worker exited with code ${code}, restarting...`);
  if (!isQuitting) {
    setTimeout(() => createWorker(), 2000);
  }
}

/**
 * Send message to worker with timeout and retry
 */
function sendToWorker(type, payload, retries = 2) {
  return new Promise(async (resolve, reject) => {
    const id = ++requestId;
    const timeout = 30000;

    pendingRequests.set(id, {
      resolve,
      reject,
      timer: setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`Worker timeout: ${type}`));
        }
      }, timeout)
    });

    try {
      dbWorker.postMessage({ type, payload, id });
    } catch (error) {
      pendingRequests.delete(id);
      if (retries > 0) {
        console.warn(`⚠️ PostMessage failed, retrying (${retries} left)...`);
        setTimeout(() => {
          createWorker();
          setTimeout(() => {
            sendToWorker(type, payload, retries - 1).then(resolve).catch(reject);
          }, 500);
        }, 100);
      } else {
        reject(error);
      }
    }
  });
}

/**
 * App lifecycle
 */
app.whenReady().then(async () => {
  try {
    // Set app path
    app.setPath('userData', path.join(app.getPath('appData'), 'rab-lem-rot-tro'));

    initDatabase();
    createWindow();

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
    // Clear pending requests
    pendingRequests.forEach(({ reject }) => reject(new Error('App closing')));
    pendingRequests.clear();

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

// Database Operations (All through Worker)
ipcMain.handle('load-records', async (event, params) => {
  try {
    console.log('📤 load-records called with params:', params);
    const { data } = await sendToWorker('search', params || {});
    console.log('📥 load-records returned:', Array.isArray(data) ? data.length : 'N/A', 'records');
    return data || [];
  } catch (error) {
    console.error('❌ load-records error:', error);
    return [];
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
    console.log('📥 save-records called, payload type:', typeof payload);
    const records = payload.records || payload;
    const batchSize = payload.batchSize || 1000;
    console.log('📊 Records count:', Array.isArray(records) ? records.length : 'N/A');
    console.log('📊 Batch size:', batchSize);

    const result = await sendToWorker('importBatch', { records, batchSize });
    console.log('✅ save-records result:', result);
    
    // Broadcast refresh after successful import
    broadcastRefresh();
    
    return result;
  } catch (error) {
    console.error('❌ save-records error:', error);
    console.error('❌ Error stack:', error.stack);
    throw error;
  }
});

// Helper: Broadcast refresh signal to all renderer windows
function broadcastRefresh() {
  try {
    // Get all webContents (renderer windows)
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('refresh-required');
      }
    });
    console.log('🔄 Broadcast refresh signal to', windows.length, 'windows');
  } catch (error) {
    console.error('❌ broadcastRefresh error:', error);
  }
}

ipcMain.handle('delete-records', async (event, payload) => {
  try {
    const ids = payload.ids || payload;
    const sequenceId = payload.sequenceId;

    const result = await sendToWorker('deleteRecords', ids || []);
    broadcastRefresh();

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
    broadcastRefresh();
    
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
    broadcastRefresh();
    
    return { ...result, sequenceId };
  } catch (error) {
    console.error('undo-received error:', error);
    throw error;
  }
});

ipcMain.handle('update-field', async (event, payload) => {
  try {
    const sequenceId = payload.sequenceId;
    const result = await sendToWorker('updateField', payload || {});
    
    // Broadcast refresh after successful update
    broadcastRefresh();
    
    return { ...result, sequenceId };
  } catch (error) {
    console.error('update-field error:', error);
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
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  } catch (error) {
    console.error('open-excel-dialog error:', error);
    return null;
  }
});

ipcMain.handle('parse-excel', async (event, input) => {
  try {
    console.log('📂 parse-excel called, input type:', typeof input);
    console.log('📂 Input structure:', JSON.stringify(input, null, 2).substring(0, 200));
    
    let workbook;

    // Accept both file path and arrayBuffer (for drag-and-drop)
    if (typeof input === 'string') {
      // File path mode
      console.log('📁 File path mode:', input);
      if (!fs.existsSync(input)) {
        return { success: false, error: 'File not found' };
      }
      console.log('📖 Reading file...');
      workbook = xlsx.readFile(input, {
        cellDates: true,
        cellStyles: false,
        cellNF: false,
        cellText: false,
        sheetStubs: false,
        codepage: 65001
      });
    } else if (input && input.type === 'Buffer' && input.data) {
      // ArrayBuffer mode (from drag-and-drop)
      console.log('📦 Buffer mode, data length:', input.data.length);
      const buffer = Buffer.from(input.data);
      console.log('📖 Reading buffer...');
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

    console.log('📊 Workbook sheets:', workbook.SheetNames);
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    console.log('📊 First sheet rows:', Object.keys(firstSheet).length);
    
    const jsonData = xlsx.utils.sheet_to_json(firstSheet, {
      header: 1,
      defval: '',
      raw: false
    });
    
    console.log('✅ Parsed', jsonData.length, 'rows');

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
  try {
    let workbook;
    const { data: inputData, sheetIndex } = input;
    
    if (typeof inputData === 'string') {
      // File path mode
      if (!fs.existsSync(inputData)) {
        return { success: false, error: 'File not found' };
      }
      workbook = xlsx.readFile(inputData, {
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
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
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

// Database Management
ipcMain.handle('vacuum-database', async () => {
  try {
    await sendToWorker('vacuum');
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
    return result.data;
  } catch (error) {
    return ['error'];
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
