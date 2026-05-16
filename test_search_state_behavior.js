const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, 'renderer-search-state.js');

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  global.window = {};
  require(modulePath);
  const moduleApi = global.window.RendererSearchStateModule;
  delete global.window;
  return moduleApi;
}

function createDocument(elements) {
  return {
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '.filter-tab') {
        return elements.filterTabs || [];
      }
      return [];
    }
  };
}

function testAddRecentSearchDeduplicatesAndPersists() {
  const moduleApi = loadModule();
  const rendered = [];
  const saved = [];
  const State = {
    searchHistory: ['เดิม', 'เก่า'],
    advancedSearch: {},
    searchUi: {}
  };

  moduleApi.addRecentSearch({
    State,
    saveSearchHistory() {
      saved.push([...State.searchHistory]);
    },
    renderSearchHistory() {
      rendered.push([...State.searchHistory]);
    }
  }, ' เดิม ');

  assert.deepStrictEqual(State.searchHistory, ['เดิม', 'เก่า'], 'existing search should move to front without duplication');
  assert.strictEqual(saved.length, 1, 'updated history should persist once');
  assert.strictEqual(rendered.length, 1, 'updated history should rerender once');
}

function testApplyAdvancedSearchReadsFormAndResetsPage() {
  const moduleApi = loadModule();
  const previousDocument = global.document;
  const panel = {
    visible: true,
    classList: {
      contains(name) { return name === 'visible'; },
      toggle(name, value) { panel.visible = value; }
    }
  };
  global.document = createDocument({
    'advanced-search-panel': panel,
    'adv-plate': { value: ' กข1234 ' },
    'adv-owner-name': { value: ' สมชาย ' },
    'adv-phone': { value: '0812345678' },
    'adv-brand': { value: 'Honda' },
    'adv-province': { value: 'เชียงราย' },
    'adv-imported-from': { value: '2026-04-01' },
    'adv-imported-to': { value: '2026-04-02' },
    'adv-received-from': { value: '' },
    'adv-received-to': { value: '' }
  });

  const calls = [];
  const State = {
    advancedSearch: {},
    currentPage: 5
  };

  moduleApi.applyAdvancedSearch({
    State,
    updateQuickAppointmentDateInput() { calls.push('updateQuickAppointmentDateInput'); },
    updateAdvancedSearchSummary() { calls.push('updateAdvancedSearchSummary'); },
    toggleAdvancedSearch(value) { calls.push(['toggleAdvancedSearch', value]); },
    loadData() { calls.push('loadData'); }
  });

  assert.deepStrictEqual(State.advancedSearch, {
    plate: 'กข1234',
    ownerName: 'สมชาย',
    phone: '0812345678',
    brand: 'Honda',
    province: 'เชียงราย',
    importedFrom: '2026-04-01',
    importedTo: '2026-04-02',
    receivedFrom: '',
    receivedTo: ''
  }, 'advanced search should trim and capture form values');
  assert.strictEqual(State.currentPage, 1, 'applying advanced search should reset pagination');
  assert.deepStrictEqual(calls, [
    'updateQuickAppointmentDateInput',
    'updateAdvancedSearchSummary',
    ['toggleAdvancedSearch', false],
    'loadData'
  ], 'advanced search apply order should stay stable');

  global.document = previousDocument;
}

function testResetAdvancedSearchClearsStateAndReloads() {
  const moduleApi = loadModule();
  const calls = [];
  const State = {
    advancedSearch: {
      plate: 'กข1234', ownerName: 'สมชาย', phone: '0812345678', brand: 'Honda', province: 'เชียงราย',
      importedFrom: '2026-04-01', importedTo: '2026-04-02', receivedFrom: '2026-04-03', receivedTo: '2026-04-04'
    },
    currentPage: 3
  };

  moduleApi.resetAdvancedSearch({
    State,
    syncAdvancedSearchForm() { calls.push('syncAdvancedSearchForm'); },
    loadData() { calls.push('loadData'); }
  });

  assert.deepStrictEqual(State.advancedSearch, {
    plate: '', ownerName: '', phone: '', brand: '', province: '',
    importedFrom: '', importedTo: '', receivedFrom: '', receivedTo: ''
  }, 'resetAdvancedSearch should clear every advanced filter field');
  assert.strictEqual(State.currentPage, 1, 'resetAdvancedSearch should reset pagination');
  assert.deepStrictEqual(calls, ['syncAdvancedSearchForm', 'loadData'], 'resetAdvancedSearch should sync form before reloading');
}

function testUpdateQuickAppointmentDateInputReflectsMatchingRange() {
  const moduleApi = loadModule();
  const previousDocument = global.document;
  const quickDateInput = { value: '' };
  global.document = createDocument({
    'quick-appointment-date': quickDateInput
  });

  moduleApi.updateQuickAppointmentDateInput({
    State: {
      advancedSearch: {
        importedFrom: '2026-05-01',
        importedTo: '2026-05-01'
      }
    }
  });
  assert.strictEqual(quickDateInput.value, '2026-05-01', 'quick appointment date should mirror a single-day imported range');

  moduleApi.updateQuickAppointmentDateInput({
    State: {
      advancedSearch: {
        importedFrom: '2026-05-01',
        importedTo: '2026-05-02'
      }
    }
  });
  assert.strictEqual(quickDateInput.value, '', 'quick appointment date should clear when imported range spans multiple days');

  global.document = previousDocument;
}

testAddRecentSearchDeduplicatesAndPersists();
testApplyAdvancedSearchReadsFormAndResetsPage();
testResetAdvancedSearchClearsStateAndReloads();
testUpdateQuickAppointmentDateInputReflectsMatchingRange();
console.log('✅ search state behavior tests passed');
