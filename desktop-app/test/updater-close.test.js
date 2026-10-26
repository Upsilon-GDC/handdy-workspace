const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { NsisUpdater } = require("electron-updater");
const { createUpdateService } = require("../app-updater");

// Fake Electron session: main.js installs permission handlers on it.
const fakeSession = () => {
  const handlers = {};
  return {
    handlers,
    defaultSession: {
      setPermissionRequestHandler(handler) { handlers.request = handler; },
      setPermissionCheckHandler(handler) { handlers.check = handler; },
    },
  };
};

test("real NSIS quit hook waits for the existing main-process timer-close handshake", async () => {
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    setPath() {}, setName() {}, getPath: () => "isolated-test-profile",
    getVersion: () => "1.2.23", whenReady: async () => {}, requestSingleInstanceLock: () => true,
  });
  let quits = 0;
  app.quit = () => {
    quits += 1;
    app.emit("before-quit"); app.emit("will-quit"); app.emit("quit", {}, 0);
  };
  const ipcMain = Object.assign(new EventEmitter(), { handle() {} });
  const windows = [];
  class Window extends EventEmitter {
    constructor() {
      super(); windows.push(this); this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {}, send() {}, getURL: () => "file:///index.html",
      });
    }
    loadFile() {}
    isDestroyed() { return this.destroyed; }
    close() {
      let prevented = false;
      this.emit("close", { preventDefault() { prevented = true; } });
      if (prevented) return;
      this.destroyed = true;
      this.emit("closed"); app.emit("window-all-closed");
    }
    static fromWebContents(sender) { return windows.find(win => win.webContents === sender); }
  }
  const timers = new Set();
  const schedule = callback => { const timer = { callback, unref() {} }; timers.add(timer); return timer; };
  const cancel = timer => timers.delete(timer);
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const updater = new NsisUpdater(null, {
    version: "1.2.23", isPackaged: true,
    onQuit: handler => app.once("quit", (_, code) => handler(code)),
  });
  let installs = 0;
  updater.doInstall = options => {
    assert.equal(options.isSilent, true);
    assert.equal(options.isForceRunAfter, false);
    installs += 1; return true;
  };
  updater.downloadedUpdateHelper = { file: "test-only-installer.exe", downloadedFileInfo: { isAdminRightsRequired: false } };
  const filename = path.resolve(__dirname, "../main.js");
  const context = vm.createContext({
    __dirname: path.dirname(filename), console, URL, process: { platform: "win32", env: {} },
    setTimeout: schedule, clearTimeout: cancel,
    require: name => {
      if (name === "electron") return {
        app, BrowserWindow: Window, ipcMain, Menu: { setApplicationMenu() {} },
        powerMonitor: new EventEmitter(), screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [] }),
        shell: {}, dialog: { showMessageBox: async () => ({ response: 0 }) }, session: fakeSession(),
      };
      if (name === "./api-config") return require("../api-config");
      if (name === "./timer-lock") return require("../timer-lock");
      if (name === "./app-updater") return { startAppUpdater: () => createUpdateService({
        app, autoUpdater: updater, logger, platform: "win32", schedule, cancel,
        Notification: { isSupported: () => false },
      }) };
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  await new Promise(resolve => setImmediate(resolve));
  updater.emit("update-downloaded", { version: "1.2.24" });
  // This is the real library's hook installed after its download completes.
  updater.addQuitHandler();
  assert.equal(installs, 0);
  assert.equal(quits, 0);
  const window = windows[0];
  window.close();
  assert.equal(window.isDestroyed(), false);
  ipcMain.emit("app:close-cancelled", { sender: window.webContents });
  assert.equal(installs, 0, "A failed timer stop must never trigger installation");
  assert.equal(timers.size, 0);
  window.close();
  assert.equal(installs, 0);
  ipcMain.emit("app:close-ready", { sender: window.webContents });
  assert.equal(window.isDestroyed(), true);
  assert.equal(quits, 1);
  assert.equal(installs, 1);
  assert.equal(timers.size, 0);
});

// Boots the real main.js with the automatic update restart wired in.
async function bootMainWithAutoRestart({ url = "file:///C:/CRM/resources/app.asar/dashboard.html", idleSeconds = 3600 } = {}) {
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    setPath() {}, setName() {}, getPath: () => "isolated-test-profile",
    getVersion: () => "1.2.31", whenReady: async () => {}, requestSingleInstanceLock: () => true,
  });
  let quits = 0;
  app.quit = () => { quits += 1; };
  const ipcMain = Object.assign(new EventEmitter(), { handle() {} });
  const windows = [];
  const sent = [];
  class Window extends EventEmitter {
    constructor() {
      super(); windows.push(this); this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {}, send: channel => sent.push(channel), getURL: () => url,
      });
    }
    loadFile() {}
    isDestroyed() { return this.destroyed; }
    // Window management used by the screen lock.
    setAlwaysOnTop() {} setMinimizable() {} setClosable() {} moveTop() {} focus() {} show() {} restore() {}
    isMinimized() { return false; } isVisible() { return true; } isFocused() { return true; }
    close() {
      let prevented = false;
      this.emit("close", { preventDefault() { prevented = true; } });
      if (prevented) return;
      this.destroyed = true;
      this.emit("closed"); app.emit("window-all-closed");
    }
    static fromWebContents(sender) { return windows.find(win => win.webContents === sender); }
  }
  const timers = new Set();
  const schedule = (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.add(timer); return timer; };
  const cancel = timer => timers.delete(timer);
  let clock = 0;
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  const installs = [];
  updater.quitAndInstall = (...args) => { installs.push(args); };
  const powerMonitor = Object.assign(new EventEmitter(), { getSystemIdleTime: () => idleSeconds });
  const electronSession = fakeSession();
  const filename = path.resolve(__dirname, "../main.js");
  const context = vm.createContext({
    __dirname: path.dirname(filename), console, URL, Date, process: { platform: "win32", env: {} },
    setTimeout: schedule, clearTimeout: cancel,
    require: name => {
      if (name === "electron") return {
        app, BrowserWindow: Window, ipcMain, Menu: { setApplicationMenu() {} },
        powerMonitor, screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [] }),
        shell: {}, dialog: { showMessageBox: async () => assert.fail("An update restart never shows the close warning") }, session: electronSession,
      };
      if (name === "./api-config") return require("../api-config");
      if (name === "./timer-lock") return require("../timer-lock");
      if (name === "./app-updater") return { startAppUpdater: (_app, hooks) => createUpdateService({
        app, autoUpdater: updater, logger: { info() {}, warn() {}, error() {} }, platform: "win32",
        schedule, cancel, now: () => clock, Notification: { isSupported: () => false }, ...hooks,
      }) };
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  await new Promise(resolve => setImmediate(resolve));
  const window = windows[0];
  const report = state => ipcMain.emit("timer-lock:set", { sender: window.webContents }, state);
  // Runs the pending restart check after `seconds`.
  const tick = (seconds) => {
    clock += seconds * 1000;
    const timer = [...timers].find(item => item.delay === 5_000);
    if (!timer) return false;
    timers.delete(timer);
    timer.callback();
    return true;
  };
  return { app, ipcMain, window, updater, installs, sent, report, tick, quits: () => quits, permissions: electronSession.handlers };
}

test("an update restarts CRM by itself while the screen is locked, after the timer-close handshake", async () => {
  const m = await bootMainWithAutoRestart();
  m.report("locked");
  m.updater.emit("update-downloaded", { version: "1.2.32" });
  m.tick(5);
  m.report("locked");
  m.tick(60);
  assert.deepEqual(m.sent, ["app:before-close"], "the renderer is asked to stop the timer first");
  assert.equal(m.window.isDestroyed(), false);
  assert.deepEqual(m.installs, [], "nothing installs before the renderer confirms");
  m.ipcMain.emit("app:close-ready", { sender: m.window.webContents });
  assert.equal(m.window.isDestroyed(), true);
  assert.deepEqual(m.installs, [[true, true]], "silent install, then CRM opens again");
  assert.equal(m.quits(), 0, "the updater quits CRM after starting the installer");
});

test("an update never restarts CRM while a timer is running", async () => {
  const m = await bootMainWithAutoRestart();
  m.updater.emit("update-downloaded", { version: "1.2.32" });
  for (let i = 0; i < 50; i += 1) {
    m.report("running");
    m.tick(60);
  }
  assert.deepEqual(m.sent, []);
  assert.deepEqual(m.installs, []);
});

test("a refused restart keeps CRM open and tries again later; the login page also qualifies", async () => {
  const m = await bootMainWithAutoRestart({ url: "file:///C:/CRM/resources/app.asar/index.html" });
  m.report("inactive");
  m.updater.emit("update-downloaded", { version: "1.2.32" });
  m.tick(5);
  m.tick(60);
  assert.deepEqual(m.sent, ["app:before-close"]);
  m.ipcMain.emit("app:close-cancelled", { sender: m.window.webContents });
  assert.equal(m.window.isDestroyed(), false);
  assert.deepEqual(m.installs, []);
  assert.ok(m.tick(5), "restart checks resume");
  m.tick(60);
  assert.deepEqual(m.sent, ["app:before-close", "app:before-close"]);
});

test("someone using the PC postpones the restart", async () => {
  const m = await bootMainWithAutoRestart({ idleSeconds: 3 });
  m.report("locked");
  m.updater.emit("update-downloaded", { version: "1.2.32" });
  for (let i = 0; i < 20; i += 1) {
    m.report("locked");
    m.tick(60);
  }
  assert.deepEqual(m.sent, []);
});

test("the desktop app refuses every browser permission request", async () => {
  const m = await bootMainWithAutoRestart();
  for (const permission of ["media", "geolocation", "notifications", "clipboard-read"]) {
    let granted;
    m.permissions.request({}, permission, (answer) => { granted = answer; });
    assert.equal(granted, false, permission);
    assert.equal(m.permissions.check({}, permission), false, permission);
  }
});
