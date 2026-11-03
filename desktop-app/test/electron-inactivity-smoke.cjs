// Local Electron integration test: real renderer/preload, simulated API and OS idle duration.
const { app, BrowserWindow, ipcMain } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const defaults = require("../idle-policy-defaults.json");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "crm-idle-smoke-")));
process.env.HANDDY_API_URL = "http://127.0.0.1:5000/api";
let idleSeconds = 0;
let timer = null;
const completedLogs = [];
const actions = [];
const user = { _id: "smoke-user", fullName: "Local test employee", role: "employee", isActive: true };
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.end(); return; }
    let data = {};
    if (req.url === "/api/auth/login") data = { token: "local-test-token", user };
    else if (req.url === "/api/auth/me") data = { user };
    else if (req.url === "/api/settings/idle-policy") data = { idlePolicy: { idleThresholdMinutes: 5, autoLogoutMinutes: 50 } };
    else if (req.url === "/api/time-logs/active") data = { timeLog: timer };
    else if (req.url.startsWith("/api/time-logs/history")) data = { timeLogs: [...completedLogs, ...(timer ? [timer] : [])] };
    else if (req.url === "/api/time-logs/start") {
      const request = JSON.parse(body);
      timer = {
        _id: `smoke-timer-${completedLogs.length + 1}`,
        status: "running",
        startedAt: new Date().toISOString(),
        pauses: [],
        project: { _id: "project", projectName: "Project" },
        client: { _id: request.client, clientName: request.client === "client-b" ? "XYZ LLC" : "ABC Company" },
        task: { _id: request.task, taskName: request.task === "break-task" ? "Lunch" : "Task", taskType: request.task === "break-task" ? "break" : "work", idleLogout: true },
      };
      data = { timeLog: timer };
    } else if (req.url === "/api/time-logs/pause") {
      actions.push("pause");
      timer = { ...timer, status: "paused", pauses: [...timer.pauses, { reason: JSON.parse(body).reason, pausedAt: new Date().toISOString() }] };
      data = { timeLog: timer };
    } else if (req.url === "/api/time-logs/resume") {
      actions.push("resume"); timer.status = "running";
      timer.pauses = timer.pauses.map(pause => pause.resumedAt ? pause : { ...pause, resumedAt: new Date().toISOString() });
      data = { timeLog: timer };
    } else if (req.url === "/api/time-logs/stop") {
      actions.push("stop");
      const stopped = { ...timer, status: "stopped", stoppedAt: new Date().toISOString(), totalWorkedSeconds: Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000) };
      completedLogs.push(stopped);
      data = { timeLog: stopped };
      timer = null;
    } else if (req.url === "/api/auth/logout") actions.push("logout");
    else if (req.url === "/api/clients") data = { clients: [
      { _id: "client-a", clientName: "ABC Company", status: "Active" },
      { _id: "client-b", clientName: "XYZ LLC", status: "Active" },
    ] };
    else if (req.url.includes('/activity-options')) { res.statusCode = 404; data = { message: 'API route not found.' }; }
    else if (req.url.startsWith("/api/projects")) data = { projects: [{ _id: "project", projectName: "Project", clientName: "" }], totalPages: 1 };
    else if (req.url.startsWith("/api/tasks")) data = {
      tasks: req.url.includes("taskType=break")
        ? [{ _id: "break-task", taskName: "Lunch", taskType: "break", project: null }]
        : [{ _id: "task", taskName: "Task", taskType: "work", project: "project", idleLogout: true }],
      totalPages: 1,
    };
    else data = { timeLogs: [] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  });
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(100); }
  throw new Error("Timed out waiting for desktop state");
}
app.whenReady().then(async () => {
  let win;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(5000, "127.0.0.1", resolve); });
    ipcMain.handle("system:get-idle-time", () => idleSeconds);
    ipcMain.handle("system:idle-defaults", () => defaults);
    // preload.js reads this synchronously at load time; without a listener the
    // sendSync call resolves to a non-string value and every fetch in the
    // renderer breaks (it gets concatenated as "[object Object]/auth/login").
    ipcMain.on("config:get-api-base-url", (event) => {
      event.returnValue = process.env.HANDDY_API_URL;
    });
    ipcMain.on("config:get-device-info", (event) => {
      event.returnValue = { deviceId: "electron-smoke-device", deviceName: "Electron smoke test", clientType: "desktop" };
    });
    win = new BrowserWindow({ show: false, width: 1495, height: 1000, webPreferences: { preload: path.resolve(__dirname, "../preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    const consoleErrors = [];
    win.webContents.on('console-message', details => {
      // The existing pages put frame-ancestors in a CSP meta tag. Chromium
      // reports this unsupported meta directive independently of timer code.
      const existingCspNotice = "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.";
      if (details.level === 'error' && details.message !== existingCspNotice) consoleErrors.push(details.message);
    });
    await win.loadFile(path.resolve(__dirname, "../index.html"));
    const login = async () => {
      await win.webContents.executeJavaScript('document.getElementById("email").value="test@example.invalid"; document.getElementById("password").value="local-test-only"; document.getElementById("loginForm").requestSubmit();');
      await until(() => win.webContents.getURL().endsWith("dashboard.html"));
      await until(() => win.webContents.executeJavaScript('typeof idlePolicyRefreshInterval !== "undefined" && idlePolicyRefreshInterval !== null'));
    };
    await login();
    const evaluate = source => win.webContents.executeJavaScript(source);
    await evaluate(`document.getElementById("projectSelect").value = "project";
      document.getElementById("projectSelect").dispatchEvent(new Event("change"));`);
    await until(() => evaluate("[...document.getElementById('taskSelect').options].some(option => option.value === 'break-task')"));
    await until(() => evaluate("!document.getElementById('clientSelect').disabled"));
    assert.deepEqual(await evaluate("[...document.getElementById('clientSelect').options].map(option => option.textContent)"), ["Select client", "ABC Company", "XYZ LLC"]);
    await evaluate(`document.getElementById("clientSelect").value = "client-b";
      document.getElementById("clientSelect").dispatchEvent(new Event("change"));`);
    await until(() => evaluate("!document.getElementById('taskSelect').disabled && [...document.getElementById('taskSelect').options].some(option => option.value === 'task')"));
    await evaluate(`document.getElementById("taskSelect").value = "task";
      document.getElementById("taskSelect").dispatchEvent(new Event("change"));
      document.getElementById("startTimerButton").click();`);
    await until(() => evaluate("document.getElementById('timerStatus').textContent === 'Working'"));
    assert.equal(await evaluate("document.getElementById('stopBreakButton').hidden"), true);
    assert.equal(timer.client._id, "client-b", "Timer payload must use the selected database ID");
    assert.equal(await evaluate("document.getElementById('clientSelect').selectedOptions[0].textContent"), "XYZ LLC");
    await delay(1100);
    assert.notEqual(await evaluate("document.getElementById('timerDuration').textContent"), "00:00:00");
    assert.equal(await evaluate("document.getElementById('breakTimerButton')"), null);
    await evaluate("document.getElementById('stopTimerButton').click()");
    await until(() => evaluate("document.getElementById('timerStatus').textContent === 'Stopped'"));
    assert.equal(await evaluate("document.getElementById('timerDuration').textContent"), "00:00:00");
    await evaluate(`document.getElementById("taskSelect").value = "break-task";
      document.getElementById("taskSelect").dispatchEvent(new Event("change"));
      document.getElementById("startTimerButton").click();`);
    await until(() => evaluate("document.getElementById('timerStatus').textContent === 'On Break'"));
    await until(() => evaluate("!document.getElementById('stopBreakButton').hidden && !document.getElementById('stopBreakButton').disabled"));
    idleSeconds = 8 * 3600;
    const breakActionsBefore = actions.length;
    await evaluate('checkSystemIdleState()');
    assert.equal(await evaluate("document.getElementById('timerStatus').textContent"), 'On Break');
    assert.equal(await evaluate("document.getElementById('idleStartedDialog').open"), false);
    assert.equal(await evaluate("!!localStorage.getItem('token')"), true);
    assert.equal(actions.length, breakActionsBefore, 'Eight idle hours must not stop a running break or log out');
    idleSeconds = 0;
    await delay(2100);
    assert.notEqual(await evaluate("document.getElementById('breakDuration').textContent"), "00:00:00");
    assert.equal(await evaluate("document.getElementById('timerDuration').textContent"), "00:00:00");
    fs.mkdirSync(path.resolve(__dirname, "../../dashboard/ui-review"), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, "../../dashboard/ui-review/stop-break.png"), (await win.webContents.capturePage()).toPNG());
    await win.loadFile(path.resolve(__dirname, "../dashboard.html"));
    await until(() => evaluate("document.getElementById('timerStatus').textContent === 'On Break'"));
    assert.equal(await evaluate("document.getElementById('breakTimerButton')"), null);
    await until(() => evaluate("!document.getElementById('stopBreakButton').hidden && !document.getElementById('stopBreakButton').disabled"));
    await evaluate("document.getElementById('stopBreakButton').click()");
    await until(() => evaluate("document.getElementById('timerStatus').textContent === 'Stopped'"));
    assert.equal(await evaluate("document.getElementById('stopBreakButton').hidden"), true);
    assert.equal(await evaluate("document.getElementById('breakDuration').textContent"), "00:00:00");
    await evaluate("loadTodayTimesheet()");
    await until(() => evaluate("document.getElementById('todayBreak').textContent !== '00:00:00'"));
    await until(() => evaluate("idlePolicyRefreshInterval !== null"));
    await evaluate("showTimerView('dashboard')");
    assert.equal(await evaluate("document.querySelector('.timesheet-filters')"), null, 'timesheet filter bar is removed');
    assert.equal(await evaluate("document.querySelector('.timesheet-filter-summary')"), null);
    win.setSize(1495, 1000);
    await evaluate("showTimerView('timer')");
    await evaluate(`document.getElementById("taskSelect").value = "task";
      document.getElementById("taskSelect").dispatchEvent(new Event("change"));
      document.getElementById("startTimerButton").click();`);
    await until(() => evaluate("document.getElementById('timerStatus').textContent === 'Working'"));
    const cardDoesNotOverlap = () => evaluate(`(() => {
      const items = [...document.querySelector('.timesheet-break-summary').children]
        .map(element => element.getBoundingClientRect());
      return items.every((rect, index) => index === 0 || rect.top >= items[index - 1].bottom);
    })()`);
    assert.equal(await cardDoesNotOverlap(), true);
    win.setSize(500, 800);
    await delay(200);
    assert.equal(await cardDoesNotOverlap(), true);
    win.setSize(1495, 1000);
    assert.deepEqual(actions, ["stop", "stop"]);
    actions.length = 0;
    idleSeconds = 300;
    await win.webContents.executeJavaScript("checkSystemIdleState()");
    assert.equal(timer, null);
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("timerDuration").textContent'), "00:00:00");
    assert.equal(await evaluate("document.getElementById('idleStartedDialog').open"), true);
    assert.match(await evaluate("document.getElementById('idleStartedMessage').textContent"), /inactive for 05 mins/);
    assert.equal(await evaluate("document.getElementById('idleLogoutCountdown').textContent"), '45 Mins 00 Secs');
    assert.equal(await evaluate("document.getElementById('acknowledgeIdleButton').textContent"), 'Continue');
    await delay(1100);
    assert.notEqual(await evaluate("document.getElementById('idleLogoutCountdown').textContent"), '45 Mins 00 Secs');
    assert.equal(await evaluate("document.getElementById('projectSelect').value"), 'project');
    assert.equal(await evaluate("document.getElementById('taskSelect').value"), 'task');
    idleSeconds = 0;
    await evaluate("checkSystemIdleState()");
    assert.equal(await evaluate("document.getElementById('idleStartedDialog').open"), true);
    await evaluate("document.getElementById('acknowledgeIdleButton').click()");
    assert.equal(await evaluate("document.getElementById('idleStartedDialog').open"), true, 'synthetic click cannot confirm activity');
    await evaluate("document.getElementById('acknowledgeIdleButton').focus()");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await delay(100);
    assert.equal(await evaluate("document.getElementById('idleStartedDialog').open"), true);
    fs.writeFileSync(path.resolve(__dirname, "../../dashboard/ui-review/idle-popup.png"), (await win.webContents.capturePage()).toPNG());
    const continuePoint = await evaluate(`(() => {
      const rect = document.getElementById('acknowledgeIdleButton').getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...continuePoint });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...continuePoint });
    await until(() => evaluate("!document.getElementById('idleStartedDialog').open"));
    await evaluate("checkSystemIdleState()");
    assert.equal(await evaluate("document.getElementById('idleStartedDialog').open"), false);
    idleSeconds = 0;
    await win.webContents.executeJavaScript("checkSystemIdleState()");
    assert.equal(timer, null);
    idleSeconds = 3000;
    await evaluate("idleAcknowledgedAt = Date.now() - 3000_000");
    await win.webContents.executeJavaScript("checkSystemIdleState()");
    await until(() => win.webContents.getURL().endsWith("index.html"));
    await until(() => win.webContents.executeJavaScript('document.getElementById("message")?.textContent === "You were logged out after 50 minutes of inactivity."'));
    assert.deepEqual(actions, ["stop", "logout"]);
    idleSeconds = 0;
    await login();
    await win.webContents.executeJavaScript("checkSystemIdleState()");
    assert.equal(timer, null);
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("timerDuration").textContent'), "00:00:00");

    // With no active timer, activeTaskIdleLogout is false (the real default
    // set by loadActiveTimer when data.timeLog is null). The session-level
    // auto-logout must still fire after the idle threshold - this is the
    // no-timer / no-task-opt-in scenario the desktop app previously never
    // exercised, and previously never enforced.
    assert.equal(await win.webContents.executeJavaScript("activeTaskIdleLogout"), false);
    idleSeconds = 3000;
    await win.webContents.executeJavaScript("checkSystemIdleState()");
    await until(() => win.webContents.getURL().endsWith("index.html"));
    assert.deepEqual(actions, ["stop", "logout", "logout"]);
    assert.deepEqual(consoleErrors, [], 'no renderer console errors');
    console.log("PASS: five-minute popup, live countdown, mandatory Continue, preserved selection, fifty-minute logout, breaks, and no timer runtime errors.");
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (win) win.destroy();
    server.close();
    app.exit(process.exitCode || 0);
  }
});
