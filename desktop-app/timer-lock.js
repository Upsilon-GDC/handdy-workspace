// Full-screen lock shown while a signed-in employee has no running timer.
// A blank overlay covers every display; the CRM window stays above the
// overlays so the employee can start a timer, which removes the lock.
//
// The renderer owns the timer state and reports it with report():
//   "locked"   - signed in, timer confirmed not running (or idle stop pending)
//   "running"  - a timer is running; restore the screen the employee had
//   "inactive" - lock does not apply (signed out, closing, server unreachable)
// It repeats its report every idle poll, so a renderer that stops reporting
// (crash or hang) releases the lock instead of trapping the employee.

const LOCK_LEVEL = "screen-saver"; // Above the Windows taskbar.
const ENFORCE_INTERVAL_MS = 1000;
const RENDERER_SILENCE_LIMIT_MS = 30_000;
const REFOCUS_DELAY_MS = 150;

function createTimerLock({
  BrowserWindow,
  screen,
  powerMonitor,
  overlayFile,
  getMainWindow,
  now = Date.now,
  schedule = setInterval,
  cancel = clearInterval,
  defer = setTimeout,
}) {
  let active = false;
  let overlays = [];
  let overlayLayout = "";
  let enforceTimer = null;
  let lastReportAt = 0;
  let restoreMinimized = false;
  let started = false;

  const liveMainWindow = () => {
    const main = getMainWindow();
    return main && !main.isDestroyed() ? main : null;
  };

  function createOverlay(display) {
    const overlay = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      closable: false,
      // Clicking the overlay never takes focus away from the CRM window.
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: "#0b1220",
      title: "CRM",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    overlay.setAlwaysOnTop(true, LOCK_LEVEL);
    // Re-applying the bounds corrects placement on mixed-DPI monitors.
    overlay.setBounds(display.bounds);
    overlay.on("close", (event) => event.preventDefault());
    overlay.webContents.on("will-navigate", (event) => event.preventDefault());
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlay.webContents.once("did-finish-load", () => {
      if (!overlay.isDestroyed()) overlay.setBounds(display.bounds);
    });
    void overlay.loadFile(overlayFile).catch(() => {
      // The background colour alone still blanks the display.
    });
    overlay.showInactive();
    return overlay;
  }

  function destroyOverlays() {
    for (const overlay of overlays) {
      if (!overlay.isDestroyed()) overlay.destroy();
    }
    overlays = [];
    overlayLayout = "";
  }

  // Rebuilds the overlays only when the monitor layout changed. Returns
  // whether it did, because new overlays appear on top of the CRM window.
  function syncOverlays() {
    const displays = screen.getAllDisplays();
    const layout = JSON.stringify(displays.map(({ id, bounds }) => [id, bounds]));
    if (layout === overlayLayout && overlays.every((overlay) => !overlay.isDestroyed())) return false;
    destroyOverlays();
    overlays = displays.map(createOverlay);
    overlayLayout = layout;
    return true;
  }

  function raise({ focus = false } = {}) {
    if (!active) return;
    for (const overlay of overlays) {
      if (overlay.isDestroyed()) continue;
      if (overlay.isMinimized()) overlay.restore();
      if (!overlay.isVisible()) overlay.showInactive();
      overlay.moveTop();
    }
    const main = liveMainWindow();
    if (!main) return;
    if (main.isMinimized()) main.restore();
    if (!main.isVisible()) main.show();
    main.moveTop();
    if (focus) main.focus();
  }

  // Runs every second while locked, but only repairs windows that were
  // hidden, minimized or destroyed. It must not reorder windows when nothing
  // is wrong: Chromium draws an open dropdown list (Project, Client, Task) as
  // a separate window, and moving CRM to the top would hide that list.
  function enforce() {
    if (!active) return;
    if (now() - lastReportAt > RENDERER_SILENCE_LIMIT_MS) {
      release();
      return;
    }
    const main = liveMainWindow();
    if (!main) {
      release();
      return;
    }
    let repaired = syncOverlays();
    for (const overlay of overlays) {
      if (overlay.isMinimized() || !overlay.isVisible()) repaired = true;
    }
    if (main.isMinimized() || !main.isVisible()) repaired = true;
    // raise() restores and shows each window, then puts CRM back on top.
    if (repaired) raise();
  }

  function engage() {
    const main = liveMainWindow();
    if (!main) return;
    active = true;
    restoreMinimized = main.isMinimized() || !main.isVisible();
    syncOverlays();
    main.setAlwaysOnTop(true, LOCK_LEVEL);
    main.setMinimizable(false);
    main.setClosable(false);
    raise({ focus: true });
    cancel(enforceTimer);
    enforceTimer = schedule(enforce, ENFORCE_INTERVAL_MS);
    enforceTimer?.unref?.();
  }

  function release({ restoreScreen = false } = {}) {
    if (!active) return;
    active = false;
    cancel(enforceTimer);
    enforceTimer = null;
    destroyOverlays();
    const main = liveMainWindow();
    if (!main) return;
    main.setAlwaysOnTop(false);
    main.setMinimizable(true);
    main.setClosable(true);
    // Starting a timer returns the employee to the screen they had before
    // the lock, so a CRM window that was minimized is minimized again.
    if (restoreScreen && restoreMinimized) main.minimize();
  }

  function report(state) {
    lastReportAt = now();
    if (state === "locked") {
      if (!active) engage();
      return;
    }
    release({ restoreScreen: state === "running" });
  }

  function onMainWindowBlur() {
    if (!active) return;
    // Another app was activated (Alt+Tab, the Start menu, a pop-up). It
    // stays hidden behind the overlays; pull focus back to CRM.
    defer(() => {
      const main = liveMainWindow();
      if (active && main && !main.isFocused()) raise({ focus: true });
    }, REFOCUS_DELAY_MS);
  }

  function onMainWindowMinimize() {
    if (!active) return;
    liveMainWindow()?.restore();
    raise({ focus: true });
  }

  // display-metrics-changed also fires for work-area changes (taskbar), so
  // reorder only when the overlays were actually rebuilt.
  function onDisplaysChanged() {
    if (active && syncOverlays()) raise();
  }

  // Call after app "ready": screen and powerMonitor are unavailable before.
  function start({ onResume } = {}) {
    if (started) return;
    started = true;
    screen.on("display-added", onDisplaysChanged);
    screen.on("display-removed", onDisplaysChanged);
    screen.on("display-metrics-changed", onDisplaysChanged);
    powerMonitor.on("resume", () => {
      // Timers did not run during sleep; do not treat that as renderer silence.
      lastReportAt = now();
      if (active) {
        syncOverlays();
        raise();
      }
      onResume?.();
    });
    powerMonitor.on("unlock-screen", () => raise({ focus: true }));
  }

  return {
    start,
    report,
    release,
    isActive: () => active,
    onMainWindowBlur,
    onMainWindowMinimize,
  };
}

module.exports = { createTimerLock, ENFORCE_INTERVAL_MS, RENDERER_SILENCE_LIMIT_MS };
