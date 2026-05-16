const assert = require('assert');
const path = require('path');

const modulePath = path.join(__dirname, 'renderer-search-workflow.js');

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  global.window = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  require(modulePath);
  return global.window.RendererSearchWorkflowModule;
}

function restoreGlobals(previous) {
  if (previous.window === undefined) delete global.window;
  else global.window = previous.window;

  if (previous.document === undefined) delete global.document;
  else global.document = previous.document;

  if (previous.requestAnimationFrame === undefined) delete global.requestAnimationFrame;
  else global.requestAnimationFrame = previous.requestAnimationFrame;

  if (previous.setTimeout === undefined) delete global.setTimeout;
  else global.setTimeout = previous.setTimeout;
}

function testRecoverSearchInteractionRestoresInput() {
  const previous = {
    window: global.window,
    document: global.document,
    requestAnimationFrame: global.requestAnimationFrame,
    setTimeout: global.setTimeout
  };

  const toggleCalls = [];
  const input = {
    readOnly: true,
    style: { pointerEvents: 'none' },
    disabledRemoved: [],
    focusCount: 0,
    selectCount: 0,
    removeAttribute(name) {
      this.disabledRemoved.push(name);
    },
    focus() {
      this.focusCount += 1;
    },
    select() {
      this.selectCount += 1;
    }
  };

  global.document = {
    getElementById(id) {
      return id === 'search-input' ? input : null;
    }
  };
  global.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  global.setTimeout = (fn) => {
    fn();
    return 1;
  };

  const moduleApi = loadModule();
  const State = { currentView: 'list', pendingInteractionRecovery: false };

  moduleApi.recoverSearchInteraction({
    State,
    toggleSearchHistory(visible) {
      toggleCalls.push(visible);
    }
  }, { selectText: true });

  assert.deepStrictEqual(toggleCalls, [false], 'search history should close before restoring interaction');
  assert.deepStrictEqual(input.disabledRemoved, ['disabled', 'disabled'], 'disabled state should be removed during each recovery attempt');
  assert.strictEqual(input.readOnly, false, 'search input should become editable again');
  assert.strictEqual(input.style.pointerEvents, 'auto', 'search input pointer events should be restored');
  assert.strictEqual(input.focusCount, 2, 'search input should be focused during recovery attempts');
  assert.strictEqual(input.selectCount, 2, 'search text should be selected when requested');
  assert.strictEqual(State.pendingInteractionRecovery, false, 'recovery flag should clear after focus is restored');
  assert.strictEqual(global.window.focusCalls, 2, 'window focus should be nudged during recovery');

  restoreGlobals(previous);
}

function testRecoverSearchInteractionSkipsNonListView() {
  const previous = {
    window: global.window,
    document: global.document,
    requestAnimationFrame: global.requestAnimationFrame,
    setTimeout: global.setTimeout
  };

  const toggleCalls = [];
  const input = {
    readOnly: true,
    style: { pointerEvents: 'none' },
    focusCount: 0,
    removeAttribute() {
      throw new Error('removeAttribute should not run outside list view');
    },
    focus() {
      this.focusCount += 1;
    }
  };

  global.document = {
    getElementById(id) {
      return id === 'search-input' ? input : null;
    }
  };
  global.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  global.setTimeout = (fn) => {
    fn();
    return 1;
  };

  const moduleApi = loadModule();
  const State = { currentView: 'dashboard', pendingInteractionRecovery: false };

  moduleApi.recoverSearchInteraction({
    State,
    toggleSearchHistory(visible) {
      toggleCalls.push(visible);
    }
  });

  assert.deepStrictEqual(toggleCalls, [false], 'search history should still close before aborting recovery');
  assert.strictEqual(State.pendingInteractionRecovery, true, 'recovery flag should remain set when list view is not active yet');
  assert.strictEqual(input.focusCount, 0, 'search input should not be focused outside list view');

  restoreGlobals(previous);
}

testRecoverSearchInteractionRestoresInput();
testRecoverSearchInteractionSkipsNonListView();
console.log('✅ search interaction recovery behavior tests passed');
