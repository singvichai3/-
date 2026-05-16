const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');

const moduleFile = 'renderer-table-domain.js';

assert.ok(fs.existsSync(path.join(projectRoot, moduleFile)), `${moduleFile} should exist for table/business-rule modularization`);
assert.ok(packageJson.build.files.includes(moduleFile), `${moduleFile} should be included in electron-builder files`);
assert.ok(indexHtml.includes(`<script src="${moduleFile}"></script>`), `index.html should load ${moduleFile}`);
assert.ok(indexHtml.indexOf(`<script src="${moduleFile}"></script>`) < indexHtml.indexOf('<script src="renderer.js"></script>'), `${moduleFile} should load before renderer.js`);
assert.ok(rendererJs.includes('window.RendererTableDomainModule'), 'renderer.js should delegate table/business rules to RendererTableDomainModule');

for (const fnName of [
  'formatDateForDisplay',
  'parseDisplayDateToIso',
  'createDefaultTableMeta',
  'createEmptyManualEntryRow',
  'normalizeTableDraft',
  'getTableDraftPayload',
  'calculateTableSummary',
  'buildPrintableTableRows',
  'buildTableRecordsForMainList'
]) {
  assert.ok(rendererJs.includes(fnName), `renderer.js should still expose ${fnName}`);
}

console.log('✅ phase 2 table domain modularization checks passed');
