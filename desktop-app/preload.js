const { contextBridge, ipcRenderer } = require("electron");

const apiBaseUrl = ipcRenderer.sendSync("config:get-api-base-url");
const deviceInfo = ipcRenderer.sendSync("config:get-device-info");

contextBridge.exposeInMainWorld("electronAPI", {
  getIdleDefaults: () => ipcRenderer.invoke("system:idle-defaults"),
  isElectron: true,
  platform: process.platform,
  apiBaseUrl,
  deviceInfo,
  getSystemIdleTime: () => ipcRenderer.invoke("system:get-idle-time"),
  onBeforeClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:before-close", listener);
    return () => ipcRenderer.removeListener("app:before-close", listener);
  },
  notifyCloseReady: () => ipcRenderer.send("app:close-ready"),
  notifyCloseCancelled: () => ipcRenderer.send("app:close-cancelled"),
  setTimerLock: (state) => ipcRenderer.send("timer-lock:set", String(state)),
  onSystemResume: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("system:resume", listener);
    return () => ipcRenderer.removeListener("system:resume", listener);
  },
});
