const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const defaults = require("../idle-policy-defaults.json");

function harness({ timer = "running", idle = 0, outage = false, activeTaskIdleLogout = true, stopWorkedSeconds = 23 * 60 + 26, page = "login" } = {}) {
  const calls = [];
  const intervals = new Map();
  let nextInterval = 0;
  const nodes = new Map();
  const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  };
  const localStorage = storage();
  const state = { idle, outage, stopBody: null, timer: timer ? { _id: "existing", status: timer, startedAt: new Date().toISOString(), pauses: [], totalWorkedSeconds: 0 } : null, beforeClose: null, closeReady: 0, closeCancelled: 0, lock: [] };
  const context = vm.createContext({
    console, AbortSignal, Date, localStorage, sessionStorage: storage(),
    setInterval(callback) { intervals.set(++nextInterval, callback); return nextInterval; },
    clearInterval(id) { intervals.delete(id); },
    document: {
      body: { dataset: { page } },
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { textContent: "", style: {}, open: false, shown: 0,
          classList: { add() {}, remove() {} }, listeners: {},
          addEventListener(event, callback) { this.listeners[event] = callback; },
          showModal() { this.open = true; this.shown += 1; }, close() { this.open = false; } });
        return nodes.get(id);
      },
      querySelectorAll: () => [], addEventListener() {},
    },
    window: { electronAPI: {
      getSystemIdleTime: async () => state.idle,
      getIdleDefaults: async () => defaults,
      onBeforeClose: (callback) => { state.beforeClose = callback; },
      notifyCloseReady: () => { state.closeReady += 1; },
      notifyCloseCancelled: () => { state.closeCancelled += 1; },
      setTimerLock: (value) => { state.lock.push(value); },
    }, location: { replace: value => calls.push(value) }, addEventListener() {} },
    fetch: async (url, options = {}) => {
      calls.push(url);
      if (state.outage) throw new Error("offline");
      if (url.endsWith("/pause")) {
        assert.equal(state.timer.status, "running");
        state.timer = { ...state.timer, status: "paused", pauses: [...state.timer.pauses, { pausedAt: new Date().toISOString(), reason: JSON.parse(options.body).reason }] };
      }
      if (url.endsWith("/resume")) state.timer = { ...state.timer, status: "running", pauses: state.timer.pauses.map(pause => pause.resumedAt ? pause : { ...pause, resumedAt: new Date().toISOString() }) };
      if (url.endsWith("/stop")) {
        state.stopBody = options.body ? JSON.parse(options.body) : {};
        const stoppedAt = new Date().toISOString();
        const idlePause = state.stopBody.idleSeconds > 0 ? [{ reason: "idle", resumedAt: stoppedAt,
          pausedAt: new Date(Date.now() - state.stopBody.idleSeconds * 1000).toISOString() }] : [];
        state.timer = { ...state.timer, stoppedAt, pauses: [...state.timer.pauses, ...idlePause],
          status: "stopped", totalWorkedSeconds: stopWorkedSeconds };
      }
      return { ok: true, status: 200, json: async () => ({ timeLog: state.timer, idlePolicy: { idleThresholdMinutes: 10, autoLogoutMinutes: 30 } }) };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../renderer.js"), "utf8"), context);
  localStorage.setItem("token", "test-only");
  context.seed = state.timer;
  context.defaults = defaults;
  vm.runInContext(`idleDefaults = defaults; idlePolicy = normalizedDesktopPolicy({ idleThresholdMinutes: 5, autoLogoutMinutes: 30 }); currentTimeLog = seed; activeTaskIdleLogout = ${activeTaskIdleLogout};`, context);
  return { state, calls, context, nodes, intervals, run: source => vm.runInContext(source, context), check: () => context.checkSystemIdleState() };
}

test("idle popup appears once, acknowledges without resuming, and appears for the next work session", async () => {
  const h = harness({ idle: 300 });
  await h.check();
  const dialog = h.nodes.get("idleStartedDialog");
  assert.equal(dialog.open, true);
  assert.equal(dialog.shown, 1);
  assert.equal(h.nodes.get("idleStartedDuration").textContent, "05 mins");
  assert.equal(h.nodes.get("idleLogoutCountdown").textContent, "25 Mins 00 Secs");
  assert.match(h.nodes.get("idleStartedTime").textContent, /Idle started at/);
  h.nodes.get("acknowledgeIdleButton").listeners.click();
  assert.equal(dialog.open, false);
  assert.equal(h.run("idleNoticeInterval"), null);
  const calls = h.calls.length;
  await h.check(); await h.check();
  assert.equal(dialog.shown, 1);
  assert.equal(h.intervals.size, 0, "acknowledgement removes the display interval");
  assert.equal(h.calls.length, calls);
  h.state.idle = 0;
  await h.check();
  assert.equal(h.run("currentTimeLog"), null);
  h.state.timer = { _id: "new-task-session", status: "running", startedAt: new Date().toISOString(), pauses: [] };
  h.context.nextSession = h.state.timer;
  h.run("currentTimeLog = nextSession");
  h.state.idle = 300;
  h.run("idleAcknowledgedAt = Date.now() - 300_000");
  await h.check();
  assert.equal(dialog.shown, 2);
  await h.check();
  assert.equal(h.intervals.size, 1, "a new warning owns only one display interval");
});

test("idle popup uses the configured threshold and preserves independent idle records", async () => {
  const h = harness({ idle: 600 });
  h.run("idlePolicy = normalizedDesktopPolicy({ idleThresholdMinutes: 10, autoLogoutMinutes: 30 })");
  await h.check();
  assert.equal(h.nodes.get("idleStartedDuration").textContent, "10 mins");
  assert.equal(h.nodes.get("idleLogoutCountdown").textContent, "20 Mins 00 Secs");
  assert.equal(h.state.timer.pauses.at(-1).reason, "idle");
  assert.equal(h.state.timer.pauses.at(-1).mergedIntoPreviousWork, undefined);
  assert.equal(h.state.stopBody.idleSeconds, 600);
});

test("idle warning starts at five minutes and only Continue resets its fifty-minute countdown", async () => {
  const h = harness({ idle: 300 });
  h.run("idlePolicy = normalizedDesktopPolicy()");
  await h.check();
  assert.equal(h.nodes.get("idleStartedDuration").textContent, "05 mins");
  assert.equal(h.nodes.get("idleLogoutCountdown").textContent, "45 Mins 00 Secs");
  h.run("idleNoticeSnapshot.observedAt = Date.now() - 2200; updateIdleStartedPopup()");
  assert.equal(h.nodes.get("idleLogoutCountdown").textContent, "44 Mins 58 Secs");
  h.run("idleNoticeSnapshot.observedAt = Date.now() - 65_000");
  h.state.idle = 0;
  await h.check();
  assert.equal(h.nodes.get("idleStartedDuration").textContent, "06 mins");
  assert.equal(h.nodes.get("idleLogoutCountdown").textContent, "43 Mins 55 Secs");
  assert.equal(h.nodes.get("idleStartedDialog").open, true, "mouse activity cannot close the warning");
  h.nodes.get("acknowledgeIdleButton").listeners.click({ isTrusted: false });
  assert.equal(h.nodes.get("idleStartedDialog").open, true, "programmatic clicks cannot acknowledge inactivity");
  let cancelled = false;
  h.nodes.get("idleStartedDialog").listeners.cancel({ preventDefault() { cancelled = true; } });
  assert.equal(cancelled, true, "Escape cannot dismiss the warning");
  const calls = h.calls.length;
  await h.run("runTimerAction(() => stopTimer())");
  assert.equal(h.calls.length, calls, "the modal prevents another timer action");
  h.nodes.get("acknowledgeIdleButton").listeners.click({ isTrusted: true });
  h.state.idle = 3000;
  await h.check();
  assert.ok(h.context.localStorage.getItem("token"), "Continue resets even a stale OS-idle reading");
  assert.equal(h.run("currentTimeLog"), null);
  h.run("idleAcknowledgedAt = Date.now() - 3000_000");
  await h.check();
  assert.equal(h.context.localStorage.getItem("token"), null, "existing OS monitor still logs out");
  assert.equal(h.run("idleNoticeInterval"), null);
  assert.equal(h.nodes.get("idleStartedDialog").open, false);
});

test("unacknowledged popup logs out at fifty minutes even after mouse or keyboard activity", async () => {
  const h = harness({ idle: 299 });
  h.run("idlePolicy = normalizedDesktopPolicy()");
  await h.check();
  assert.equal(h.nodes.get("idleStartedDialog").open, false);
  h.state.idle = 300;
  await h.check();
  h.state.idle = 0;
  h.run("idleNoticeSnapshot.observedAt = Date.now() - 2700_000");
  await h.check();
  assert.equal(h.context.localStorage.getItem("token"), null);
  assert.equal(h.calls.filter(url => url.endsWith('/stop')).length, 1);
  assert.equal(h.calls.filter(url => url.endsWith('/auth/logout')).length, 1);
});

test("thirty-second testing override is configured once without changing saved minute policies", () => {
  const h = harness();
  h.run("idleDefaults = { ...defaults, idleWarningTestSeconds: 30 }; idlePolicy = normalizedDesktopPolicy()");
  assert.equal(h.run("idlePolicy.thresholdSeconds"), 30);
  assert.equal(h.run("idlePolicy.logoutSeconds"), 3000);
  h.run("showIdleStartedPopup(seed, 30)");
  assert.equal(h.nodes.get("idleStartedDuration").textContent, '30 secs');
});

test("idle popup is absent before transition, during breaks, exemption, manual stop and network failure", async () => {
  for (const kind of ["before", "break", "exempt", "manual", "offline", "no-timer"]) {
    const h = harness({ idle: kind === "before" ? 299 : 300,
      outage: kind === "offline", timer: kind === "no-timer" ? null : "running" });
    if (kind === "break") h.run("currentTimeLog.task = { taskType: 'break' }");
    if (kind === "exempt") h.run("idlePolicy.exempt = true");
    if (kind === "manual") await h.run("stopTimer()");
    else await h.check();
    assert.equal(h.nodes.get("idleStartedDialog").shown, 0, kind);
  }
});

test("idle popup waits for a successful retry after an outage", async () => {
  const h = harness({ idle: 300, outage: true });
  await h.check();
  assert.equal(h.nodes.get("idleStartedDialog").shown, 0);
  h.state.outage = false;
  await h.check(); await h.check();
  assert.equal(h.nodes.get("idleStartedDialog").shown, 1);
});

test("an offline idle stop freezes work and retries its original cutoff even after mouse activity", async () => {
  const h = harness({ idle: 300, outage: true });
  h.state.timer.startedAt = new Date(Date.now() - 600_000).toISOString();
  await h.check();
  assert.match(h.nodes.get("timerDuration").textContent, /00:05:0[01]/);
  assert.ok(h.run("pendingIdleStop"));
  const frozen = h.nodes.get("timerDuration").textContent;
  h.run("pendingIdleStop.startedAt -= 60_000");
  h.state.idle = 0;
  await h.check();
  assert.equal(h.nodes.get("timerDuration").textContent, frozen);
  h.state.outage = false;
  await h.check();
  assert.ok(h.state.stopBody.idleSeconds >= 360);
  assert.equal(h.state.timer.status, 'stopped');
  assert.equal(h.run("pendingIdleStop"), null);
  assert.equal(h.nodes.get("idleStartedDialog").shown, 1);
});

test("five idle minutes stop work once and reset the clock", async () => {
  const h = harness();
  await h.check(); assert.equal(h.calls.length, 0);
  h.state.idle = 300;
  await h.check(); await h.check();
  assert.equal(h.calls.filter(url => url.endsWith("/stop")).length, 1);
  assert.equal(h.state.stopBody.idleSeconds, 300);
  assert.equal(h.state.timer.status, "stopped");
  assert.equal(h.nodes.get("timerDuration").textContent, "00:00:00");
  assert.match(h.nodes.get("timerStatus").textContent, /Idle/);
});

test("thirty minutes pauses, closes the timer, then logs out exactly once", async () => {
  const h = harness({ idle: 1800 });
  h.context.localStorage.setItem("rememberedSessionToken", "remember-me");
  h.context.localStorage.setItem("rememberedUser", "user");
  await Promise.all([h.check(), h.check()]); await h.check();
  assert.equal(h.calls.filter(url => url.endsWith("/auth/logout")).length, 1);
  assert.ok(h.calls.findIndex(url => url.endsWith("/stop")) < h.calls.findIndex(url => url.endsWith("/auth/logout")));
  assert.equal(h.context.localStorage.getItem("token"), null);
  assert.equal(h.context.localStorage.getItem("rememberedSessionToken"), null);
  assert.equal(h.context.localStorage.getItem("rememberedUser"), null);
  assert.equal(h.state.timer.status, "stopped");
});

test("manual sign-out preserves the remembered account for quick login", async () => {
  const h = harness({ timer: null });
  h.context.localStorage.setItem("rememberedSessionToken", "remember-me");
  h.context.localStorage.setItem("rememberedUser", JSON.stringify({ fullName: "Test Employee" }));

  await h.run("signOut(false)");

  assert.equal(h.context.localStorage.getItem("token"), null);
  assert.equal(h.context.localStorage.getItem("rememberedSessionToken"), "remember-me");
  assert.ok(h.context.localStorage.getItem("rememberedUser"));
  assert.equal(h.calls.filter((url) => url.endsWith("/auth/logout")).length, 1);
});

test("new-device login explains approval on the existing computer", async () => {
  const h = harness({ timer: null });
  h.run("loginInProgress = true");
  await h.run(`waitForDeviceApproval({
    requestId: "approval-test", requestToken: "test-only",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    activeDevice: { deviceName: "OLD-PC" }
  })`);
  assert.match(h.nodes.get("message").textContent, /OLD-PC/);
  assert.match(h.nodes.get("message").textContent, /Allow New Device/);
  assert.equal(h.nodes.get("loginButton").textContent, "Waiting for approval...");
  assert.ok(h.calls.some((url) => url.endsWith("/login-requests/approval-test/wait")));
});

test("closing the desktop app stops the backend timer without logging out", async () => {
  const h = harness({ timer: "running" });
  assert.equal(typeof h.state.beforeClose, "function");

  await h.state.beforeClose();

  assert.equal(h.state.timer.status, "stopped");
  assert.equal(h.calls.filter((url) => url.endsWith("/stop")).length, 1);
  assert.equal(h.calls.filter((url) => url.endsWith("/auth/logout")).length, 0);
  assert.equal(h.context.localStorage.getItem("token"), "test-only");
  assert.equal(h.state.closeReady, 1);
});

test("close is cancelled if the backend cannot confirm the timer stopped", async () => {
  const h = harness({ timer: "running", outage: true });

  await h.state.beforeClose();

  assert.equal(h.state.timer.status, "running");
  assert.equal(h.state.closeReady, 0);
  assert.equal(h.state.closeCancelled, 1);
  assert.match(h.nodes.get("timerMessage").textContent, /could not be stopped/);
});

test("reopening after a confirmed close does not revive the previous timer", async () => {
  const h = harness({ timer: "running" });
  await h.state.beforeClose();
  h.state.timer = null;

  await h.context.loadActiveTimer();

  assert.equal(h.nodes.get("timerDuration").textContent, "00:00:00");
  assert.equal(h.nodes.get("timerStatus").textContent, "Not Started");
  assert.equal(h.nodes.get("stopTimerButton").disabled, true);
});

test("desktop heartbeats only while a leased timer is active", async () => {
  const h = harness({ timer: "running" });
  await h.run("sendTimerHeartbeat()");
  assert.equal(h.calls.filter(url => url.endsWith("/heartbeat")).length, 0);

  h.run("currentTimeLog.desktopHeartbeatAt = new Date().toISOString()");
  await h.run("sendTimerHeartbeat()");
  assert.equal(h.calls.filter(url => url.endsWith("/heartbeat")).length, 1);

  h.run("currentTimeLog = null");
  await h.run("sendTimerHeartbeat()");
  assert.equal(h.calls.filter(url => url.endsWith("/heartbeat")).length, 1);
});

test("stopping a long session resets the live clock while preserving the saved duration", async () => {
  const h = harness({ stopWorkedSeconds: 40 * 3600 + 52 * 60 + 9 });
  h.nodes.get("timerDuration").textContent = "40:52:09";

  await h.context.stopTimer();

  assert.equal(h.state.timer.totalWorkedSeconds, 40 * 3600 + 52 * 60 + 9);
  assert.equal(h.nodes.get("timerDuration").textContent, "00:00:00");
  assert.equal(h.nodes.get("timerStatus").textContent, "Stopped");
  assert.equal(h.nodes.get("stopTimerButton").disabled, true);
});

test("Stop Break ends an active break once and restores task selection", async () => {
  const h = harness();
  h.run('currentTimeLog.task = { _id: "lunch", taskType: "break" }; currentTimeLog.startedAt = new Date(Date.now() - 60000).toISOString(); updateBreakUI()');
  const button = h.nodes.get("stopBreakButton");
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  const pending = button.listeners.click();
  assert.equal(button.disabled, true);
  await button.listeners.click();
  await pending;
  assert.equal(h.calls.filter(url => url.endsWith("/stop")).length, 1);
  assert.equal(h.state.timer.status, "stopped");
  assert.equal(h.run("currentTimeLog"), null);
  assert.equal(h.nodes.get("taskSelect").value, "");
  assert.equal(h.nodes.get("startTimerButton").disabled, false);
  assert.equal(h.nodes.get("breakDuration").textContent, "00:00:00");
  assert.equal(button.hidden, true);
});

test("Stop Break stays available after a failed request and is absent for work", async () => {
  const h = harness({ outage: true });
  h.run('currentTimeLog.task = { taskType: "break" }; updateBreakUI()');
  const button = h.nodes.get("stopBreakButton");
  await button.listeners.click();
  assert.equal(h.run("currentTimeLog.status"), "running");
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  h.state.outage = false;
  await button.listeners.click();
  assert.equal(button.hidden, true);
  h.run('currentTimeLog = { status: "running", task: { taskType: "work" } }; updateBreakUI()');
  assert.equal(button.hidden, true);
  const calls = h.calls.length;
  await button.listeners.click();
  assert.equal(h.calls.length, calls);
});

test("completed break tasks contribute only to break totals", () => {
  const h = harness({ timer: null });
  const result = h.run(`(() => {
    const timeline = buildChronologicalTimeline([{
      status: "stopped",
      task: { _id: "break-task", taskName: "Lunch", taskType: "break" },
      startedAt: "2026-09-18T10:00:00.000Z",
      stoppedAt: "2026-09-18T10:30:00.000Z",
      totalWorkedSeconds: 1800,
      pauses: []
    }]);
    return { types: timeline.map(({ entry }) => entry.type), totals: summarizeTimeline(timeline) };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    types: ["break"],
    totals: { workSeconds: 0, breakSeconds: 1800, idleSeconds: 0 },
  });
});

test("logout also applies without an active timer and for idle-exempt staff", async () => {
  for (const timer of [null, "running"]) {
    // activeTaskIdleLogout defaults to false here (the real default when no
    // task opted into idle enforcement is running) to prove the session-level
    // auto-logout fires regardless of that per-task flag, and idlePolicy.exempt
    // (which only exempts active work from idle auto-pause) doesn't block it either.
    const h = harness({ timer, idle: 1800, activeTaskIdleLogout: false });
    h.run("idlePolicy.exempt = true");
    await h.check();
    assert.equal(h.context.localStorage.getItem("token"), null);
  }
});

test("activity after idle stop cannot resume old work", async () => {
  const h = harness({ idle: 300 }); await h.check();
  h.state.idle = 0; await h.check();
  assert.equal(h.state.timer.status, "stopped");
  assert.equal(h.calls.some(url => url.endsWith("/resume")), false);
  assert.equal(h.calls.some(url => url.endsWith("/auth/logout")), false);
});

test("a later mouse movement leaves work stopped until Continue and Start", async () => {
  const h = harness({ idle: 300 }); await h.check();
  h.state.idle = 50; await h.check();
  assert.equal(h.state.timer.status, "stopped");
  assert.equal(h.calls.some(url => url.endsWith("/resume")), false);
});

test("idle stops work even when the old per-task flag is disabled", async () => {
  const h = harness({ idle: 300, activeTaskIdleLogout: false });
  await h.check();
  assert.equal(h.state.timer.status, "stopped");
  assert.equal(h.state.stopBody.idleSeconds, 300);
});

test("intentional break is exempt from idle stop but not account auto-logout", async () => {
  const h = harness({ timer: "paused", idle: 1800 });
  h.state.timer.pauses = [{ pausedAt: new Date().toISOString(), reason: "break" }];
  h.run("currentTimeLog = seed");
  await h.check();
  assert.equal(h.state.timer.status, "stopped");
  assert.equal(h.calls.filter((url) => url.endsWith("/stop")).length, 1);
  assert.equal(h.calls.filter((url) => url.endsWith("/auth/logout")).length, 1);
  assert.equal(h.context.localStorage.getItem("token"), null);
});

test("desktop honors short inactivity values saved by the administrator", () => {
  const h = harness({ timer: null });
  h.run("idlePolicy = normalizedDesktopPolicy({ idleThresholdMinutes: 1, autoLogoutMinutes: 2 })");
  assert.equal(h.run("idlePolicy.thresholdSeconds"), 60);
  assert.equal(h.run("idlePolicy.logoutSeconds"), 120);
});

test("manual break button is absent while legacy break records still render", async () => {
  const h = harness();
  assert.equal(h.run("pauseTimerButton"), null);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../dashboard.html"), "utf8"), /id="breakTimerButton"/);
  await h.run('pauseTimer("break")');
  assert.equal(h.nodes.get("timerStatus").textContent, "On Break");
  assert.equal(h.run("timerInterval !== null"), true);
  await h.run('resumeTimer("break")');
  assert.equal(h.nodes.get("timerDuration").textContent, "00:00:00");
});

test("current work display resets after each break while completed work remains in history", () => {
  const h = harness({ timer: null });
  const timeLog = `{
    status: "running",
    startedAt: "2026-09-18T10:00:00.000Z",
    pauses: [
      { reason: "break", pausedAt: "2026-09-18T10:10:00.000Z", resumedAt: "2026-09-18T10:15:00.000Z" },
      { reason: "break", pausedAt: "2026-09-18T10:20:00.000Z", resumedAt: "2026-09-18T10:22:00.000Z" }
    ]
  }`;
  assert.equal(h.run(`calculateCurrentWorkSeconds(${timeLog}, new Date("2026-09-18T10:22:00.000Z").getTime())`), 0);
  assert.equal(h.run(`calculateCurrentWorkSeconds(${timeLog}, new Date("2026-09-18T10:22:07.000Z").getTime())`), 7);
  const workRows = h.run(`buildTimeLogTimeline(${timeLog}, new Date("2026-09-18T10:22:07.000Z").getTime())
    .filter(entry => entry.type === "work").map(entry => entry.seconds)`);
  assert.deepEqual(JSON.parse(JSON.stringify(workRows)), [600, 300, 7]);
});

test("current work display freezes during an active break and restores that segment after restart", () => {
  const h = harness({ timer: null });
  const seconds = h.run(`calculateCurrentWorkSeconds({
    status: "paused",
    startedAt: "2026-09-18T10:00:00.000Z",
    pauses: [
      { reason: "break", pausedAt: "2026-09-18T10:10:00.000Z", resumedAt: "2026-09-18T10:15:00.000Z" },
      { reason: "break", pausedAt: "2026-09-18T10:20:00.000Z", resumedAt: null }
    ]
  }, new Date("2026-09-18T10:25:00.000Z").getTime())`);
  assert.equal(seconds, 300);
});

test("each new Break display starts at zero without counting completed breaks", () => {
  const h = harness();
  const seconds = h.run(`calculateBreakSeconds({ status: "paused", pauses: [
    { reason: "break", pausedAt: new Date(Date.now() - 120000).toISOString(), resumedAt: new Date(Date.now() - 60000).toISOString() },
    { reason: "break", pausedAt: new Date().toISOString(), resumedAt: null }
  ] })`);
  assert.equal(seconds, 0);
});

test("ending successive breaks resets the visible clock and preserves both history segments", async () => {
  const h = harness();
  h.state.timer.startedAt = new Date(Date.now() - 1200000).toISOString();
  for (const minutes of [10, 5]) {
    await h.run('pauseTimer("break")');
    assert.equal(h.nodes.get("breakDuration").textContent, "00:00:00");
    h.state.timer.pauses.at(-1).pausedAt = new Date(Date.now() - minutes * 60000).toISOString();
    for (const tick of h.intervals.values()) tick();
    assert.equal(h.nodes.get("breakDuration").textContent, minutes === 10 ? "00:10:00" : "00:05:00");
    assert.equal(h.nodes.get("timesheetBreakDuration").textContent, h.nodes.get("breakDuration").textContent);
    const oldInterval = h.run("timerInterval");
    await Promise.all([
      h.run('runTimerAction(() => resumeTimer("break"))'),
      h.run('runTimerAction(() => resumeTimer("break"))'),
    ]);
    assert.equal(h.intervals.has(oldInterval), false);
    assert.equal(h.intervals.size, 1);
    for (const tick of h.intervals.values()) tick();
    assert.equal(h.nodes.get("breakDuration").textContent, "00:00:00");
    assert.equal(h.nodes.get("timesheetBreakDuration").textContent, "00:00:00");
    assert.equal(h.nodes.get("breakClock").hidden, false);
  }
  assert.equal(h.calls.filter(url => url.endsWith("/resume")).length, 2);
  assert.equal(h.state.timer.pauses.length, 2);
  assert.ok(h.state.timer.pauses.every(pause => pause.resumedAt));
  assert.equal(h.run('buildTimeLogTimeline(currentTimeLog).filter(entry => entry.type === "break").reduce((sum, entry) => sum + entry.seconds, 0)'), 900);
});

test("restore uses only an active break and clears stale intervals for empty and idle sessions", async () => {
  const h = harness({ timer: "paused" });
  h.state.timer.pauses = [{ reason: "break", pausedAt: new Date(Date.now() - 332000).toISOString(), resumedAt: null }];
  await h.run("loadActiveTimer()");
  assert.equal(h.nodes.get("breakDuration").textContent, "00:05:32");
  await h.run('resumeTimer("break")');
  await h.run("loadActiveTimer()");
  assert.equal(h.nodes.get("breakDuration").textContent, "00:00:00");
  assert.equal(h.intervals.size, 1);
  // A non-paused server snapshot must never revive an old open timestamp.
  h.state.timer.pauses[0].resumedAt = null;
  await h.run("loadActiveTimer()");
  assert.equal(h.nodes.get("breakDuration").textContent, "00:00:00");
  h.state.timer.status = "paused";
  h.state.timer.pauses[0].reason = "idle";
  await h.run("loadActiveTimer()");
  assert.equal(h.intervals.size, 0);
  h.state.timer = null;
  await h.run("loadActiveTimer()");
  assert.equal(h.nodes.get("breakDuration").textContent, "00:00:00");
  assert.equal(h.intervals.size, 0);
});

test("failed End Break keeps the active timer; session cleanup removes its interval", async () => {
  const h = harness();
  await h.run('pauseTimer("break")');
  h.state.outage = true;
  await h.run('resumeTimer("break")');
  assert.equal(h.run("isIntentionalBreak()"), true);
  assert.equal(h.intervals.size, 1);
  h.run("clearSessionLoops()");
  assert.equal(h.intervals.size, 0);
});

test("desktop timesheet interleaves work and break segments chronologically", () => {
  const h = harness({ timer: null });
  const timeline = h.run(`buildTimeLogTimeline({
    startedAt: "2026-09-17T13:15:57.000Z",
    pauses: [
      { reason: "break", pausedAt: "2026-09-17T13:16:01.000Z", resumedAt: "2026-09-17T13:18:08.000Z" },
      { reason: "break", pausedAt: "2026-09-17T13:19:11.000Z", resumedAt: "2026-09-17T13:19:53.000Z" }
    ]
  }, new Date("2026-09-17T13:21:00.000Z").getTime()).map(entry => ({
    type: entry.type,
    sequence: entry.sequence,
    seconds: entry.seconds,
    open: entry.open
  }))`);

  assert.deepEqual(JSON.parse(JSON.stringify(timeline)), [
    { type: "work", sequence: 1, seconds: 4, open: false },
    { type: "break", sequence: 1, seconds: 127, open: false },
    { type: "work", sequence: 2, seconds: 63, open: false },
    { type: "break", sequence: 2, seconds: 42, open: false },
    { type: "work", sequence: 3, seconds: 67, open: true },
  ]);
});

test("task filters total stopped sessions once across several work segments and exclude task gaps", () => {
  const h = harness({ timer: null });
  const result = h.run(`(() => {
    const logs = [
      { _id: "one", status: "stopped", task: { _id: "task-a" },
        startedAt: "2026-10-08T10:00:00Z", stoppedAt: "2026-10-08T10:10:00Z", totalWorkedSeconds: 480,
        pauses: [{ reason: "break", pausedAt: "2026-10-08T10:03:00Z", resumedAt: "2026-10-08T10:05:00Z" }] },
      { _id: "two", status: "stopped", task: { _id: "task-a" },
        startedAt: "2026-10-08T10:15:00Z", stoppedAt: "2026-10-08T10:20:00Z", totalWorkedSeconds: 300 },
      { _id: "three", status: "stopped", task: { _id: "task-b" },
        startedAt: "2026-10-08T10:25:00Z", stoppedAt: "2026-10-08T10:30:00Z", totalWorkedSeconds: 300 }
    ];
    const view = getTimesheetView(logs, { type: "work", taskId: "task-a", status: "completed" });
    const allTaskRows = getTimesheetView(logs, { taskId: "task-a" });
    return { seconds: view.workSeconds, completed: view.completedSessions, sessions: view.sessions,
      workRows: view.timeline.length, taskGapCount: allTaskRows.timeline.filter(row => row.entry.source === "between_sessions").length };
  })()`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { seconds: 780, completed: 2, sessions: 2, workRows: 3, taskGapCount: 0 });
});

test("break filters include active break time and count only stopped sessions as completed", () => {
  const h = harness({ timer: null });
  const result = h.run(`(() => {
    const logs = [
      { _id: "lunch", status: "stopped", task: { _id: "break", taskType: "break" },
        startedAt: "2026-10-08T10:00:00Z", stoppedAt: "2026-10-08T10:05:00Z" },
      { _id: "tea", status: "running", task: { _id: "break", taskType: "break" }, startedAt: "2026-10-08T10:06:00Z" },
      { _id: "work", status: "paused", task: { _id: "task" }, startedAt: "2026-10-08T10:07:00Z",
        pauses: [{ reason: "break", pausedAt: "2026-10-08T10:08:00Z", resumedAt: null }] }
    ];
    const now = new Date("2026-10-08T10:10:00Z").getTime();
    const view = getTimesheetView(logs, { type: "break" }, now);
    const completed = getTimesheetView(logs, { type: "break", status: "completed" }, now);
    const active = getTimesheetView(logs, { type: "break", taskId: "break", status: "active" }, now);
    return { work: view.workSeconds, breakSeconds: view.breakSeconds, breaks: view.breakCount,
      completed: view.completedSessions, sessions: view.sessions,
      completedSeconds: completed.breakSeconds, activeSeconds: active.breakSeconds, activeCompleted: active.completedSessions };
  })()`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    work: 0, breakSeconds: 660, breaks: 3, completed: 1, sessions: 3,
    completedSeconds: 300, activeSeconds: 240, activeCompleted: 0,
  });
});

test("filters build idle gaps before selecting rows and return zeros for missing tasks", () => {
  const h = harness({ timer: null });
  const result = h.run(`(() => {
    const logs = [
      { _id: "a", status: "stopped", task: "task-a", startedAt: "2026-10-08T10:00:00Z", stoppedAt: "2026-10-08T10:01:00Z" },
      { _id: "b", status: "stopped", task: "task-b", startedAt: "2026-10-08T10:02:00Z", stoppedAt: "2026-10-08T10:03:00Z" },
      { _id: "c", status: "stopped", task: "task-a", startedAt: "2026-10-08T10:04:00Z", stoppedAt: "2026-10-08T10:05:00Z" }
    ];
    const idle = getTimesheetView(logs, { type: "idle" });
    const missing = getTimesheetView(logs, { taskId: "removed" });
    return { gaps: idle.timeline.map(row => row.entry.seconds), idleSessions: idle.sessions,
      missing: { rows: missing.timeline.length, work: missing.workSeconds, breaks: missing.breakSeconds, completed: missing.completedSessions } };
  })()`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    gaps: [60, 60], idleSessions: 0, missing: { rows: 0, work: 0, breaks: 0, completed: 0 },
  });
});

test("desktop timesheet globally sorts segments from every session by start time", () => {
  const h = harness({ timer: null });
  const rows = h.run(`buildChronologicalTimeline([
    {
      _id: "later-session",
      startedAt: "2026-09-18T14:23:55.000Z",
      stoppedAt: "2026-09-18T14:34:59.000Z",
      pauses: [
        { reason: "break", pausedAt: "2026-09-18T14:24:14.000Z", resumedAt: "2026-09-18T14:30:28.000Z" },
        { reason: "break", pausedAt: "2026-09-18T14:32:20.000Z", resumedAt: "2026-09-18T14:32:22.000Z" }
      ]
    },
    {
      _id: "earlier-session",
      startedAt: "2026-09-18T13:35:55.000Z",
      stoppedAt: "2026-09-18T13:42:49.000Z",
      pauses: [
        { reason: "break", pausedAt: "2026-09-18T13:37:25.000Z", resumedAt: "2026-09-18T13:37:38.000Z" }
      ]
    },
    {
      _id: "overlapping-session",
      startedAt: "2026-09-18T14:23:42.000Z",
      stoppedAt: "2026-09-18T14:23:51.000Z",
      pauses: []
    }
  ]).map(({ timeLog, entry }) => ({ id: timeLog._id, type: entry.type, start: entry.start.toISOString() }))`);

  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { id: "earlier-session", type: "work", start: "2026-09-18T13:35:55.000Z" },
    { id: "earlier-session", type: "break", start: "2026-09-18T13:37:25.000Z" },
    { id: "earlier-session", type: "work", start: "2026-09-18T13:37:38.000Z" },
    { id: "earlier-session", type: "idle", start: "2026-09-18T13:42:49.000Z" },
    { id: "overlapping-session", type: "work", start: "2026-09-18T14:23:42.000Z" },
    { id: "overlapping-session", type: "idle", start: "2026-09-18T14:23:51.000Z" },
    { id: "later-session", type: "work", start: "2026-09-18T14:23:55.000Z" },
    { id: "later-session", type: "break", start: "2026-09-18T14:24:14.000Z" },
    { id: "later-session", type: "work", start: "2026-09-18T14:30:28.000Z" },
    { id: "later-session", type: "break", start: "2026-09-18T14:32:20.000Z" },
    { id: "later-session", type: "work", start: "2026-09-18T14:32:22.000Z" },
  ]);
});

test("a ten-second task change is red idle time, but overnight is not", () => {
  const h = harness({ timer: null });
  const result = h.run(`(() => {
    const rows = buildChronologicalTimeline([
      { startedAt: "2026-09-29T11:29:00.000Z", stoppedAt: "2026-09-29T11:30:00.000Z" },
      { startedAt: "2026-09-29T11:30:10.000Z", stoppedAt: "2026-09-29T11:31:00.000Z" },
      { startedAt: "2026-09-30T02:30:00.000Z", stoppedAt: "2026-09-30T02:31:00.000Z" }
    ]);
    return {
      gaps: rows.filter(({ entry }) => entry.source === "between_sessions")
        .map(({ entry }) => ({ seconds: entry.seconds, type: entry.type })),
      idleSeconds: summarizeTimeline(rows).idleSeconds
    };
  })()`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    gaps: [{ seconds: 10, type: "idle" }], idleSeconds: 10,
  });
});

test("timesheet work rows reconcile to backend totals and active breaks stay out of the completed total", () => {
  const h = harness({ timer: null });
  const result = h.run(`(() => {
    const timeline = buildChronologicalTimeline([
      {
        status: "stopped",
        startedAt: "2026-09-18T10:00:00.900Z",
        stoppedAt: "2026-09-18T10:00:10.900Z",
        totalWorkedSeconds: 9,
        pauses: [
          { reason: "break", pausedAt: "2026-09-18T10:00:02.600Z", resumedAt: "2026-09-18T10:00:04.100Z" }
        ]
      },
      {
        status: "paused",
        startedAt: "2026-09-18T11:00:00.000Z",
        pauses: [
          { reason: "break", pausedAt: "2026-09-18T11:00:03.000Z", resumedAt: null }
        ]
      }
    ], new Date("2026-09-18T11:00:08.000Z").getTime());
    return {
      workRows: timeline.filter(({ entry }) => entry.type === "work").map(({ entry }) => entry.seconds),
      completedBreakRows: timeline.filter(({ entry }) => entry.type === "break" && !entry.open).map(({ entry }) => entry.seconds),
      activeBreakRows: timeline.filter(({ entry }) => entry.type === "break" && entry.open).map(({ entry }) => entry.seconds),
      totals: summarizeTimeline(timeline)
    };
  })()`);

  const normalized = JSON.parse(JSON.stringify(result));
  assert.equal(normalized.workRows.reduce((total, seconds) => total + seconds, 0), normalized.totals.workSeconds);
  assert.equal(normalized.totals.workSeconds, 12);
  assert.deepEqual(normalized.completedBreakRows, [1]);
  assert.deepEqual(normalized.activeBreakRows, [5]);
  assert.equal(normalized.totals.breakSeconds, 1);
});

test("stored work seconds are preserved when pauses leave no reconstructed work segment", () => {
  const h = harness({ timer: null });
  const result = h.run(`(() => {
    const timeline = buildChronologicalTimeline([{
      status: "stopped",
      startedAt: "2026-09-18T10:00:00.000Z",
      stoppedAt: "2026-09-18T10:00:10.000Z",
      totalWorkedSeconds: 2,
      pauses: [{
        reason: "break",
        pausedAt: "2026-09-18T10:00:00.000Z",
        resumedAt: "2026-09-18T10:00:10.000Z"
      }]
    }]);
    return {
      workRows: timeline.filter(({ entry }) => entry.type === "work").map(({ entry }) => ({
        seconds: entry.seconds,
        reconciled: entry.reconciled === true
      })),
      totals: summarizeTimeline(timeline)
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    workRows: [{ seconds: 2, reconciled: true }],
    totals: { workSeconds: 2, breakSeconds: 10, idleSeconds: 0 },
  });
});

test("a restored idle-paused timer never auto-resumes after login", async () => {
  const h = harness({ timer: "paused" });
  h.state.timer.pauses = [{ pausedAt: new Date().toISOString(), reason: "idle" }];
  await h.context.loadActiveTimer(); await h.check();
  assert.equal(h.state.timer._id, "existing");
  assert.equal(h.state.timer.status, "paused");
  assert.equal(h.calls.some(url => url.endsWith("/resume")), false);
});

test("settings outage uses defaults; pause outage blocks logout until retry succeeds", async () => {
  const h = harness({ idle: 3000, outage: true });
  h.run("idlePolicy = null");
  await h.context.loadIdlePolicy();
  assert.equal(h.run("idlePolicy.logoutSeconds"), defaults.autoLogoutMinutes * 60);
  await h.check();
  assert.ok(h.context.localStorage.getItem("token"));
  assert.equal(h.run("logoutPending"), true);
  h.state.outage = false; h.state.idle = 0;
  await h.check();
  assert.equal(h.state.timer.status, "stopped");
  assert.equal(h.context.localStorage.getItem("token"), null);
});

test("screen lock follows the server-confirmed timer state after a restart", async () => {
  const h = harness({ page: "dashboard", timer: null });
  await h.check();
  assert.equal(h.state.lock.at(-1), "inactive", "no lock before the server confirms the timer");
  await h.context.loadActiveTimer();
  assert.equal(h.state.lock.at(-1), "locked", "a restart with no running timer locks the screen");
  assert.equal(h.nodes.get("timerLockNotice").hidden, false);
  await h.check();
  assert.equal(h.state.lock.at(-1), "locked", "every idle poll repeats the lock report");

  h.state.timer = { _id: "on-break", status: "paused", startedAt: new Date().toISOString(),
    pauses: [{ pausedAt: new Date().toISOString(), reason: "break" }] };
  await h.context.loadActiveTimer();
  assert.equal(h.state.lock.at(-1), "running", "an intentional break is not locked");

  h.state.timer = { _id: "started", status: "running", startedAt: new Date().toISOString(), pauses: [] };
  await h.context.loadActiveTimer();
  assert.equal(h.state.lock.at(-1), "running");
  assert.equal(h.nodes.get("timerLockNotice").hidden, true);
});

test("idle detection locks the screen before the stop request returns", async () => {
  const h = harness({ page: "dashboard", idle: 300 });
  h.run("timerStateConfirmed = true");
  const fetch = h.context.fetch;
  let lockWhenStopSent;
  h.context.fetch = (url, options) => {
    if (url.endsWith("/stop")) lockWhenStopSent = h.state.lock.at(-1);
    return fetch(url, options);
  };
  await h.check();
  assert.equal(lockWhenStopSent, "locked");
  assert.equal(h.run("currentTimeLog"), null);
  assert.equal(h.state.lock.at(-1), "locked");
  h.nodes.get("acknowledgeIdleButton").listeners.click({ isTrusted: true });
  await h.check();
  assert.equal(h.state.lock.at(-1), "locked", "Continue does not unlock; only a running timer does");
});

test("screen lock fails open while the server is unreachable and returns with it", async () => {
  const h = harness({ page: "dashboard", timer: null });
  await h.context.loadActiveTimer();
  assert.equal(h.state.lock.at(-1), "locked");
  h.state.outage = true;
  await h.run("refreshCurrentUser()");
  assert.equal(h.state.lock.at(-1), "inactive");
  h.state.outage = false;
  await h.run("refreshCurrentUser()");
  assert.equal(h.state.lock.at(-1), "locked");
});

test("signing out releases the screen lock", async () => {
  const h = harness({ page: "dashboard", timer: null });
  await h.context.loadActiveTimer();
  assert.equal(h.state.lock.at(-1), "locked");
  await h.run("signOut(false)");
  assert.equal(h.context.localStorage.getItem("token"), null);
  assert.equal(h.state.lock.at(-1), "inactive");
});

test("the login page never locks the screen", async () => {
  const h = harness({ timer: null });
  await h.context.loadActiveTimer();
  await h.check();
  assert.ok(h.state.lock.length > 0);
  assert.ok(h.state.lock.every((value) => value === "inactive"));
});
