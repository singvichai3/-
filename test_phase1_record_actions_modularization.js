const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
const moduleFile = 'renderer-record-actions.js';
const recordActionsJs = fs.readFileSync(path.join(projectRoot, moduleFile), 'utf8');

assert.ok(fs.existsSync(path.join(projectRoot, moduleFile)), `${moduleFile} should exist for optimistic action modularization`);
assert.ok(packageJson.build.files.includes(moduleFile), `${moduleFile} should be included in electron-builder files`);
assert.ok(indexHtml.includes(`<script src="${moduleFile}"></script>`), `index.html should load ${moduleFile}`);
assert.ok(indexHtml.indexOf(`<script src="${moduleFile}"></script>`) < indexHtml.indexOf('<script src="renderer.js"></script>'), `${moduleFile} should load before renderer.js`);
assert.ok(rendererJs.includes('window.RendererRecordActionsModule'), 'renderer.js should delegate optimistic action/selection workflow to RendererRecordActionsModule');

for (const fnName of [
  'getNextSequenceId',
  'trackRequest',
  'completeRequest',
  'isStaleRequest',
  'pushRollback',
  'executeRollback',
  'updateField',
  'markReceived',
  'undoReceived',
  'deleteRecord',
  'deleteSelected',
  'reloadCurrentListPage',
  'handleRowClick',
  'updateBulkBar',
  'toggleSelect',
  'toggleSelectAll',
  'clearSelection',
  'bulkSave'
]) {
  assert.ok(rendererJs.includes(fnName), `renderer.js should still expose ${fnName}`);
}

assert.ok(rendererJs.includes('recoverSearchInteraction'), 'renderer.js should expose recoverSearchInteraction wrapper');
assert.ok(recordActionsJs.includes('recoverSearchInteraction'), 'record actions module should depend on recoverSearchInteraction for delete flows');
assert.ok(recordActionsJs.includes('recoverSearchInteraction();'), 'record actions module should call recoverSearchInteraction in delete paths');

console.log('✅ phase 1 record actions modularization checks passed');
