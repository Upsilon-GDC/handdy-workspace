const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { NsisUpdater } = require("electron-updater");
const { createUpdateService } = require("../app-updater");

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
        shell: {}, dialog: { showMessageBox: async () => ({ response: 0 }) },
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
