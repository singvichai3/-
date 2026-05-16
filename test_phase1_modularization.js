const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');

const expectedFiles = [
  'renderer-search-preset.js',
  'renderer-print-preview.js',
  'renderer-search-state.js',
  'renderer-search-feature-pack.js',
  'renderer-search-load-coordination.js',
  'renderer-list-view-controller.js',
  'renderer-dashboard-controller.js',
  'renderer-table-virtual-scroll.js'
];

for (const file of expectedFiles) {
  assert.ok(fs.existsSync(path.join(projectRoot, file)), `${file} should exist for phase 1 modularization`);
  assert.ok(packageJson.build.files.includes(file), `${file} should be included in electron-builder files`);
  assert.ok(indexHtml.includes(`<script src="${file}"></script>`), `index.html should load ${file}`);
}

const searchPresetIndex = indexHtml.indexOf('<script src="renderer-search-preset.js"></script>');
const printPreviewIndex = indexHtml.indexOf('<script src="renderer-print-preview.js"></script>');
const searchStateIndex = indexHtml.indexOf('<script src="renderer-search-state.js"></script>');
const searchFeaturePackIndex = indexHtml.indexOf('<script src="renderer-search-feature-pack.js"></script>');
const searchLoadCoordinationIndex = indexHtml.indexOf('<script src="renderer-search-load-coordination.js"></script>');
const listViewControllerIndex = indexHtml.indexOf('<script src="renderer-list-view-controller.js"></script>');
const dashboardControllerIndex = indexHtml.indexOf('<script src="renderer-dashboard-controller.js"></script>');
const tableVirtualScrollIndex = indexHtml.indexOf('<script src="renderer-table-virtual-scroll.js"></script>');
const rendererIndex = indexHtml.indexOf('<script src="renderer.js"></script>');
assert.ok(searchPresetIndex !== -1 && printPreviewIndex !== -1 && searchStateIndex !== -1 && searchFeaturePackIndex !== -1 && searchLoadCoordinationIndex !== -1 && listViewControllerIndex !== -1 && dashboardControllerIndex !== -1 && tableVirtualScrollIndex !== -1 && rendererIndex !== -1, 'module scripts and renderer.js should all be present');
assert.ok(searchPresetIndex < rendererIndex, 'search preset module should load before renderer.js');
assert.ok(printPreviewIndex < rendererIndex, 'print preview module should load before renderer.js');
assert.ok(searchStateIndex < rendererIndex, 'search state module should load before renderer.js');
assert.ok(searchFeaturePackIndex < rendererIndex, 'search feature pack module should load before renderer.js');
assert.ok(searchLoadCoordinationIndex < rendererIndex, 'search load coordination module should load before renderer.js');
assert.ok(listViewControllerIndex < rendererIndex, 'list view controller module should load before renderer.js');
assert.ok(dashboardControllerIndex < rendererIndex, 'dashboard controller module should load before renderer.js');
assert.ok(tableVirtualScrollIndex < rendererIndex, 'table virtual scroll module should load before renderer.js');

assert.ok(rendererJs.includes('window.RendererSearchPresetModule'), 'renderer.js should delegate search preset/text prompt seam to RendererSearchPresetModule');
assert.ok(rendererJs.includes('window.RendererPrintPreviewModule'), 'renderer.js should delegate print preview seam to RendererPrintPreviewModule');
assert.ok(rendererJs.includes('window.RendererSearchStateModule'), 'renderer.js should delegate search state / advanced search seam to RendererSearchStateModule');
assert.ok(rendererJs.includes('window.RendererSearchFeaturePackModule'), 'renderer.js should delegate search feature pack seam to RendererSearchFeaturePackModule');
assert.ok(rendererJs.includes('window.RendererSearchLoadCoordinationModule'), 'renderer.js should delegate search load/refresh coordination seam to RendererSearchLoadCoordinationModule');
assert.ok(rendererJs.includes('window.RendererListViewControllerModule'), 'renderer.js should delegate list view controller seam to RendererListViewControllerModule');
assert.ok(rendererJs.includes('window.RendererDashboardControllerModule'), 'renderer.js should delegate dashboard seam to RendererDashboardControllerModule');
assert.ok(rendererJs.includes('window.RendererTableVirtualScrollModule'), 'renderer.js should delegate table virtual scroll seam to RendererTableVirtualScrollModule');

console.log('✅ phase 1 modularization checks passed');
