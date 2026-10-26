const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;
const RESTART_CHECK_MS = 5 * 1000;
// How long CRM must have had no running timer, and the PC no keyboard or
// mouse input, before a downloaded update restarts CRM by itself.
const RESTART_QUIET_MS = 60 * 1000;

// Independent of renderer/auth/timer state. A downloaded update installs in
// one of two ways, both after the existing close handshake succeeds:
// - automatically: main.js supplies isSafeToRestart (no timer can be
//   interrupted) and restartForUpdate (runs the close handshake, then calls
//   installAndRestart). Once it has been safe, and the PC untouched, for
//   RESTART_QUIET_MS, CRM restarts, installs silently and opens again;
// - otherwise, or if CRM is closed first, the updater's quit hook installs
//   it when CRM closes.
function createUpdateService({
  app,
  autoUpdater,
  logger,
  Notification,
  platform = process.platform,
  schedule = setTimeout,
  cancel = clearTimeout,
  now = Date.now,
  isSafeToRestart = null,
  restartForUpdate = null,
  getSystemIdleSeconds = () => 0,
}) {
  if (!app.isPackaged || platform !== "win32") return null;

  let timer = null;
  let stopped = false;
  let checking = false;
  let downloaded = false;
  let progressBucket = -1;
  const autoRestart = typeof isSafeToRestart === "function" && typeof restartForUpdate === "function";
  let restartTimer = null;
  let safeSince = 0;
  let restarting = false;

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  logger.info(`[Updater] Current version: ${app.getVersion()}`);
  autoUpdater.on("checking-for-update", () => logger.info("[Updater] Checking GitHub Releases for updates..."));
  autoUpdater.on("update-available", (info) => {
    progressBucket = -1;
    logger.info(`[Updater] Update available: ${info.version}; downloading automatically.`);
  });
  autoUpdater.on("update-not-available", () => logger.info("[Updater] No new version available."));
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.min(100, Math.max(0, Math.floor(progress.percent)));
    const bucket = Math.floor(percent / 10);
    if (!Number.isFinite(percent) || bucket === progressBucket) return;
    progressBucket = bucket;
    logger.info(`[Updater] Download progress: ${percent}% (${progress.transferred}/${progress.total} bytes)`);
  });
  autoUpdater.on("error", (error) => {
    logger.error(`[Updater] Update error: ${error.message || String(error)}. CRM can continue running.`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    if (downloaded) return;
    downloaded = true;
    if (timer) cancel(timer);
    timer = null;
    if (autoRestart) {
      logger.info(`[Updater] Update downloaded: ${info.version}. CRM will restart to install it once no timer is running.`);
      notify("CRM Update Ready", `Version ${info.version} has been downloaded. CRM will restart by itself to install it when no timer is running. A running timer is never stopped for an update.`);
      watchForRestart();
      return;
    }
    logger.info(`[Updater] Update downloaded: ${info.version}. It will install when CRM closes normally.`);
    notify("CRM Update Ready", `Version ${info.version} has been downloaded. It will install when you close CRM. Continue working and reopen CRM after installation finishes.`);
  });

  function notify(title, body) {
    try {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    } catch (error) {
      logger.warn(`[Updater] Could not show update notification: ${error.message}`);
    }
  }

  function watchForRestart() {
    if (!autoRestart || stopped || restarting || restartTimer) return;
    restartTimer = schedule(() => { restartTimer = null; checkRestart(); }, RESTART_CHECK_MS);
    restartTimer.unref?.();
  }

  function systemIdleMs() {
    try {
      return Math.max(0, Number(getSystemIdleSeconds()) || 0) * 1000;
    } catch {
      return 0;
    }
  }

  function checkRestart() {
    if (stopped || restarting) return;
    if (!isSafeToRestart()) {
      safeSince = 0;
      watchForRestart();
      return;
    }
    if (!safeSince) safeSince = now();
    if (now() - safeSince < RESTART_QUIET_MS || systemIdleMs() < RESTART_QUIET_MS) {
      watchForRestart();
      return;
    }
    restarting = true;
    logger.info("[Updater] No timer running and no input for a minute; restarting CRM to install the update.");
    notify("Updating CRM", "CRM is restarting to install the update. It will open again in a moment.");
    restartForUpdate();
  }

  // main.js calls this when the close handshake for a restart was refused
  // (for example the server could not confirm the timer state).
  function resumeAutoRestart() {
    restarting = false;
    safeSince = 0;
    watchForRestart();
  }

  // main.js calls this once the close handshake has closed the window.
  function installAndRestart() {
    logger.info("[Updater] Installing the update silently; CRM will open again afterwards.");
    autoUpdater.quitAndInstall(true, true);
    // If the installer could not start, the updater does not quit; finish
    // closing so CRM is not left running without a window.
    const fallback = schedule(() => app.quit(), 10 * 1000);
    fallback?.unref?.();
  }

  function queueCheck(delay) {
    if (stopped || downloaded) return;
    timer = schedule(() => { timer = null; void check(); }, delay);
    timer.unref?.();
  }

  async function check() {
    if (stopped || downloaded || checking) return;
    if (timer) cancel(timer);
    timer = null;
    checking = true;
    let nextDelay = CHECK_INTERVAL_MS;
    try {
      const result = await autoUpdater.checkForUpdates();
      // checkForUpdates resolves before the automatic download finishes.
      // Await its promise to catch failures and avoid overlapping retries.
      if (result?.downloadPromise) await result.downloadPromise;
    } catch (error) {
      logger.warn(`[Updater] Check/download failed: ${error.message || String(error)}. Retrying in 15 minutes.`);
      nextDelay = RETRY_INTERVAL_MS;
    } finally {
      checking = false;
      queueCheck(nextDelay);
    }
  }

  function stop() {
    stopped = true;
    if (timer) cancel(timer);
    timer = null;
    if (restartTimer) cancel(restartTimer);
    restartTimer = null;
  }

  // will-quit follows successful window closure; a cancelled close keeps
  // update checks running. Do not remove electron-updater's quit listener.
  app.once("will-quit", stop);
  queueCheck(STARTUP_DELAY_MS);
  return { check, stop, installAndRestart, resumeAutoRestart };
}

// `hooks` enables the automatic restart; see createUpdateService.
function startAppUpdater(app, hooks = {}) {
  if (!app.isPackaged || process.platform !== "win32") return;
  try {
    const { autoUpdater } = require("electron-updater");
    const logger = require("electron-log/main");
    const { Notification } = require("electron");
    const path = require("path");
    logger.transports.file.resolvePathFn = () => path.join(app.getPath("userData"), "logs", "updater.log");
    logger.transports.file.maxSize = 1024 * 1024;
    logger.transports.file.level = "info";
    logger.transports.console.level = "info";
    return createUpdateService({ app, autoUpdater, logger, Notification, ...hooks });
  } catch (error) {
    console.error(`[Updater] Could not initialize updates: ${error.message}. CRM can continue running.`);
  }
}

module.exports = {
  createUpdateService,
  startAppUpdater,
  CHECK_INTERVAL_MS,
  RESTART_CHECK_MS,
  RESTART_QUIET_MS,
  RETRY_INTERVAL_MS,
  STARTUP_DELAY_MS,
};
