const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, 'renderer-search-load-coordination.js');

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  global.window = {};
  require(modulePath);
  const moduleApi = global.window.RendererSearchLoadCoordinationModule;
  delete global.window;
  return moduleApi;
}

async function testSetupRefreshListenerQueuesWhenLoading() {
  const moduleApi = loadModule();
  const State = {
    currentView: 'list',
    isLoading: true,
    pendingLoadOptions: null
  };
  let refreshHandler = null;
  let loadCalls = 0;
  let statsCalls = 0;

  moduleApi.setupRefreshListener({
    State,
    api: {
      onRefreshRequired(handler) {
        refreshHandler = handler;
      }
    },
    loadData() {
      loadCalls += 1;
    },
    updateStats() {
      statsCalls += 1;
    }
  });

  assert.ok(typeof refreshHandler === 'function', 'refresh handler should be registered');
  refreshHandler();

  assert.strictEqual(loadCalls, 0, 'refresh should not load immediately while another request is in flight');
  assert.strictEqual(statsCalls, 0, 'refresh should not update stats during loading');
  assert.deepStrictEqual(State.pendingLoadOptions, { includeInsights: true, includeTotal: true }, 'refresh should queue a full reload while loading');
}

async function testSetupRefreshListenerLoadsImmediatelyWhenIdle() {
  const moduleApi = loadModule();
  const State = {
    currentView: 'list',
    isLoading: false,
    pendingLoadOptions: null
  };
  let refreshHandler = null;
  const calls = [];

  moduleApi.setupRefreshListener({
    State,
    api: {
      onRefreshRequired(handler) {
        refreshHandler = handler;
      }
    },
    loadData(options) {
      calls.push(['loadData', options]);
    },
    updateStats() {
      calls.push(['updateStats']);
    }
  });

  refreshHandler();

  assert.deepStrictEqual(calls, [
    ['loadData', { includeInsights: true, includeTotal: true }],
    ['updateStats']
  ], 'idle refresh should immediately reload list data and stats');
}

async function testLoadDataRetriesQueuedOptionsAfterFinishing() {
  const moduleApi = loadModule();
  const previousSetTimeout = global.setTimeout;
  const scheduled = [];
  global.setTimeout = (fn) => {
    scheduled.push(fn);
    return 1;
  };

  const State = {
    pendingLoadOptions: null,
    searchRequestSeq: 0,
    isLoading: false,
    loadingStartedAt: 0,
    currentView: 'list',
    totalCount: 0,
    searchQuery: '',
    searchInsights: null,
    errorCount: 0,
    maxErrors: 5,
    advancedSearch: {},
    virtualScroll: { visibleCount: 0, container: null, rowHeight: 52, startIndex: 0, endIndex: 0 },
    records: []
  };
  const recursiveCalls = [];
  let bundleCallCount = 0;

  await moduleApi.loadData({
    State,
    api: {
      async loadRecordsBundle() {
        bundleCallCount += 1;
        if (bundleCallCount === 1) {
          State.pendingLoadOptions = { includeInsights: false, includeTotal: false };
        }
        return {
          records: [{ id: bundleCallCount }],
          total: bundleCallCount,
          insights: { totalMatched: bundleCallCount, byType: {}, byStatus: {}, topBrands: [] }
        };
      }
    },
    normalizeLoadOptions(options = {}) {
      return {
        includeInsights: options.includeInsights !== false,
        includeTotal: options.includeTotal !== false
      };
    },
    getSearchParams() {
      return { page: 1, pageSize: 50 };
    },
    getActiveAdvancedSearchCount() {
      return 0;
    },
    updateSearchMeta() {},
    addRecentSearch() {},
    renderTable() {},
    updatePagination() {},
    updateSearchClearButton() {},
    renderSearchInsights() {},
    showNotification() {},
    loadData(nextOptions) {
      recursiveCalls.push(nextOptions);
    }
  }, { includeInsights: true, includeTotal: true });

  assert.strictEqual(State.isLoading, false, 'loadData should always clear the loading flag');
  assert.strictEqual(bundleCallCount, 2, 'queued options should be processed within the current load cycle');
  assert.strictEqual(scheduled.length, 0, 'no extra retry should be scheduled when the queued load already ran');
  assert.deepStrictEqual(recursiveCalls, [], 'loadData should not recurse after draining the queued options inline');
  assert.deepStrictEqual(State.records, [{ id: 2 }], 'queued load should win and update records with the latest result');
  assert.strictEqual(State.totalCount, 1, 'queued load without totals should preserve the prior total count from the last full reload');

  global.setTimeout = previousSetTimeout;
}

(async () => {
  await testSetupRefreshListenerQueuesWhenLoading();
  await testSetupRefreshListenerLoadsImmediatelyWhenIdle();
  await testLoadDataRetriesQueuedOptionsAfterFinishing();
  console.log('✅ search load coordination behavior tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
