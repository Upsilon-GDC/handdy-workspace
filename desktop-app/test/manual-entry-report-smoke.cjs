// Real dashboard DOM with a local fixture API; never connects to Atlas/Render.
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const dashboardRoot = path.resolve(__dirname, "../../dashboard/dist");
const outputRoot = path.resolve(__dirname, '../../backend/.local-repairs/manual-entry-review');
const people = [
  { _id: "64b000000000000000000a01", fullName: "A Employee", role: "employee" },
  { _id: "64b000000000000000000a02", fullName: "B Lead", role: "team_lead" },
  { _id: "64b000000000000000000a03", fullName: "C Manager", role: "manager" },
  { _id: "64b000000000000000000a04", fullName: "D Other Manager", role: "manager" },
  { _id: "64b000000000000000000a05", fullName: "E Admin", role: "admin" },
  { _id: "64b000000000000000000a06", fullName: "F HR", role: "hr" },
].map((person, index) => ({ ...person, employeeId: `1000${index}`, isActive: true, team: "team", teamLead: "64b000000000000000000a02" }));
let actor = people[2];
let grants = ["add_manual_entries", "view_team_timesheets"];
const projects = [
  { _id: "p1", projectName: "Audit", projectCode: "PRJ-AUDIT", clientIds: ["c1"], mappingEnabled: true },
  { _id: "p2", projectName: "Tax preparation", projectCode: "PRJ-TAX", clientIds: ["c2"], mappingEnabled: true },
  { _id: "p3", projectName: "Unassigned project", clientIds: [] },
];
const tasks = [
  { _id: "t1", taskName: "Preparation", taskCode: "TSK-PREP", project: "p1", taskType: "work", clientIds: ['c1'] },
  { _id: "t2", taskName: "Review", taskCode: "TSK-REVIEW", project: "p2", taskType: "work", clientIds: ['c2'] },
];
const clients = [{ _id: "c1", clientName: "WCPA" }, { _id: "c2", clientName: "Second client" }];
const makeLog = (id, employee, projectIndex = 0) => ({ _id: id, employee,
  project: projects[projectIndex], task: tasks[projectIndex], client: clients[projectIndex],
  startedAt: "2026-10-08T04:00:00Z", stoppedAt: "2026-10-08T05:00:00Z",
  status: "stopped", isActiveTimer: false, totalWorkedSeconds: 3600, totalIdleSeconds: 0, pauses: [], entrySource: "timer" });
let logs = [...people.map((person, index) => makeLog(`timer-${index}`, person)), makeLog("timer-second", people[0], 1)];
let createdPayload;
let deleteCalls = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/api/")) {
    const file = url.pathname.startsWith("/assets/") ? path.join(dashboardRoot, "assets", path.basename(url.pathname)) : path.join(dashboardRoot, "index.html");
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
    return;
  }
  let input = "";
  req.on("data", (chunk) => { input += chunk; });
  req.on("end", () => {
    const endpoint = url.pathname.slice(4);
    let body = { success: true };
    if (endpoint === "/auth/me") body = { user: actor };
    if (endpoint === "/auth/login-requests/pending") body = { loginRequest: null };
    if (endpoint === "/permissions/me") body = { permissions: grants };
    if (endpoint === "/teams") body = { teams: [{ _id: "team", teamName: "WCPA", isActive: true, teamLead: people[1]._id }] };
    if (endpoint.startsWith("/employees")) body = { employees: people, totalPages: 1 };
    if (endpoint === "/projects") body = { projects, totalPages: 1 };
    if (endpoint === "/tasks") body = { tasks, totalPages: 1 };
    if (["/time-logs/admin", "/time-logs/team", "/time-logs/history"].includes(endpoint)) {
      const visible = logs.filter((log) => endpoint === "/time-logs/history" ? log.employee._id === actor._id
        : endpoint === "/time-logs/team" ? log.employee.role === "employee" : true);
      body = { timeLogs: visible, totalPages: 1 };
    }
    if (endpoint === "/time-logs/manual/options") body = {
      employee: people.find((person) => person._id === url.searchParams.get("employee")), projects, tasks, clients,
    };
    if (endpoint === "/time-logs/manual" && req.method === "POST") {
      createdPayload = JSON.parse(input);
      const log = { ...makeLog("64b000000000000000000b01", people.find((person) => person._id === createdPayload.employee)),
        startedAt: createdPayload.startedAt, stoppedAt: createdPayload.stoppedAt, totalWorkedSeconds: 1800,
        entrySource: "manual", manualEntry: { reason: createdPayload.reason, createdBy: actor._id } };
      logs.push(log);
      body = { success: true, timeLog: log };
    }
    if (endpoint.startsWith("/time-logs/manual/") && req.method === "DELETE") {
      deleteCalls += 1;
      logs = logs.filter((log) => log._id !== endpoint.split("/").at(-1));
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  });
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const evaluate = (code) => win.webContents.executeJavaScript(code);
async function until(code) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(code)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${code}`);
}
const clickText = (text) => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
app.whenReady().then(async () => {
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    fs.mkdirSync(outputRoot, { recursive: true });
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { partition: `manual-test-${Date.now()}`, backgroundThrottling: false, offscreen: true } });
    const runtimeErrors = [];
    win.webContents.on("console-message", (event) => { if (event.level === "error") runtimeErrors.push(event.message); });
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token', 'fixture-token'); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(actor))});`);
    await win.loadURL(`${base}/admin/timesheets/team`);
    await until(`document.querySelector('.admin-report-controls button') && document.body.textContent.includes('Add my entry')`);
    await clickText("Generate");
    await until(`document.querySelectorAll('.admin-report-table-wrap tbody tr').length >= 6`);
    assert.equal(await evaluate("document.querySelectorAll('.report-add-entry-button').length"), 7, 'six employee actions plus Add my entry');
    assert.equal(await evaluate("[...document.querySelectorAll('.admin-report-table-wrap tbody tr')].filter(row => row.textContent.includes('D Other Manager') || row.textContent.includes('E Admin') || row.textContent.includes('F HR')).every(row => row.querySelector('.report-add-entry-button'))"), true, 'company-wide managers can add entries for every role');
    await clickText("Client");
    await until(`document.querySelectorAll('.client-timesheet-employee').length === 6`);
    assert.equal(await evaluate("[...document.querySelectorAll('.client-timesheet button')].some(button => button.textContent.includes('Add Entry'))"), false);
    await evaluate("document.querySelector('.client-timesheet-expand-all').click()");
    await until("[...document.querySelector('.client-timesheet-employee').querySelectorAll('details')].every(node => node.open)");
    assert.equal(await evaluate("document.querySelector('.client-timesheet-employee').open"), true);
    assert.equal(await evaluate("[...document.querySelectorAll('.client-timesheet-employee')].slice(1).every(node => !node.open)"), true, "only the chosen employee expands");
    await evaluate("document.querySelector('.client-timesheet').scrollIntoView({block:'start'})");
    win.webContents.invalidate();
    await delay(1000);
    fs.writeFileSync(path.join(outputRoot, "expand-all.png"), (await win.webContents.capturePage()).toPNG());
    await evaluate("document.querySelector('.client-timesheet-expand-all').click()");
    await until("!document.querySelector('.client-timesheet-employee').open");
    await clickText("Employee");
    await evaluate("document.querySelector('.admin-report-table-wrap tbody .report-add-entry-button').click()");
    await until("document.querySelectorAll('[role=combobox]').length === 3");
    await evaluate("document.querySelectorAll('[role=combobox]')[0].dispatchEvent(new FocusEvent('focusin', {bubbles:true}))");
    await until("document.querySelectorAll('.searchable-select')[0].querySelectorAll('[role=option]').length === 2");
    assert.equal(await evaluate("document.querySelectorAll('.searchable-select')[0].textContent.includes('Unassigned project')"), false);
    await evaluate("document.querySelectorAll('.searchable-select')[0].querySelector('[role=option]').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))");
    await evaluate("document.querySelectorAll('[role=combobox]')[2].dispatchEvent(new FocusEvent('focusin', {bubbles:true}))");
    await until("document.querySelectorAll('.searchable-select')[2].querySelectorAll('[role=option]').length === 1");
    assert.equal(await evaluate("document.querySelectorAll('.searchable-select')[2].textContent.includes('Review')"), false, "other project's task is excluded");
    await evaluate("document.querySelectorAll('.searchable-select')[2].querySelector('[role=option]').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))");
    await evaluate("document.querySelectorAll('[role=combobox]')[0].dispatchEvent(new FocusEvent('focusin', {bubbles:true}))");
    await until("document.querySelectorAll('.searchable-select')[0].querySelectorAll('[role=option]').length === 2");
    await evaluate("document.querySelectorAll('.searchable-select')[0].querySelectorAll('[role=option]')[1].dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))");
    await until("document.querySelectorAll('[role=combobox]')[2].value === ''");
    await evaluate("document.querySelectorAll('[role=combobox]')[2].dispatchEvent(new FocusEvent('focusin', {bubbles:true}))");
    await until("document.querySelectorAll('.searchable-select')[2].querySelector('[role=option]')?.textContent.includes('Review')");
    await evaluate("document.querySelectorAll('[role=combobox]')[0].dispatchEvent(new FocusEvent('focusin', {bubbles:true}))");
    await evaluate("document.querySelectorAll('.searchable-select')[0].querySelector('[role=option]').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))");
    await evaluate("document.querySelectorAll('[role=combobox]')[2].dispatchEvent(new FocusEvent('focusin', {bubbles:true}))");
    await until("document.querySelectorAll('.searchable-select')[2].querySelector('[role=option]')?.textContent.includes('Preparation')");
    await evaluate("document.querySelectorAll('.searchable-select')[2].querySelector('[role=option]').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))");
    await evaluate(`
      for (const [selector, value] of [['#entry-date','2026-10-08'],['#entry-start','14:00'],['#entry-end','14:30'],['#entry-reason','Forgot to start timer']]) {
        const input = document.querySelector(selector);
        const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
      }
    `);
    await clickText("Review entry");
    await until("document.body.textContent.includes('Confirm and save')");
    await clickText("Confirm and save");
    await until("!document.querySelector('[role=dialog]') && document.body.textContent.includes('Manual entries (1)')");
    assert.equal(createdPayload.employee, people[0]._id);
    assert.equal(createdPayload.project, "p1");
    assert.equal(createdPayload.task, "t1");
    await clickText("Manual entries (1)");
    await until("document.querySelector('.manual-entry-item')");
    win.webContents.invalidate();
    await delay(1000);
    fs.writeFileSync(path.join(outputRoot, "manual-delete.png"), (await win.webContents.capturePage()).toPNG());
    await clickText("Delete entry");
    assert.equal(deleteCalls, 0, "delete needs explicit confirmation");
    await clickText("Confirm delete");
    await until("document.body.textContent.includes('No manual entries in this report.')");
    assert.equal(deleteCalls, 1);
    assert.ok(logs.every((log) => log.entrySource === "timer"), "original fixture timers remain");
    await evaluate("document.querySelector('[role=dialog] [aria-label=Close]').click()");
    await clickText("Add my entry");
    await until(`document.querySelector('[role=dialog] input[readonly]')?.value.includes('C Manager')`);
    await evaluate("document.querySelector('[role=dialog] [aria-label=Close]').click()");
    await win.loadURL(`${base}/admin/my-timesheet`);
    await until("document.body.textContent.includes('Add my entry')");
    actor = people[1];
    await evaluate(`localStorage.setItem('user', ${JSON.stringify(JSON.stringify(actor))});`);
    await win.loadURL(`${base}/team-lead/timesheets/team`);
    await until("document.querySelector('.admin-report-controls button')");
    await clickText("Generate");
    await until("document.querySelector('.report-entry-employee-actions .report-add-entry-button')");
    assert.equal(await evaluate("document.querySelectorAll('.report-entry-employee-actions').length"), 1);
    await clickText("Client");
    await until("document.querySelector('.client-timesheet-expand-all')");
    assert.equal(await evaluate("document.querySelector('.client-timesheet-add-entry')"), null);
    grants = ["view_team_timesheets"];
    await evaluate("localStorage.removeItem('crm-report:' + JSON.parse(localStorage.getItem('user'))._id + ':/team-lead/timesheets/team')");
    await win.loadURL(`${base}/team-lead/timesheets/team`);
    await until("document.querySelector('.admin-report-controls button')");
    await clickText("Generate");
    await until("document.querySelector('.report-timeline-row')");
    assert.equal(await evaluate("document.querySelector('.report-add-entry-button')"), null, "revoked manual-entry grant hides actions");
    assert.deepEqual(runtimeErrors, []);
    console.log("PASS: manager company/self entry, linked picker choices, confirmed manual deletion, TL grant controls, removed Client Add Entry, and independent employee Expand/Collapse all.");
    win.destroy();
    server.close();
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (win && !win.isDestroyed()) {
      console.error(await evaluate("[...document.querySelectorAll('.searchable-select')].map(node => ({text:node.textContent, expanded:node.querySelector('input')?.getAttribute('aria-expanded'), focused:node.contains(document.activeElement)}))"));
      fs.writeFileSync(path.join(outputRoot, "failure.png"), (await win.webContents.capturePage()).toPNG());
    }
    if (win && !win.isDestroyed()) win.destroy();
    server.close();
    app.exit(1);
  }
});
