const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, 'renderer-table-virtual-scroll.js');

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  global.window = {};
  require(modulePath);
  const moduleApi = global.window.RendererTableVirtualScrollModule;
  delete global.window;
  return moduleApi;
}

function testSetupVirtualScrollFallsBackToRegularRender() {
  const moduleApi = loadModule();
  const calls = [];
  const tableWrapper = {
    clientHeight: 420,
    addEventListener(eventName, handler, options) {
      calls.push(['addEventListener', eventName, !!handler, options && options.passive]);
    },
    removeEventListener(eventName, handler) {
      calls.push(['removeEventListener', eventName, !!handler]);
    }
  };
  const State = {
    records: [{ id: '1' }, { id: '2' }],
    pageSize: 10,
    virtualScroll: { rowHeight: 54 }
  };

  moduleApi.setupVirtualScroll({
    State,
    documentRef: {
      querySelector(selector) {
        return selector === '.table-wrapper' ? tableWrapper : null;
      }
    },
    handleScroll() {},
    renderTable() {
      calls.push('renderTable');
    }
  });

  assert.strictEqual(State.virtualScroll.container, tableWrapper, 'setupVirtualScroll should remember the active scroll container');
  assert.strictEqual(State.virtualScroll.visibleCount, 2, 'setupVirtualScroll should disable virtualization when record count fits on the page');
  assert.strictEqual(State.virtualScroll.startIndex, 0, 'setupVirtualScroll should reset start index for non-virtual mode');
  assert.strictEqual(State.virtualScroll.endIndex, 2, 'setupVirtualScroll should render all rows when virtualization is disabled');
  assert.deepStrictEqual(calls, [
    ['removeEventListener', 'scroll', true],
    'renderTable'
  ], 'setupVirtualScroll should clear the old listener and render immediately without adding a new listener');
}

function testHandleScrollUpdatesVisibleRange() {
  const moduleApi = loadModule();
  const calls = [];
  const container = { scrollTop: 250 };
  const State = {
    records: Array.from({ length: 50 }, (_, index) => ({ id: String(index + 1) })),
    virtualScroll: {
      _scrolling: false,
      rowHeight: 50,
      visibleCount: 7,
      startIndex: 0,
      endIndex: 7,
      container
    }
  };

  moduleApi.handleScroll({
    State,
    documentRef: { querySelector() { return null; } },
    requestAnimationFrameRef(fn) { fn(); },
    renderVisibleRows() { calls.push('renderVisibleRows'); }
  });

  assert.strictEqual(State.virtualScroll.startIndex, 5, 'handleScroll should derive startIndex from scrollTop and rowHeight');
  assert.strictEqual(State.virtualScroll.endIndex, 12, 'handleScroll should derive endIndex from visibleCount');
  assert.strictEqual(State.virtualScroll._scrolling, false, 'handleScroll should clear its scrolling lock after rendering');
  assert.deepStrictEqual(calls, ['renderVisibleRows'], 'handleScroll should re-render rows when the visible range changes');
}

function testRenderTableHealsVisibleCountAndSpacers() {
  const moduleApi = loadModule();
  const calls = [];
  const top = { style: { height: '' } };
  const bottom = { style: { height: '' } };
  const State = {
    records: Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1) })),
    totalCount: 20,
    pageSize: 10,
    virtualScroll: {
      container: { clientHeight: 300 },
      rowHeight: 60,
      visibleCount: 0,
      startIndex: 2,
      endIndex: 0
    }
  };

  moduleApi.renderTable({
    State,
    documentRef: {
      getElementById(id) {
        if (id === 'virtual-top') return top;
        if (id === 'virtual-bottom') return bottom;
        return null;
      }
    },
    renderVisibleRows() { calls.push('renderVisibleRows'); }
  });

  assert.strictEqual(State.virtualScroll.visibleCount, 10, 'renderTable should self-heal visibleCount from container height when needed');
  assert.strictEqual(State.virtualScroll.endIndex, 10, 'renderTable should repair endIndex when it becomes stale');
  assert.strictEqual(top.style.height, '120px', 'renderTable should size the top spacer from startIndex');
  assert.strictEqual(bottom.style.height, '600px', 'renderTable should size the bottom spacer from remaining rows');
  assert.deepStrictEqual(calls, ['renderVisibleRows'], 'renderTable should delegate row painting after recalculating spacers');
}

function testRenderVisibleRowsComposesDraftAndGroupedRows() {
  const moduleApi = loadModule();
  const rowCalls = [];
  const tbody = { innerHTML: '' };
  const State = {
    records: [
      { id: 'a', importedAt: '2026-05-01', type: 'รย' },
      { id: 'b', importedAt: '2026-05-01', type: 'รย' }
    ],
    virtualScroll: { startIndex: 0, endIndex: 2 },
    listDraftRecord: { plate: 'ดราฟต์' }
  };

  moduleApi.renderVisibleRows({
    State,
    documentRef: {
      getElementById(id) {
        return id === 'table-body' ? tbody : null;
      }
    },
    formatDate(value) {
      return `DATE:${value}`;
    },
    createDraftRowHTML() {
      return '<tr class="draft-row"></tr>';
    },
    createRowHTML(record, index) {
      rowCalls.push([record.id, index]);
      return `<tr data-id="${record.id}" data-index="${index}"></tr>`;
    }
  });

  assert.ok(tbody.innerHTML.includes('draft-row'), 'renderVisibleRows should prepend the draft row when one exists');
  assert.ok(tbody.innerHTML.includes('group-header'), 'renderVisibleRows should insert group headers when the date/type group changes');
  assert.strictEqual((tbody.innerHTML.match(/group-header/g) || []).length, 1, 'renderVisibleRows should not duplicate group headers for the same group');
  assert.deepStrictEqual(rowCalls, [['a', 1], ['b', 2]], 'renderVisibleRows should preserve global row indexes when delegating row rendering');
}

function testRenderVisibleRowsShowsEmptyState() {
  const moduleApi = loadModule();
  const tbody = { innerHTML: '' };

  moduleApi.renderVisibleRows({
    State: {
      records: [],
      virtualScroll: { startIndex: 0, endIndex: 0 },
      listDraftRecord: null
    },
    documentRef: {
      getElementById(id) {
        return id === 'table-body' ? tbody : null;
      }
    }
  });

  assert.ok(tbody.innerHTML.includes('ไม่พบข้อมูลรายการ'), 'renderVisibleRows should show an empty-state row when nothing is visible');
}

testSetupVirtualScrollFallsBackToRegularRender();
testHandleScrollUpdatesVisibleRange();
testRenderTableHealsVisibleCountAndSpacers();
testRenderVisibleRowsComposesDraftAndGroupedRows();
testRenderVisibleRowsShowsEmptyState();
console.log('✅ table virtual scroll behavior tests passed');
