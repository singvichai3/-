const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, 'renderer-search-feature-pack.js');

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  global.window = {
    RendererSearchPresetModule: {
      saveCurrentSearchPreset: (...args) => global.__presetCalls.push(['saveCurrentSearchPreset', args]),
      applySearchPreset: (...args) => global.__presetCalls.push(['applySearchPreset', args]),
      removeCurrentSearchPreset: (...args) => global.__presetCalls.push(['removeCurrentSearchPreset', args])
    }
  };
  require(modulePath);
  const moduleApi = global.window.RendererSearchFeaturePackModule;
  return moduleApi;
}

function cleanupWindow() {
  delete global.window;
  delete global.__presetCalls;
}

function testPresetDelegation() {
  global.__presetCalls = [];
  const moduleApi = loadModule();
  const ctx = { State: { searchUi: { selectedPresetIndex: '' } }, api: {}, openTextPrompt() {}, renderSearchPresets() {}, showNotification() {} };

  moduleApi.saveCurrentSearchPreset(ctx);
  moduleApi.applySearchPreset(ctx, 2);
  moduleApi.removeCurrentSearchPreset(ctx);

  assert.deepStrictEqual(global.__presetCalls.map(entry => entry[0]), ['saveCurrentSearchPreset', 'applySearchPreset', 'removeCurrentSearchPreset'], 'search feature pack should delegate preset actions through RendererSearchPresetModule');
  cleanupWindow();
}

function testApplySmartSearchSetsExpectedState() {
  global.__presetCalls = [];
  const moduleApi = loadModule();
  const calls = [];
  const State = {
    currentFilter: 'all',
    currentPage: 5,
    advancedSearch: {
      importedFrom: '', importedTo: '', receivedFrom: '', receivedTo: ''
    }
  };

  moduleApi.applySmartSearch({
    State,
    syncAdvancedSearchForm() { calls.push('syncAdvancedSearchForm'); },
    loadData() { calls.push('loadData'); },
    documentRef: {
      querySelectorAll(selector) {
        if (selector !== '.filter-tab') return [];
        return [
          { dataset: { filter: 'pending' }, classList: { toggle() {} } },
          { dataset: { filter: 'received' }, classList: { toggle() {} } },
          { dataset: { filter: 'จยย' }, classList: { toggle() {} } }
        ];
      }
    }
  }, 'pendingToday', '2026-05-10');

  assert.strictEqual(State.currentFilter, 'pending', 'pendingToday smart search should switch to pending filter');
  assert.strictEqual(State.advancedSearch.importedFrom, '2026-05-10', 'pendingToday should pin importedFrom to the selected day');
  assert.strictEqual(State.advancedSearch.importedTo, '2026-05-10', 'pendingToday should pin importedTo to the selected day');
  assert.strictEqual(State.currentPage, 1, 'smart search should reset pagination');
  assert.deepStrictEqual(calls, ['syncAdvancedSearchForm', 'loadData'], 'smart search should sync form before reloading');
  cleanupWindow();
}

function testApplySearchHistoryFocusesAndLoads() {
  global.__presetCalls = [];
  const moduleApi = loadModule();
  const calls = [];
  const searchInput = {
    value: '',
    focusCount: 0,
    selectCount: 0,
    focus() { this.focusCount += 1; },
    select() { this.selectCount += 1; }
  };

  moduleApi.applySearchHistory({
    State: { searchQuery: '', currentPage: 2 },
    updateSearchClearButton() { calls.push('updateSearchClearButton'); },
    updateSearchMeta(text) { calls.push(['updateSearchMeta', text]); },
    toggleSearchHistory(value) { calls.push(['toggleSearchHistory', value]); },
    loadData() { calls.push('loadData'); },
    documentRef: { getElementById(id) { return id === 'search-input' ? searchInput : null; } }
  }, 'ทะเบียนเชียงราย');

  assert.strictEqual(searchInput.value, 'ทะเบียนเชียงราย', 'history apply should populate the search input');
  assert.strictEqual(searchInput.focusCount, 1, 'history apply should focus the search input');
  assert.strictEqual(searchInput.selectCount, 1, 'history apply should select the search input text');
  assert.deepStrictEqual(calls, [
    'updateSearchClearButton',
    ['updateSearchMeta', 'ค้นหาล่าสุด: ทะเบียนเชียงราย'],
    ['toggleSearchHistory', false],
    'loadData'
  ], 'history apply should update UI metadata, hide history, then reload');
  cleanupWindow();
}

testPresetDelegation();
testApplySmartSearchSetsExpectedState();
testApplySearchHistoryFocusesAndLoads();
console.log('✅ search feature pack behavior tests passed');
