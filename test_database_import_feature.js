const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.ok(preload.includes('importDatabaseFile'), 'preload must expose importDatabaseFile through contextBridge');
assert.ok(main.includes("ipcMain.handle('import-database-file'"), 'main process must register import-database-file IPC handler');
assert.ok(main.includes('validateDatabaseFile'), 'database import must validate selected SQLite database before replacing');
assert.ok(main.includes('createDatabaseBackup({ automatic: false })'), 'database import must create a manual backup before replacement');
assert.ok(main.includes('shutdownDatabaseForReplacement'), 'database import must close worker/main DB before replacement');
assert.ok(main.includes('removeSQLiteSidecarFiles'), 'database import must remove stale WAL/SHM sidecar files during replacement');
assert.ok(renderer.includes('async function importDatabaseFile()'), 'renderer must provide global importDatabaseFile handler for settings button');
assert.ok(renderer.includes('updateDatabaseTransferStatus'), 'renderer must show database transfer status feedback');
assert.ok(renderer.includes('escapeHtml(result.backupPath'), 'renderer must escape import result paths before injecting HTML');
assert.ok(html.includes('database-transfer-card'), 'settings page must include database transfer card');
assert.ok(html.includes('เลือกและนำเข้าฐานข้อมูล'), 'settings page must expose a clear import database action');

console.log('✅ database import feature wiring tests passed');
