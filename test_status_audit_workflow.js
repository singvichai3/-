const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function assertIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message || `Expected source to include ${needle}`);
}

function testSchemaHasLifecycleFieldsAndAuditLog() {
  const dbJs = read('db.js');
  const workerJs = read('db-worker.js');

  for (const source of [dbJs, workerJs]) {
    assertIncludes(source, 'completedAt TEXT', 'records schema/migration should include completedAt timestamp');
    assertIncludes(source, 'returnedAt TEXT', 'records schema/migration should include returnedAt timestamp');
    assertIncludes(source, 'CREATE TABLE IF NOT EXISTS audit_log', 'schema should create audit_log table');
    assertIncludes(source, 'idx_audit_record_time', 'audit_log should be indexed by record/time for investigations');
  }
}

function testWorkerCentralizesStatusTransitionsAndAuditsThem() {
  const workerJs = read('db-worker.js');

  assertIncludes(workerJs, 'const STATUS_TRANSITIONS', 'worker should define a canonical status transition map');
  assertIncludes(workerJs, 'function transitionRecordStatus', 'worker should centralize status transition logic');
  assertIncludes(workerJs, 'function writeAuditLog', 'worker should write audit entries for status changes');
  assertIncludes(workerJs, "'completed'", 'worker should support completed status');
  assertIncludes(workerJs, "'returned'", 'worker should support returned status');
  assertIncludes(workerJs, "case 'markCompleted'", 'IPC worker should expose markCompleted command');
  assertIncludes(workerJs, "case 'markReturned'", 'IPC worker should expose markReturned command');
}

function testMainAndPreloadExposeWorkflowActions() {
  const mainJs = read('main.js');
  const preloadJs = read('preload.js');

  assertIncludes(mainJs, "ipcMain.handle('mark-completed'", 'main process should expose mark-completed IPC');
  assertIncludes(mainJs, "ipcMain.handle('mark-returned'", 'main process should expose mark-returned IPC');
  assertIncludes(mainJs, "ipcMain.handle('load-audit-log'", 'main process should expose load-audit-log IPC');

  assertIncludes(preloadJs, 'markCompleted:', 'preload should expose markCompleted API');
  assertIncludes(preloadJs, 'markReturned:', 'preload should expose markReturned API');
  assertIncludes(preloadJs, 'loadAuditLog:', 'preload should expose loadAuditLog API');
}

function testRendererShowsNewWorkflowStates() {
  const rendererJs = read('renderer.js');
  const actionsJs = read('renderer-record-actions.js');

  assertIncludes(rendererJs, "status === 'completed'", 'renderer row should render completed status');
  assertIncludes(rendererJs, "status === 'returned'", 'renderer row should render returned status');
  assertIncludes(rendererJs, 'markCompleted(', 'renderer should provide markCompleted UI action');
  assertIncludes(rendererJs, 'markReturned(', 'renderer should provide markReturned UI action');
  assertIncludes(actionsJs, 'async markCompleted', 'record actions module should implement markCompleted');
  assertIncludes(actionsJs, 'async markReturned', 'record actions module should implement markReturned');
  assertIncludes(actionsJs, "transitionStatus(ctx, id, 'returned', 'markReturned', '✅ คืนเล่มแล้ว', 'markReturned')", 'markReturned should pass api method, success message, and action type in the correct order');
  assertIncludes(rendererJs, 'markCompletedFromReturned(', 'returned rows should have a UI recovery path back to completed');
  assertIncludes(rendererJs, 'reopenCompletedAsReceived(', 'completed rows should have a UI recovery path back to received');
}

testSchemaHasLifecycleFieldsAndAuditLog();
testWorkerCentralizesStatusTransitionsAndAuditsThem();
testMainAndPreloadExposeWorkflowActions();
testRendererShowsNewWorkflowStates();

console.log('✅ status audit workflow tests passed');
