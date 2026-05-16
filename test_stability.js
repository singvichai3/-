const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rendererJs = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const secondaryMainJs = fs.readFileSync(path.join(__dirname, 'secondary-main.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

assert.ok(packageJson.scripts['test:stability'], 'package.json should expose a test:stability script');

assert.ok(!rendererJs.includes('prompt('), 'renderer should not use blocking prompt() dialogs');
assert.ok(indexHtml.includes('text-prompt-modal'), 'index.html should provide a custom text prompt modal');
assert.ok(rendererJs.includes('openTextPrompt('), 'renderer should open a non-blocking text prompt modal');
assert.ok(rendererJs.includes('closeTextPrompt('), 'renderer should close the custom text prompt modal');

assert.ok(mainJs.includes("return sendToWorker(type, payload, retries - 1, timeoutMs);"), 'worker retry should preserve timeoutMs');
assert.ok(mainJs.includes("ipcMain.handle('parse-excel-sheet'"), 'main process should handle parse-excel-sheet');
assert.ok(mainJs.includes('parse-excel-sheet file too large') || mainJs.includes('parse-excel-sheet buffer too large'), 'parse-excel-sheet should guard oversized inputs');

assert.ok(mainJs.includes('let memoryMonitorTimer = null;'), 'main process should keep memory monitor timer handle');
assert.ok(mainJs.includes('memoryMonitorTimer = setInterval('), 'main process memory monitor should assign interval handle');
assert.ok(mainJs.includes('clearInterval(memoryMonitorTimer);'), 'main process cleanup should clear memory monitor timer so app exits');
assert.ok(mainJs.includes('if (!hasSingleInstanceLock) return;'), 'main process should not initialize windows/workers in a duplicate instance');
assert.ok(secondaryMainJs.includes('if (!singleInstanceLock) return;'), 'secondary app should not initialize a duplicate instance');
assert.ok(secondaryMainJs.includes("ipcMain.on('win-close', () => {\n  try { app.quit();"), 'secondary close button should quit the app, not only close the window');

const trackedMainIntervals = mainJs.match(/(?:autoBackupTimer|memoryMonitorTimer)\s*=\s*setInterval\s*\(/g) || [];
assert.strictEqual(trackedMainIntervals.length, 2, 'main process intervals should be assigned to cleanup handles');
assert.ok(!/^\s*setInterval\s*\(/m.test(mainJs), 'main process should not create bare untracked setInterval handles');

assert.ok(mainJs.includes('let workerInitPromise = null;'), 'main process should track worker init promise for safe retries');
assert.ok(mainJs.includes("sendToWorker('init', { dbPath }, 0, 30000)"), 'worker init should not recursively retry itself through normal request retry');
assert.ok(mainJs.includes('await createWorker();'), 'postMessage retry should wait for worker init before resending commands');
assert.ok(mainJs.includes('dbWorker.removeAllListeners()'), 'worker restart/exit should detach old worker listeners');
assert.ok(mainJs.includes('workerInitPromise = null;'), 'worker error/exit should clear worker init promise state');

const formatDateCount = (rendererJs.match(/function formatDate\(/g) || []).length;
const formatDateTimeCount = (rendererJs.match(/function formatDateTime\(/g) || []).length;
assert.strictEqual(formatDateCount, 1, 'renderer should declare formatDate only once');
assert.strictEqual(formatDateTimeCount, 1, 'renderer should declare formatDateTime only once');

console.log('✅ stability tests passed');
