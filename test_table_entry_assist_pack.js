const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = __dirname;
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const rendererJs = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
const domainCode = fs.readFileSync(path.join(projectRoot, 'renderer-table-domain.js'), 'utf8');

assert.ok(indexHtml.includes('id="table-search-input"'), 'table UI should include quick search input');
assert.ok(indexHtml.includes('onclick="validateManualEntryTable(true)"'), 'table UI should include validate button');
assert.ok(indexHtml.includes('onclick="copyManualEntryFromAbove()"'), 'table UI should include copy-from-above button');
assert.ok(indexHtml.includes('id="table-floating-summary"'), 'table UI should include sticky floating summary');
assert.ok(indexHtml.includes('id="table-validation-status"'), 'table UI should include validation status pill');
assert.ok(indexHtml.includes('Ctrl+S'), 'table UI should document keyboard shortcuts');

for (const fnName of [
  'updateTableSearch',
  'clearTableSearch',
  'validateManualEntryTable',
  'copyManualEntryFromAbove',
  'handleTableKeyboardShortcut',
  'renderTableAssistPanel'
]) {
  assert.ok(rendererJs.includes(`function ${fnName}`), `renderer.js should expose ${fnName}`);
}

const context = { window: {} };
context.global = context.window;
vm.createContext(context);
vm.runInContext(domainCode, context, { filename: 'renderer-table-domain.js' });
const domain = context.window.RendererTableDomainModule;
assert.ok(domain, 'RendererTableDomainModule should register on window');

const State = {
  manualEntries: [
    { plate: '', type: 'รย', taxAmount: '', note: '', brand: '', province: 'เชียงราย' },
    { plate: 'กข 1234', type: 'รย', taxAmount: '900', note: 'รับเล่ม', brand: 'Toyota', province: 'เชียงราย' },
    { plate: 'กข1234', type: 'จยย', taxAmount: '-1', note: '', brand: 'Honda', province: 'เชียงราย' },
    { plate: 'ขค 9999', type: 'รถ', taxAmount: 'abc', note: '', brand: '', province: '' },
    { plate: 'กข 1234', type: 'รย', taxAmount: '500', note: '', brand: 'Mazda', province: 'เชียงราย' },
    { plate: '', type: 'รย', taxAmount: '', note: '', brand: 'Isuzu', province: 'เชียงราย' }
  ]
};
const parseMoney = (value) => {
  const amount = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(amount) ? amount : 0;
};

const validation = domain.validateManualEntries({ State, parseMoney });
assert.strictEqual(validation.filledCount, 4, 'blank rows with only default province should not count as filled');
assert.ok(validation.errorCount >= 5, 'validation should catch duplicate plate, invalid tax, and invalid type');
assert.strictEqual(validation.byIndex[0].status, 'empty', 'empty row should remain neutral');
assert.strictEqual(validation.byIndex[1].status, 'error', 'first duplicate row should be marked error');
assert.strictEqual(validation.byIndex[2].status, 'error', 'second duplicate/negative tax row should be marked error');
assert.strictEqual(validation.byIndex[3].status, 'error', 'invalid type/tax row should be marked error');
assert.strictEqual(validation.byIndex[5].status, 'empty', 'brand-only rows should stay neutral so bulk brand edit does not show an issue marker');

const searchBrand = domain.getManualEntrySearchIndexes({ State }, 'toyota');
assert.deepStrictEqual(searchBrand, [1], 'quick search should find rows by brand');
const searchProvince = domain.getManualEntrySearchIndexes({ State }, 'เชียงราย');
assert.deepStrictEqual(searchProvince, [0, 1, 2, 4, 5], 'quick search should find rows by province');
const summary = domain.calculateTableSummary({ State, parseMoney, serviceRates: { transportCarRate: 20, transportMotoRate: 15, shopCarRate: 40, shopMotoRate: 30 } });
assert.strictEqual(summary.serviceCount, 4, 'summary should ignore rows that only contain default province');
assert.strictEqual(summary.taxTotal, 1400, 'summary should total only valid non-negative business-content tax values');
assert.strictEqual(summary.serviceTotal, 75, 'summary should support separate custom รย/จยย transport service rates');
assert.strictEqual(summary.shopServiceTotal, 150, 'summary should expose separate shop service totals for print preview');
const legacySummary = domain.calculateTableSummary({ State, parseMoney, TABLE_SERVICE_RATE: 20 });
assert.strictEqual(legacySummary.serviceTotal, 80, 'legacy single service rate callers should remain backward compatible');
const allRows = domain.getManualEntrySearchIndexes({ State }, '');
assert.deepStrictEqual(allRows, [0, 1, 2, 3, 4, 5], 'empty search should return every row index');

console.log('✅ table entry assist pack tests passed');
