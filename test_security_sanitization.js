const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = __dirname;

function createClassList() {
  return {
    values: new Set(),
    add(...names) { names.forEach(name => this.values.add(name)); },
    remove(...names) { names.forEach(name => this.values.delete(name)); },
    contains(name) { return this.values.has(name); }
  };
}

function createElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    classList: createClassList(),
    style: {},
    disabled: false,
    title: '',
    querySelectorAll() { return []; }
  };
}

function runModule(fileName, sandboxOverrides = {}) {
  const sandbox = {
    window: {},
    console,
    setTimeout: () => 1,
    clearTimeout: () => {},
    ...sandboxOverrides
  };
  sandbox.global = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, fileName), 'utf8'), sandbox, { filename: fileName });
  return sandbox;
}

function testUiFeedbackEscapesNotificationAndUndoToast() {
  const elements = {
    toast: createElement('toast'),
    'undo-toast': createElement('undo-toast')
  };
  const documentRef = {
    getElementById(id) {
      return elements[id] || null;
    }
  };

  const sandbox = runModule('renderer-ui-feedback.js', { document: documentRef });
  const api = sandbox.window.RendererUiFeedbackModule;

  const payload = '<img src=x onerror="window.__xss=1"> & bad';
  api.showNotification({}, payload, 'error', 1000);
  assert.ok(!elements.toast.innerHTML.includes('<img'), 'notification must not keep raw HTML tags');
  assert.ok(elements.toast.innerHTML.includes('&lt;img'), 'notification must escape message HTML');
  assert.ok(elements.toast.innerHTML.includes('&amp; bad'), 'notification must escape ampersands');

  api.showUndoToast({ undoHandlerName: 'undoLastAction;alert(1)//' }, payload);
  assert.ok(!elements['undo-toast'].innerHTML.includes('<img'), 'undo toast must not keep raw HTML tags');
  assert.ok(elements['undo-toast'].innerHTML.includes('&lt;img'), 'undo toast must escape message HTML');
  assert.ok(elements['undo-toast'].innerHTML.includes('onclick="undoLastAction()"'), 'unsafe handler names must fall back to undoLastAction');
}

function testImportSheetDropdownEscapesSheetNames() {
  const elements = {
    'file-zone': createElement('file-zone'),
    'preview-section': createElement('preview-section'),
    'import-count': createElement('import-count'),
    'type-badges': createElement('type-badges'),
    'preview-note': createElement('preview-note'),
    'preview-tbody': createElement('preview-tbody'),
    'sheet-selector': createElement('sheet-selector'),
    'sheet-dropdown': createElement('sheet-dropdown'),
    'sheet-bulk-tools': createElement('sheet-bulk-tools'),
    'sheet-selection-note': createElement('sheet-selection-note'),
    'sheet-selection-list': createElement('sheet-selection-list'),
    'btn-import': createElement('btn-import'),
    'import-profile-tabs': createElement('import-profile-tabs'),
    'import-profile-hint': createElement('import-profile-hint')
  };
  const documentRef = {
    getElementById(id) {
      return elements[id] || null;
    }
  };
  const escapeHTML = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const sandbox = runModule('renderer-import-workflow.js', { document: documentRef });
  const api = sandbox.window.RendererImportWorkflowModule;
  const maliciousName = '</option><img src=x onerror="window.__xss=1">';

  api.showPreview({
    State: {
      sheetCount: 2,
      sheetNames: [maliciousName, 'Safe Sheet'],
      currentSheetIndex: 0,
      selectedImportSheets: [0],
      importProfile: 'default',
      importData: [{ plate: 'กข123', type: 'รย', province: 'เชียงราย', brand: 'TOYOTA', importedAt: '2026-05-03' }]
    },
    IMPORT_PREVIEW_ROW_LIMIT: 20,
    IMPORT_PROFILES: { default: { description: 'default' } },
    escapeHTML,
    formatDate: value => value,
    renderImportSheetSelection: () => {}
  });

  assert.ok(!elements['sheet-dropdown'].innerHTML.includes('<img'), 'sheet dropdown must not keep raw sheet-name HTML');
  assert.ok(elements['sheet-dropdown'].innerHTML.includes('&lt;/option&gt;&lt;img'), 'sheet dropdown must escape sheet names');
}


function extractFunctionBody(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.ok(start >= 0, `${functionName} should exist`);
  const nextFunction = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, nextFunction >= 0 ? nextFunction : source.length);
}

function testRowRendererEncodesRecordIdsBeforeInlineHandlers() {
  const rendererJs = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
  const body = extractFunctionBody(rendererJs, 'createRowHTML');

  assert.ok(body.includes("encodeURIComponent(String(r.id || '')).replace(/'/g, '%27')"), 'createRowHTML must URL-encode record ids and encode apostrophes before embedding them in inline handlers');
  assert.ok(body.includes('decodeURIComponent'), 'createRowHTML should decode encoded ids only at the call boundary');
  assert.ok(!body.includes("'${r.id}'"), 'createRowHTML must not embed raw record ids inside quoted inline JavaScript');
  assert.ok(!body.includes('data-id="${r.id}"'), 'createRowHTML must not embed raw record ids in data-id attributes');
}

function testWorkerTracksWriteTransactionsForWalCheckpoint() {
  const workerJs = fs.readFileSync(path.join(projectRoot, 'db-worker.js'), 'utf8');
  assert.ok(workerJs.includes('function noteWriteTransaction'), 'db worker should have a write-transaction counter helper');
  const calls = (workerJs.match(/noteWriteTransaction\(/g) || []).length;
  assert.ok(calls >= 7, 'write operations should increment transactionCount so checkpoint guard is reachable');
}

function testMainIpcRestrictsRendererControlledFilePaths() {
  const mainJs = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  assert.ok(mainJs.includes('const allowedExcelFilePaths = new Set();'), 'main process should keep an allow-list of files selected through the native dialog');
  assert.ok(mainJs.includes('rememberAllowedExcelFile(result.filePaths[0])'), 'open-excel-dialog should register the selected Excel file before returning it to renderer');
  assert.ok(mainJs.includes('assertAllowedExcelFile(input)'), 'parse-excel should reject arbitrary renderer-provided file paths');
  assert.ok(mainJs.includes('assertAllowedExcelFile(inputData)'), 'parse-excel-sheet should reject arbitrary renderer-provided file paths');
  assert.ok(mainJs.includes('const safePath = assertAllowedExcelFile(filePath);'), 'delete-file should only delete files previously selected through the dialog');
  assert.ok(mainJs.includes('allowedExcelFilePaths.delete(safePath)'), 'deleted files should be removed from the allow-list');
}

function testElectronRendererSandboxFlags() {
  const mainJs = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  const secondaryMainJs = fs.readFileSync(path.join(projectRoot, 'secondary-main.js'), 'utf8');
  assert.ok(mainJs.includes('sandbox: true'), 'main BrowserWindow should enable Electron sandbox');
  assert.ok(secondaryMainJs.includes('sandbox: true'), 'secondary BrowserWindow should enable Electron sandbox');
}

testUiFeedbackEscapesNotificationAndUndoToast();
testImportSheetDropdownEscapesSheetNames();
testRowRendererEncodesRecordIdsBeforeInlineHandlers();
testWorkerTracksWriteTransactionsForWalCheckpoint();
testMainIpcRestrictsRendererControlledFilePaths();
testElectronRendererSandboxFlags();

console.log('✅ security sanitization tests passed');
