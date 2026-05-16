const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, 'renderer-record-actions.js');

delete require.cache[require.resolve(modulePath)];
global.window = {};
require(modulePath);
const moduleApi = global.window.RendererRecordActionsModule;
delete global.window;

async function testDeleteSelectedSuccessRecovery() {
  const calls = [];
  const State = {
    selectedIds: new Set([1, 2]),
    records: [{ id: 1 }, { id: 2 }, { id: 3 }],
    totalCount: 3
  };

  await moduleApi.deleteSelected({
    State,
    getNextSequenceId() { return 11; },
    showNotification(message, type) { calls.push(['notify', message, type]); },
    api: {
      async confirmDialog() { return { confirmed: true }; },
      async deleteRecords(ids, seqId) { calls.push(['deleteRecords', ids.slice(), seqId]); }
    },
    renderTable() { calls.push(['renderTable']); },
    updatePagination() { calls.push(['updatePagination']); },
    trackRequest(seqId) { calls.push(['trackRequest', seqId]); },
    isStaleRequest() { return false; },
    clearSelection() { State.selectedIds.clear(); calls.push(['clearSelection']); },
    async reloadCurrentListPage() { calls.push(['reloadCurrentListPage']); },
    recoverSearchInteraction() { calls.push(['recoverSearchInteraction']); },
    updateStats() { calls.push(['updateStats']); },
    completeRequest(seqId) { calls.push(['completeRequest', seqId]); }
  });

  assert.deepStrictEqual(State.records, [{ id: 3 }], 'selected records should be removed optimistically');
  assert.strictEqual(State.totalCount, 1, 'total count should shrink after optimistic deletion');
  assert.strictEqual(State.selectedIds.size, 0, 'selection should be cleared after successful bulk delete');
  assert.ok(calls.find(entry => entry[0] === 'deleteRecords'), 'deleteRecords should be invoked');

  const clearIndex = calls.findIndex(entry => entry[0] === 'clearSelection');
  const reloadIndex = calls.findIndex(entry => entry[0] === 'reloadCurrentListPage');
  const recoverIndex = calls.findIndex(entry => entry[0] === 'recoverSearchInteraction');
  assert.ok(clearIndex >= 0 && reloadIndex > clearIndex, 'selection should clear before reloading the list');
  assert.ok(recoverIndex > reloadIndex, 'search interaction should recover after the list reload finishes');
  assert.ok(calls.some(entry => entry[0] === 'notify' && entry[2] === 'success'), 'success notification should be shown');
}

async function testDeleteSelectedStaleRecovery() {
  const calls = [];
  const State = {
    selectedIds: new Set([1, 2]),
    records: [{ id: 1 }, { id: 2 }, { id: 3 }],
    totalCount: 3
  };

  await moduleApi.deleteSelected({
    State,
    getNextSequenceId() { return 22; },
    showNotification(message, type) { calls.push(['notify', message, type]); },
    api: {
      async confirmDialog() { return { confirmed: true }; },
      async deleteRecords() { calls.push(['deleteRecords']); }
    },
    renderTable() { calls.push(['renderTable']); },
    updatePagination() { calls.push(['updatePagination']); },
    trackRequest() { calls.push(['trackRequest']); },
    isStaleRequest() { return true; },
    clearSelection() { State.selectedIds.clear(); calls.push(['clearSelection']); },
    async reloadCurrentListPage() { calls.push(['reloadCurrentListPage']); },
    recoverSearchInteraction() { calls.push(['recoverSearchInteraction']); },
    updateStats() { calls.push(['updateStats']); },
    completeRequest() { calls.push(['completeRequest']); }
  });

  assert.strictEqual(State.selectedIds.size, 0, 'selection should still clear for stale responses');
  assert.ok(calls.some(entry => entry[0] === 'recoverSearchInteraction'), 'stale delete should still recover search interaction');
  assert.ok(!calls.some(entry => entry[0] === 'reloadCurrentListPage'), 'stale delete should skip reload');
  assert.ok(!calls.some(entry => entry[0] === 'notify' && entry[2] === 'success'), 'stale delete should skip success notification');
}

async function testDeleteRecordFailureRecovery() {
  const calls = [];
  const originalRecord = { id: 1, plate: 'กข1234' };
  const State = {
    selectedIds: new Set([1]),
    records: [originalRecord, { id: 2, plate: 'กข5678' }],
    totalCount: 2,
    rollbackStack: new Map()
  };

  await moduleApi.deleteRecord({
    State,
    api: {
      async confirmDialog() { return { confirmed: true }; },
      async deleteRecords() { throw new Error('db down'); }
    },
    getNextSequenceId() { return 33; },
    pushRollback(id, payload) { State.rollbackStack.set(id, payload); calls.push(['pushRollback', id]); },
    renderTable() { calls.push(['renderTable']); },
    updatePagination() { calls.push(['updatePagination']); },
    trackRequest() { calls.push(['trackRequest']); },
    isStaleRequest() { return false; },
    clearSelection() { State.selectedIds.clear(); calls.push(['clearSelection']); },
    async reloadCurrentListPage() { calls.push(['reloadCurrentListPage']); },
    recoverSearchInteraction() { calls.push(['recoverSearchInteraction']); },
    showUndoToast(message) { calls.push(['showUndoToast', message]); },
    updateStats() { calls.push(['updateStats']); },
    executeRollback() { return true; },
    showNotification(message, type) { calls.push(['notify', message, type]); },
    loadData() { calls.push(['loadData']); },
    completeRequest() { calls.push(['completeRequest']); }
  }, 1);

  assert.strictEqual(State.totalCount, 2, 'failed delete should restore total count');
  assert.strictEqual(State.records.length, 2, 'failed delete should restore records');
  assert.deepStrictEqual(State.records[0], originalRecord, 'restored record should match original optimistic removal target');
  assert.ok(calls.some(entry => entry[0] === 'recoverSearchInteraction'), 'failed single delete should recover search interaction');
  assert.ok(calls.some(entry => entry[0] === 'notify' && entry[2] === 'error'), 'failed single delete should show an error notification');
  assert.ok(!calls.some(entry => entry[0] === 'showUndoToast'), 'failed delete should not show success undo toast');
}

(async () => {
  await testDeleteSelectedSuccessRecovery();
  await testDeleteSelectedStaleRecovery();
  await testDeleteRecordFailureRecovery();
  console.log('✅ record action recovery behavior tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
