const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
const searchStateJs = fs.readFileSync(path.join(projectRoot, 'renderer-search-state.js'), 'utf8');
const searchFeaturePackJs = fs.readFileSync(path.join(projectRoot, 'renderer-search-feature-pack.js'), 'utf8');

const moduleFile = 'renderer-search-workflow.js';

assert.ok(fs.existsSync(path.join(projectRoot, moduleFile)), `${moduleFile} should exist for remaining search workflow modularization`);
assert.ok(packageJson.build.files.includes(moduleFile), `${moduleFile} should be included in electron-builder files`);
assert.ok(indexHtml.includes(`<script src="${moduleFile}"></script>`), `index.html should load ${moduleFile}`);
assert.ok(indexHtml.indexOf(`<script src="${moduleFile}"></script>`) < indexHtml.indexOf('<script src="renderer.js"></script>'), `${moduleFile} should load before renderer.js`);
assert.ok(rendererJs.includes('window.RendererSearchWorkflowModule'), 'renderer.js should delegate remaining search workflow to RendererSearchWorkflowModule');

for (const fnName of [
  'setupSearchDebounce',
  'setupSearchUiEvents',
  'renderSearchHistory',
  'toggleSearchHistory',
  'updateSearchClearButton',
  'updateSearchMeta',
  'getSearchParams',
  'getActiveAdvancedSearchCount',
  'syncAdvancedSearchForm',
  'clearAllSearchFilters',
  'applyQuickAppointmentDate',
  'clearQuickAppointmentDate',
  'applyInsightBrand',
  'applySmartSearch',
  'applySearchHistory',
  'clearSearch',
  'focusSearchInput',
  'recoverSearchInteraction',
  'setFilter',
  'normalizeLoadOptions'
]) {
  assert.ok(rendererJs.includes(fnName), `renderer.js should still expose ${fnName}`);
}

for (const fnName of [
  'updateQuickAppointmentDateInput',
  'loadSearchHistory',
  'saveSearchHistory',
  'addRecentSearch',
  'toggleAdvancedSearch',
  'applyAdvancedSearch',
  'resetAdvancedSearch'
]) {
  assert.ok(rendererJs.includes(fnName), `renderer.js should still expose ${fnName}`);
  assert.ok(searchStateJs.includes(fnName), `renderer-search-state.js should implement ${fnName}`);
}

for (const fnName of [
  'applyInsightBrand',
  'applySmartSearch',
  'applySearchHistory'
]) {
  assert.ok(rendererJs.includes(fnName), `renderer.js should still expose ${fnName}`);
  assert.ok(searchFeaturePackJs.includes(fnName), `renderer-search-feature-pack.js should implement ${fnName}`);
}

console.log('✅ phase 1 search workflow modularization checks passed');
