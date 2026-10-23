const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createTimerLock, RENDERER_SILENCE_LIMIT_MS } = require("../timer-lock");

function fakeWindow(options = {}) {
  return Object.assign(new EventEmitter(), {
    options,
    bounds: null,
    destroyed: false,
    visible: options.show !== false,
    minimized: false,
    alwaysOnTop: false,
    level: null,
    minimizable: true,
    closable: true,
    focusCount: 0,
    topCount: 0,
    webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler() {} }),
    isDestroyed() { return this.destroyed; },
    destroy() { this.destroyed = true; },
    isVisible() { return this.visible; },
    isMinimized() { return this.minimized; },
    isFocused() { return false; },
    show() { this.visible = true; },
    showInactive() { this.visible = true; },
    restore() { this.minimized = false; },
    minimize() { this.minimized = true; },
    setAlwaysOnTop(flag, level) { this.alwaysOnTop = flag; this.level = flag ? level : null; },
    setBounds(bounds) { this.bounds = { ...bounds }; },
    setMinimizable(value) { this.minimizable = value; },
    setClosable(value) { this.closable = value; },
    moveTop() { this.topCount += 1; },
    focus() { this.focusCount += 1; },
    loadFile: async () => {},
  });
}

const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const secondary = { id: 2, bounds: { x: 1920, y: -200, width: 2560, height: 1440 } };

function setup({ displays = [primary] } = {}) {
  const created = [];
  class BrowserWindow {
    constructor(options) {
      const window = fakeWindow(options);
      created.push(window);
      return window;
    }
  }
  const main = fakeWindow();
  const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => displays });
  const powerMonitor = new EventEmitter();
  const intervals = new Set();
  const deferred = [];
  let clock = 0;
  const lock = createTimerLock({
    BrowserWindow,
    screen,
    powerMonitor,
    overlayFile: "lock-overlay.html",
    getMainWindow: () => main,
    now: () => clock,
    schedule: (callback) => { const timer = { callback }; intervals.add(timer); return timer; },
    cancel: (timer) => intervals.delete(timer),
    defer: (callback) => deferred.push(callback),
  });
  return {
    lock, main, screen, powerMonitor, intervals, deferred,
    overlays: () => created.filter((window) => !window.destroyed),
    setDisplays: (next) => { displays = next; },
    tick: (milliseconds = 1000) => {
      clock += milliseconds;
      for (const timer of [...intervals]) timer.callback();
    },
  };
}

test("a locked report blanks every display and keeps CRM above the overlays", () => {
  const h = setup({ displays: [primary, secondary] });
  h.lock.report("locked");
  h.lock.report("locked");

  assert.equal(h.lock.isActive(), true);
  assert.equal(h.overlays().length, 2, "one overlay per display, never duplicated");
  h.overlays().forEach((overlay, index) => {
    assert.deepEqual(overlay.bounds, [primary, secondary][index].bounds);
    assert.equal(overlay.visible, true);
    assert.equal(overlay.alwaysOnTop, true);
    assert.equal(overlay.level, "screen-saver", "overlays cover the taskbar");
    assert.equal(overlay.options.focusable, false, "clicking an overlay cannot take focus from CRM");
    assert.equal(overlay.options.skipTaskbar, true);
    assert.equal(overlay.options.frame, false);
    assert.equal(overlay.options.webPreferences.javascript, false);
  });
  assert.equal(h.main.alwaysOnTop, true);
  assert.equal(h.main.level, "screen-saver");
  assert.equal(h.main.minimizable, false);
  assert.equal(h.main.closable, false);
  assert.ok(h.main.focusCount >= 1);
});

test("starting a timer removes the lock and minimizes CRM again if it was minimized", () => {
  const h = setup();
  h.main.minimize();
  h.lock.report("locked");
  assert.equal(h.main.minimized, false, "the lock brings CRM forward immediately");

  h.lock.report("running");
  assert.equal(h.lock.isActive(), false);
  assert.equal(h.overlays().length, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.main.alwaysOnTop, false);
  assert.equal(h.main.minimizable, true);
  assert.equal(h.main.closable, true);
  assert.equal(h.main.minimized, true, "the employee gets their previous screen back");
});

test("signing out releases the lock without minimizing CRM", () => {
  const h = setup();
  h.main.minimize();
  h.lock.report("locked");
  h.lock.report("inactive");
  assert.equal(h.lock.isActive(), false);
  assert.equal(h.overlays().length, 0);
  assert.equal(h.main.minimized, false);
});

test("connecting or removing a monitor while locked rebuilds the overlays", () => {
  const h = setup();
  h.lock.start();
  h.lock.report("locked");
  assert.equal(h.overlays().length, 1);
  h.setDisplays([primary, secondary]);
  h.screen.emit("display-added");
  assert.deepEqual(h.overlays().map((overlay) => overlay.bounds), [primary.bounds, secondary.bounds]);
  h.setDisplays([secondary]);
  h.screen.emit("display-removed");
  assert.deepEqual(h.overlays().map((overlay) => overlay.bounds), [secondary.bounds]);
  h.screen.emit("display-metrics-changed");
  assert.equal(h.overlays().length, 1, "an unchanged layout keeps the existing overlay");
});

test("locked windows are restored if minimized or hidden, and focus returns to CRM", () => {
  const h = setup();
  h.lock.report("locked");
  h.main.minimize();
  h.lock.onMainWindowMinimize();
  assert.equal(h.main.minimized, false);

  const [overlay] = h.overlays();
  overlay.visible = false;
  h.tick();
  assert.equal(overlay.visible, true);

  const focusCount = h.main.focusCount;
  h.lock.onMainWindowBlur();
  h.deferred.forEach((callback) => callback());
  assert.equal(h.main.focusCount, focusCount + 1);
});

test("while nothing needs repair the lock never reorders windows, so open dropdowns stay visible", () => {
  // Chromium draws an open <select> list as its own window; moving CRM to the
  // top hides it behind CRM (verified in real Electron on Windows).
  const h = setup({ displays: [primary, secondary] });
  h.lock.start();
  h.lock.report("locked");
  const moves = () => [h.main, ...h.overlays()].map((window) => window.topCount);
  const settled = moves();
  for (let second = 0; second < 5; second += 1) {
    h.lock.report("locked");
    h.tick();
  }
  h.screen.emit("display-metrics-changed"); // e.g. the taskbar work area changed
  assert.deepEqual(moves(), settled);

  const [overlay] = h.overlays();
  overlay.visible = false;
  h.tick();
  assert.equal(overlay.visible, true);
  assert.ok(h.main.topCount > settled[0], "after a repair CRM is put back above the overlays");
});

test("a renderer that stops reporting releases the lock", () => {
  const h = setup();
  h.lock.report("locked");
  h.tick(RENDERER_SILENCE_LIMIT_MS - 1000);
  assert.equal(h.lock.isActive(), true);
  h.lock.report("locked");
  h.tick(RENDERER_SILENCE_LIMIT_MS - 1000);
  assert.equal(h.lock.isActive(), true, "each report restarts the silence window");
  h.tick(2000);
  assert.equal(h.lock.isActive(), false);
  assert.equal(h.overlays().length, 0);
});

test("waking from sleep keeps the lock, rebuilds overlays and re-checks the timer", () => {
  const h = setup();
  let resumed = 0;
  h.lock.start({ onResume: () => { resumed += 1; } });
  h.lock.report("locked");
  h.tick(RENDERER_SILENCE_LIMIT_MS - 1000);
  h.setDisplays([secondary]);
  h.powerMonitor.emit("resume");
  h.tick(2000);
  assert.equal(resumed, 1);
  assert.equal(h.lock.isActive(), true, "sleep is not treated as renderer silence");
  assert.deepEqual(h.overlays().map((overlay) => overlay.bounds), [secondary.bounds]);
});
