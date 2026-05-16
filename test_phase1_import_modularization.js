const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');

const moduleFile = 'renderer-import-workflow.js';

assert.ok(fs.existsSync(path.join(projectRoot, moduleFile)), `${moduleFile} should exist for import workflow modularization`);
assert.ok(packageJson.build.files.includes(moduleFile), `${moduleFile} should be included in electron-builder files`);
assert.ok(indexHtml.includes(`<script src="${moduleFile}"></script>`), `index.html should load ${moduleFile}`);
assert.ok(indexHtml.indexOf(`<script src="${moduleFile}"></script>`) < indexHtml.indexOf('<script src="renderer.js"></script>'), `${moduleFile} should load before renderer.js`);

assert.ok(rendererJs.includes('window.RendererImportWorkflowModule'), 'renderer.js should delegate import workflow seam to RendererImportWorkflowModule');
for (const fnName of [
  'selectFile',
  'applyImportProfile',
  'confirmImport',
  'updateImportProgress',
  'restoreInteractiveStateAfterImport',
  'cancelImport',
  'switchSheet',
  'applyImportDateSelection',
  'toggleImportSheetSelection',
  'selectAllImportSheets',
  'clearImportSheetSelection'
]) {
  assert.ok(rendererJs.includes(fnName), `renderer.js should still expose ${fnName}`);
}

console.log('✅ phase 1 import modularization checks passed');
