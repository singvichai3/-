const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, 'renderer-dashboard-controller.js');

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  global.window = {};
  require(modulePath);
  const moduleApi = global.window.RendererDashboardControllerModule;
  delete global.window;
  return moduleApi;
}

async function testUpdateStatsUpdatesCountersAndRendersDashboard() {
  const moduleApi = loadModule();
  const statToday = { textContent: '' };
  const statPending = { textContent: '' };
  const statReceived = { textContent: '' };
  const calls = [];
  const stats = { today: 12, pending: 34, received: 56, total: 90 };

  await moduleApi.updateStats({
    api: {
      async getDashboardStats() {
        calls.push('getDashboardStats');
        return stats;
      }
    },
    documentRef: {
      getElementById(id) {
        if (id === 'stat-today') return statToday;
        if (id === 'stat-pending') return statPending;
        if (id === 'stat-received') return statReceived;
        return null;
      }
    },
    renderDashboard(receivedStats) {
      calls.push(['renderDashboard', receivedStats]);
    }
  });

  assert.strictEqual(statToday.textContent, '12', 'updateStats should populate stat-today');
  assert.strictEqual(statPending.textContent, '34', 'updateStats should populate stat-pending');
  assert.strictEqual(statReceived.textContent, '56', 'updateStats should populate stat-received');
  assert.deepStrictEqual(calls, ['getDashboardStats', ['renderDashboard', stats]], 'updateStats should fetch stats then render dashboard');
}

function testRenderDashboardBuildsSummaryAndUsesLatest14Days() {
  const moduleApi = loadModule();
  const shell = { innerHTML: '' };
  const chartCalls = [];
  const daily = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, '0')}`,
    count: index + 1
  }));

  moduleApi.renderDashboard({
    documentRef: {
      getElementById(id) {
        return id === 'dashboard-shell' ? shell : null;
      }
    },
    drawDashboardChart(dailyItems, formatShortDate, maxDaily) {
      chartCalls.push({ dailyItems, label: formatShortDate('2026-05-20'), maxDaily });
    }
  }, {
    total: 1234,
    pending: 234,
    received: 1000,
    today: 45,
    byType: [
      { type: 'รย', count: 700 },
      { type: 'จยย', count: 534 }
    ],
    daily
  });

  assert.ok(shell.innerHTML.includes('รายการทั้งหมด'), 'renderDashboard should render summary cards');
  assert.ok(shell.innerHTML.includes('1,234'), 'renderDashboard should render localized total count');
  assert.ok(shell.innerHTML.includes('700'), 'renderDashboard should render car totals');
  assert.ok(shell.innerHTML.includes('534'), 'renderDashboard should render motorcycle totals');
  assert.strictEqual(chartCalls.length, 1, 'renderDashboard should delegate chart drawing once');
  assert.strictEqual(chartCalls[0].dailyItems.length, 14, 'renderDashboard should only pass the latest 14 days to the chart');
  assert.strictEqual(chartCalls[0].maxDaily, 20, 'renderDashboard should compute chart scale from the latest 14 days');
  assert.strictEqual(chartCalls[0].label, '20 พ.ค.', 'renderDashboard should provide Thai short-date labels to the chart renderer');
}

function createCanvasContext() {
  const log = [];
  return {
    log,
    fillStyle: '',
    font: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: 'left',
    setTransform(...args) { log.push(['setTransform', args]); },
    clearRect(...args) { log.push(['clearRect', args]); },
    fillText(...args) { log.push(['fillText', args]); },
    beginPath() { log.push(['beginPath']); },
    moveTo(...args) { log.push(['moveTo', args]); },
    lineTo(...args) { log.push(['lineTo', args]); },
    stroke() { log.push(['stroke']); },
    closePath() { log.push(['closePath']); },
    fill() { log.push(['fill']); },
    arc(...args) { log.push(['arc', args]); }
  };
}

function testDrawDashboardChartShowsEmptyState() {
  const moduleApi = loadModule();
  const context = createCanvasContext();
  const canvas = {
    clientWidth: 500,
    width: 0,
    height: 0,
    getContext(type) {
      assert.strictEqual(type, '2d', 'drawDashboardChart should request a 2d context');
      return context;
    }
  };

  moduleApi.drawDashboardChart({
    documentRef: {
      getElementById(id) {
        return id === 'dashboard-chart' ? canvas : null;
      },
      body: {
        getAttribute(name) {
          return name === 'data-theme' ? 'light' : null;
        }
      }
    },
    windowRef: { devicePixelRatio: 2 }
  }, [], () => '-', 1);

  assert.strictEqual(canvas.width, 1000, 'drawDashboardChart should scale canvas width by devicePixelRatio');
  assert.strictEqual(canvas.height, 560, 'drawDashboardChart should scale canvas height by devicePixelRatio');
  assert.ok(context.log.some(entry => entry[0] === 'fillText' && entry[1][0].includes('ยังไม่มีข้อมูลย้อนหลัง')), 'drawDashboardChart should render an empty-state label when no history exists');
}

(async () => {
  await testUpdateStatsUpdatesCountersAndRendersDashboard();
  testRenderDashboardBuildsSummaryAndUsesLatest14Days();
  testDrawDashboardChartShowsEmptyState();
  console.log('✅ dashboard controller behavior tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
