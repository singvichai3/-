const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, 'renderer-list-view-controller.js');

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  global.window = {};
  require(modulePath);
  const moduleApi = global.window.RendererListViewControllerModule;
  delete global.window;
  return moduleApi;
}

function classList(initial = []) {
  const set = new Set(initial);
  return {
    add(name) { set.add(name); },
    remove(name) { set.delete(name); },
    toggle(name, value) { if (value) set.add(name); else set.delete(name); },
    contains(name) { return set.has(name); },
    values() { return Array.from(set); }
  };
}

function testSwitchViewListDefaultFlow() {
  const moduleApi = loadModule();
  const previousDocument = global.document;
  const previousSetTimeout = global.setTimeout;
  const calls = [];

  const listView = { classList: classList() };
  const importView = { classList: classList(['active']) };
  const listNav = { classList: classList(), dataset: { view: 'list' } };
  const importNav = { classList: classList(['active']), dataset: { view: 'import' } };

  global.document = {
    querySelectorAll(selector) {
      if (selector === '.view') return [importView, listView];
      if (selector === '.nav-item') return [importNav, listNav];
      return [];
    },
    getElementById(id) {
      if (id === 'view-list') return listView;
      if (id === 'view-import') return importView;
      return null;
    },
    querySelector(selector) {
      if (selector === '[data-view="list"]') return listNav;
      if (selector === '[data-view="import"]') return importNav;
      return null;
    }
  };
  global.setTimeout = (fn) => {
    fn();
    return 1;
  };

  const State = { currentView: 'import', isLoading: true };
  moduleApi.switchView({
    State,
    hideLoading() { calls.push('hideLoading'); },
    setupVirtualScroll() { calls.push('setupVirtualScroll'); },
    loadData() { calls.push('loadData'); },
    updateStats() { calls.push('updateStats'); },
    renderManualEntryTable() { calls.push('renderManualEntryTable'); },
    syncTableMetaInputs() { calls.push('syncTableMetaInputs'); },
    syncBulkEditInput() { calls.push('syncBulkEditInput'); },
    syncPrintLayoutControls() { calls.push('syncPrintLayoutControls'); },
    loadDashboard() { calls.push('loadDashboard'); },
    showNotification(message, type) { calls.push(['showNotification', message, type]); }
  }, 'list');

  assert.strictEqual(State.currentView, 'list', 'switchView should update currentView');
  assert.strictEqual(State.isLoading, false, 'switchView(list) should clear loading state unless preserved');
  assert.ok(listView.classList.contains('active'), 'target list view should become active');
  assert.ok(listNav.classList.contains('active'), 'target nav item should become active');
  assert.deepStrictEqual(calls, ['hideLoading', 'setupVirtualScroll', 'loadData', 'updateStats'], 'list switch should hide loading, prep virtual scroll, then refresh data and stats');

  global.document = previousDocument;
  global.setTimeout = previousSetTimeout;
}

function testSwitchViewListWithPreservedFlags() {
  const moduleApi = loadModule();
  const previousDocument = global.document;
  const previousSetTimeout = global.setTimeout;
  const calls = [];

  global.document = {
    querySelectorAll() { return []; },
    getElementById() { return null; },
    querySelector() { return null; }
  };
  global.setTimeout = (fn) => {
    fn();
    return 1;
  };

  const State = { currentView: 'import', isLoading: true };
  moduleApi.switchView({
    State,
    hideLoading() { calls.push('hideLoading'); },
    setupVirtualScroll() { calls.push('setupVirtualScroll'); },
    loadData() { calls.push('loadData'); },
    updateStats() { calls.push('updateStats'); },
    renderManualEntryTable() {},
    syncTableMetaInputs() {},
    syncBulkEditInput() {},
    syncPrintLayoutControls() {},
    loadDashboard() {},
    showNotification() {}
  }, 'list', { keepLoadingOverlay: true, preserveLoadingState: true, skipListRefresh: true });

  assert.strictEqual(State.isLoading, true, 'loading state should be preserved when requested');
  assert.deepStrictEqual(calls, ['setupVirtualScroll'], 'list switch with skip flags should only prep virtual scroll');

  global.document = previousDocument;
  global.setTimeout = previousSetTimeout;
}

function testSwitchViewDashboard() {
  const moduleApi = loadModule();
  const previousDocument = global.document;
  const calls = [];

  global.document = {
    querySelectorAll() { return []; },
    getElementById() { return null; },
    querySelector() { return null; }
  };

  const State = { currentView: 'import', isLoading: false };
  moduleApi.switchView({
    State,
    hideLoading() {},
    setupVirtualScroll() {},
    loadData() {},
    updateStats() { calls.push('updateStats'); },
    renderManualEntryTable() {},
    syncTableMetaInputs() {},
    syncBulkEditInput() {},
    syncPrintLayoutControls() {},
    loadDashboard() { calls.push('loadDashboard'); },
    showNotification() {}
  }, 'dashboard');

  assert.deepStrictEqual(calls, ['loadDashboard', 'updateStats'], 'dashboard switch should load dashboard and stats');
  global.document = previousDocument;
}

function testSetFilterUpdatesTabsAndReloads() {
  const moduleApi = loadModule();
  const previousDocument = global.document;
  const calls = [];
  const allTab = { dataset: { filter: 'all' }, classList: classList(['active']) };
  const pendingTab = { dataset: { filter: 'pending' }, classList: classList() };

  global.document = {
    querySelectorAll(selector) {
      if (selector === '.filter-tab') return [allTab, pendingTab];
      return [];
    }
  };

  const State = { currentFilter: 'all', currentPage: 3 };
  moduleApi.setFilter({
    State,
    loadData() { calls.push('loadData'); },
    showNotification(message, type) { calls.push(['showNotification', message, type]); }
  }, 'pending');

  assert.strictEqual(State.currentFilter, 'pending', 'setFilter should update current filter');
  assert.strictEqual(State.currentPage, 1, 'setFilter should reset current page');
  assert.ok(pendingTab.classList.contains('active'), 'matching filter tab should become active');
  assert.ok(!allTab.classList.contains('active'), 'non-matching filter tab should be cleared');
  assert.deepStrictEqual(calls, ['loadData'], 'setFilter should trigger a reload');

  global.document = previousDocument;
}

testSwitchViewListDefaultFlow();
testSwitchViewListWithPreservedFlags();
testSwitchViewDashboard();
testSetFilterUpdatesTabsAndReloads();
console.log('✅ list view controller behavior tests passed');
