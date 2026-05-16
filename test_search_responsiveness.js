const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rendererJs = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const recordActionsJs = fs.readFileSync(path.join(__dirname, 'renderer-record-actions.js'), 'utf8');
const searchWorkflowJs = fs.readFileSync(path.join(__dirname, 'renderer-search-workflow.js'), 'utf8');
const searchLoadCoordinationJs = fs.readFileSync(path.join(__dirname, 'renderer-search-load-coordination.js'), 'utf8');

assert.ok(searchLoadCoordinationJs.includes('if (State.pendingLoadOptions) {'), 'loadData should queue pending loads when a request arrives mid-flight');
assert.ok(searchLoadCoordinationJs.includes('loadData(queuedOptions);') || searchLoadCoordinationJs.includes('while (State.pendingLoadOptions)'), 'loadData should restart or drain queued searches after finishing');
assert.ok(recordActionsJs.includes('clearSelection();\r\n        await reloadCurrentListPage();') || recordActionsJs.includes('clearSelection();\n        await reloadCurrentListPage();'), 'deleteSelected should clear selection before reloading to avoid stale search/selection UI');
assert.ok(rendererJs.includes('recoverSearchInteraction,') || rendererJs.includes('recoverSearchInteraction })'), 'renderer should pass search recovery helper into record action flows');
assert.ok(recordActionsJs.includes('recoverSearchInteraction();'), 'record actions should recover search interaction after delete flows complete');
assert.ok(searchWorkflowJs.includes('searchInput.removeAttribute(\'disabled\');'), 'search recovery should remove disabled state from the search input');
assert.ok(searchWorkflowJs.includes('toggleSearchHistory(false);'), 'search recovery should close search history when restoring interaction');

assert.ok(!rendererJs.includes('เลือกรถก่อนจึงจะใช้ preset ได้'), 'search preset should not depend on row selection');
assert.ok(!rendererJs.includes('เลือกรถก่อนจึงจะบันทึก preset ได้'), 'saving search preset should not depend on row selection');
assert.ok(!rendererJs.includes('เลือกรถก่อนจึงจะลบ preset ได้'), 'removing search preset should not depend on row selection');

console.log('✅ search responsiveness tests passed');
