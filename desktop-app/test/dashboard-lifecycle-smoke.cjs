// Build dashboard with VITE_API_URL=/api before running with Electron.
// Real React/router/DOM; isolated mock API, no production credentials or writes.
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../../dashboard/dist");
const uiReviewRoot = process.env.CRM_UI_REVIEW_DIR
  ? path.resolve(process.env.CRM_UI_REVIEW_DIR)
  : path.resolve(__dirname, "../../dashboard/ui-review");
const user = { _id: "test-admin", role: "admin", fullName: "Test Admin", permissions: [] };
const calls = new Map();
const lastQueries = new Map();
const lastBodies = new Map();
let revoked = false;
let pending = false;
let clientReportEnabled = false;
let auditRegressionMode = false;
let desktopTimerRunning = true;
// Role grants returned by /permissions/me (the API's defaults unless a step
// overrides them); admin-level roles hold every permission regardless.
const roleGrants = {
  hr: ["view_tasks", "create_tasks", "edit_tasks", "assign_tasks", "reassign_tasks", "archive_tasks", "add_manual_entries",
    "view_teams", "create_teams", "edit_teams", "view_clients", "manage_clients", "view_projects", "manage_projects",
    "view_personal_reports", "view_all_reports", "export_reports", "view_billing_amounts"],
  team_lead: [],
  employee: ["view_tasks", "view_clients", "view_projects", "view_personal_reports", "export_reports"],
};
const teamsCallTimes = [];
const employees = Array.from({ length: 125 }, (_, index) => ({
  _id: `employee-${index + 1}`, employeeId: `EMP${index + 1}`, fullName: `Employee ${index + 1}`,
  email: `employee${index + 1}@example.test`, role: "employee", isActive: true,
  team: { _id: "team", teamName: "Stable team" }, projectRates: [],
}));
const shifts = employees.map((_, index) => ({ _id: `shift-${index + 1}`, title: `Shift ${index + 1}`, startTime: "09:00", endTime: "17:00" }));
const schedules = employees.map((employee, index) => ({
  _id: `schedule-${index + 1}`, scheduleTitle: `Schedule ${index + 1}`, date: "2026-10-01",
  team: employee.team, employee, shift: shifts[index],
}));
const paginate = (records, key, params) => {
  const page = Number(params.get("page") || 1);
  const limit = Number(params.get("limit") || 10);
  return { [key]: records.slice((page - 1) * limit, page * limit), totalPages: Math.ceil(records.length / limit), totalEmployees: records.length };
};
const clientReportLogs = [
  ["log-1", "ABC Corporation", "client-a", "Tax Return", "tax", "Preparation", "prepare", 60],
  ["log-2", "ABC Corporation", "client-a", "Tax Return", "tax", "Review", "review", 120],
  ["log-3", "ABC Corporation", "client-a", "Bookkeeping", "books", "Monthly", "monthly", 180],
  ["log-4", "XYZ Corporation", "client-b", "Banking", "bank", "Reconciliation", "reconcile", 240],
].map(([id, clientName, clientId, projectName, projectId, taskName, taskId, seconds]) => ({
  _id: id, employee: { _id: "employee-john", fullName: "John" },
  client: { _id: clientId, clientName }, project: { _id: projectId, projectName },
  task: { _id: taskId, taskName, taskType: "work" }, status: "stopped",
  startedAt: "2026-10-01T10:00:00Z", stoppedAt: "2026-10-01T10:01:00Z",
  totalWorkedSeconds: seconds, totalIdleSeconds: 0, pauses: [],
}));
const server = http.createServer((req, res) => {
  // Match production: export libraries must work without unsafe-eval or inline scripts.
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const endpoint = url.pathname.slice(4);
    calls.set(endpoint, (calls.get(endpoint) || 0) + 1);
    if (endpoint === "/teams") teamsCallTimes.push(Date.now());
    lastQueries.set(endpoint, url.searchParams);
    let requestBody = "";
    req.on("data", chunk => { requestBody += chunk; });
    req.on("end", () => { if (requestBody) lastBodies.set(endpoint, JSON.parse(requestBody)); });
    setTimeout(() => {
      res.setHeader("Content-Type", "application/json");
      if (revoked) {
        res.writeHead(401);
        res.end(JSON.stringify({ code: "SESSION_REVOKED", message: "Session revoked for test" }));
        return;
      }
      let body = {};
      if (endpoint === "/auth/me") body = { user };
      if (endpoint === "/permissions/me") body = { permissions: [...(roleGrants[user.role] || []), ...user.permissions] };
      if (endpoint === "/auth/login-requests/pending") body = { loginRequest: pending ? { requestId: "test-request", deviceName: "Test device" } : null };
      if (endpoint.endsWith("/decision")) pending = false;
      if (endpoint === "/teams") body = { teams: [{ _id: "team", teamName: "Stable team", isActive: true }] };
      if (endpoint === "/employees") body = { employees: [], totalPages: 1, totalEmployees: 0 };
      if (endpoint === "/tasks") body = { tasks: [] };
      if (endpoint === "/time-logs/stop") desktopTimerRunning = false;
      if (auditRegressionMode) {
        if (endpoint === "/employees/options" || endpoint === "/employees/my-team") body = paginate(employees, "employees", url.searchParams);
        if (endpoint === "/employees" && user.role === "hr") {
          res.writeHead(403);
          res.end(JSON.stringify({ message: "Account administration is restricted." }));
          return;
        }
        if (endpoint === "/employees") body = paginate(employees, "employees", url.searchParams);
        if (endpoint === "/shifts") body = paginate(shifts, "shifts", url.searchParams);
        if (endpoint === "/schedules") body = paginate(schedules, "schedules", url.searchParams);
        if (endpoint.startsWith("/employees/") && req.method === "PUT") {
          assert.equal(Object.hasOwn(lastBodies.get(endpoint), "email"), false, "delegated update must omit email");
          body = { success: true };
        }
      }
      if (endpoint === "/time-logs/admin" && clientReportEnabled) body = { timeLogs: clientReportLogs, totalPages: 1 };
      res.end(JSON.stringify(body));
    }, endpoint.startsWith("/time-logs/") ? 6500 : 150);
    return;
  }
  const file = url.pathname.startsWith("/assets/") ? path.join(root, path.basename("assets"), path.basename(url.pathname)) : path.join(root, "index.html");
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
  res.end(fs.readFileSync(file));
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const evaluate = source => win.webContents.executeJavaScript(source);
async function until(source) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(source)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${source}`);
}
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, webPreferences: { partition: `test-${Date.now()}`, backgroundThrottling: false } });
    let documents = 0;
    win.webContents.on("did-finish-load", () => documents++);
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token', 'test-token'); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});`);
    await win.loadURL(`${base}/admin/team`);
    await until(`document.body.textContent.includes('Stable team')`);
    const initialDocuments = documents;
    const initialMe = calls.get("/auth/me");
    const pollStart = Date.now();
    await evaluate(`
      window.testMain = document.querySelector('#workspace-content');
      window.testSidebar = document.querySelector('.crm-nav');
      window.testRow = document.querySelector('.team-table tbody tr');
      window.loadingFlashes = 0;
      window.observer = new MutationObserver(() => {
        if (document.querySelector('.team-table tbody')?.textContent.includes('Loading teams')) window.loadingFlashes++;
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    `);
    // Management pages refresh on focus/online at once, then every 30 seconds
    // (hooks/useDataRefresh.js). Assert the cadence from call times rather
    // than a raw count: the online refresh is skipped while the focus one is
    // still in flight, and the interval started when the page mounted.
    await delay(31_000);
    const polls = teamsCallTimes.filter((time) => time >= pollStart).map((time) => time - pollStart);
    assert.ok(polls.some((offset) => offset < 2_000), "focus/online refresh immediately");
    const intervalPolls = polls.filter((offset) => offset >= 2_000);
    assert.equal(intervalPolls.length, 1, `one background poll in 31 s (30-second interval), got ${JSON.stringify(polls)}`);
    assert.ok(intervalPolls[0] >= 20_000, `the background poll waits about 30 s, not 10 s (${intervalPolls[0]} ms)`);
    assert.equal(await evaluate("loadingFlashes"), 0, "background refresh never removes rows");
    assert.equal(await evaluate("testRow === document.querySelector('.team-table tbody tr')"), true);
    for (const route of ["/admin/employees", "/admin/tasks", "/admin/team"]) {
      await evaluate(`document.querySelector('a[href="${route}"]').click()`);
      await until(`location.pathname === '${route}'`);
      await delay(400);
      assert.equal(await evaluate("testMain === document.querySelector('#workspace-content') && testSidebar === document.querySelector('.crm-nav')"), true);
    }
    await until(`!!document.querySelector('a[href="/admin/tasks"]')`);
    await evaluate(`document.querySelector('a[href="/admin/tasks"]').click()`);
    await until(`location.pathname === '/admin/tasks'`);
    await until(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('Add New Task'))`);
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Add New Task')).click()`);
    await until(`location.pathname === '/admin/tasks/new'`);
    await until(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('Add another task name'))`);
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Add another task name')).click()`);
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Add another task name')).click()`);
    assert.equal(await evaluate("document.querySelectorAll('.admin-task-name-list input').length"), 3);
    assert.equal(await evaluate("document.querySelector('.admin-add-task-save').textContent.trim()"), "Save 3 task names");
    assert.equal(await evaluate(`(() => {
      const row = document.querySelector('.admin-task-name-row');
      if (!row) return false;
      const input = row.querySelector('input').getBoundingClientRect();
      const remove = row.querySelector('button').getBoundingClientRect();
      return input.right <= remove.left;
    })()`), true);
    await evaluate(`document.querySelector('.admin-task-name-remove').click()`);
    assert.equal(await evaluate("document.querySelectorAll('.admin-task-name-list input').length"), 2);
    await until(`!!document.querySelector('a[href="/admin/team"]')`);
    await evaluate(`document.querySelector('a[href="/admin/team"]').click()`);
    await until(`location.pathname === '/admin/team'`);
    assert.equal(documents, initialDocuments, "navigation/polling never reloads the document");
    assert.equal(calls.get("/auth/me"), initialMe, "navigation does not restart auth initialization");
    win.webContents.reload();
    await until("document.body.textContent.includes('Stable team')");
    await delay(500);
    assert.equal(await evaluate("location.pathname"), "/admin/team");
    assert.equal(calls.get("/auth/me"), initialMe + 1);
    // A manual report slower than the five-second poll must still finish.
    await evaluate(`document.querySelector('a[href="/admin/timesheets/detailed"]').click()`);
    await until(`location.pathname === '/admin/timesheets/detailed'`);
    await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Generate'))`);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Generate')).click()`);
    await until(`[...document.querySelectorAll('button')].some(b => b.disabled && b.textContent.includes('Loading'))`);
    await until(`[...document.querySelectorAll('button')].some(b => !b.disabled && b.textContent.includes('Generate'))`);
    assert.equal(calls.get('/time-logs/admin'), 1, "polling does not supersede the slow manual report");
    clientReportEnabled = true;
    await evaluate(`document.querySelector('a[href="/admin/timesheets/team"]').click()`);
    await until(`location.pathname === '/admin/timesheets/team'`);
    // The team timesheet filters by team, project and task (no employee filter).
    await until(`!!document.querySelector('select[aria-label="Team"] option[value="team"]')`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="Employee"]')`), null);
    assert.ok(await evaluate(`!!document.querySelector('select[aria-label="Project"]') && !!document.querySelector('select[aria-label="Task"]')`));
    await evaluate(`(() => {
      const select = document.querySelector('select[aria-label="Team"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'team');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Generate')).click()`);
    await until(`document.querySelector('.admin-report-results').textContent.includes('John')`);
    assert.equal(lastQueries.get('/time-logs/admin').get('team'), 'team', 'the selected team is sent to the report API');
    assert.equal(lastQueries.get('/time-logs/admin').has('employee'), false);
    await evaluate(`document.querySelector('[aria-label="Team timesheet view"] button:last-child').click()`);
    await until(`document.querySelectorAll('.client-timesheet-client').length === 2`);
    assert.equal(await evaluate("document.querySelectorAll('.client-timesheet-employee').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('.client-timesheet-project').length"), 3);
    assert.equal(await evaluate("document.querySelectorAll('.client-timesheet tbody tr').length"), 4);
    assert.equal(await evaluate("document.querySelector('.client-timesheet-employee').open"), false);
    await evaluate("document.querySelector('.client-timesheet-employee > summary').click()");
    assert.ok((await evaluate("document.querySelector('.client-timesheet-employee > summary').textContent")).includes('Worked 10m'));
    // The client view shows worked and idle time only, never break time.
    assert.equal(await evaluate("/Break/.test(document.querySelector('.client-timesheet').textContent)"), false);
    assert.equal(await evaluate("document.querySelector('.admin-report-break-total')"), null);
    const exports = [];
    win.webContents.session.on('will-download', (_event, item) => {
      const output = path.join(uiReviewRoot, `client-timesheet-export${path.extname(item.getFilename())}`);
      item.setSavePath(output);
      item.once('done', (_downloadEvent, state) => exports.push({ output, state }));
    });
    for (const format of ['Excel', 'PDF']) {
      await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Export ${format}')).click()`);
      for (let attempt = 0; attempt < 150 && exports.length < (format === 'Excel' ? 1 : 2); attempt++) {
        const error = await evaluate("document.querySelector('.admin-report-message[role=alert]')?.textContent");
        assert.ok(!error, error);
        await delay(100);
      }
      assert.equal(exports.length, format === 'Excel' ? 1 : 2, `${format} download completed`);
      assert.equal(exports.at(-1).state, 'completed');
      assert.ok(fs.statSync(exports.at(-1).output).size > 1000);
    }
    const ExcelJS = require('../../dashboard/node_modules/exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(exports[0].output);
    const sheet = workbook.worksheets[0];
    assert.deepEqual(sheet.getRow(6).values.slice(1), ['Employee', 'Client', 'Project', 'Task', 'Sessions', 'Worked', 'Idle']);
    assert.equal(sheet.rowCount, 10, 'four task rows, without duplicated parent totals');
    assert.deepEqual(sheet.autoFilter, 'A6:G10', 'Excel filtering includes the final task');
    assert.deepEqual(sheet.getRow(7).values.slice(1), ['John', 'ABC Corporation', 'Bookkeeping', 'Monthly', 1, '3m', '0s']);
    assert.match(fs.readFileSync(exports[1].output, 'latin1'), /ABC Corporation/);
    assert.match(fs.readFileSync(exports[1].output, 'latin1'), /Reconciliation/);
    assert.equal(await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.client-timesheet-view-buttons button')];
      return getComputedStyle(buttons[0]).backgroundColor !== getComputedStyle(buttons[1]).backgroundColor;
    })()`), true);
    await evaluate("document.querySelectorAll('.client-timesheet details').forEach(node => node.open = true)");
    assert.equal(await evaluate("[...document.querySelectorAll('.client-timesheet summary')].every(row => row.getBoundingClientRect().height <= 44)"), true);
    await evaluate("document.querySelector('.client-timesheet-client > summary').click()");
    assert.equal(await evaluate("document.querySelector('.client-timesheet-client').open"), false);
    await evaluate("document.querySelector('.client-timesheet-client > summary').click()");
    assert.equal(await evaluate("document.querySelector('.client-timesheet-client').open"), true);
    await evaluate(`document.querySelector('[aria-label="Team timesheet view"] button:first-child').click()`);
    assert.equal(await evaluate("document.querySelector('.client-timesheet')"), null);
    assert.ok((await evaluate("document.querySelector('.admin-report-results').textContent")).includes('John'));
    await evaluate(`document.querySelector('[aria-label="Team timesheet view"] button:last-child').click()`);
    await until("document.querySelector('[aria-label=\"Team timesheet view\"] button:last-child').getAttribute('aria-pressed') === 'true' && !!document.querySelector('.client-timesheet')");
    const screenshotPath = path.join(uiReviewRoot, "client-timesheet.png");
    await evaluate("document.querySelectorAll('.client-timesheet details').forEach(node => node.open = true)");
    win.setSize(1200, 1100);
    await delay(250);
    await evaluate("document.querySelector('.client-timesheet').scrollIntoView({block: 'start'})");
    win.webContents.invalidate();
    await delay(1000);
    fs.writeFileSync(screenshotPath, (await win.webContents.capturePage()).toPNG());
    win.setSize(520, 900);
    await delay(250);
    await evaluate("document.querySelector('.client-timesheet').scrollIntoView({block: 'start'})");
    win.webContents.invalidate();
    await delay(1000);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    fs.writeFileSync(path.join(uiReviewRoot, "client-timesheet-mobile.png"), (await win.webContents.capturePage()).toPNG());
    win.setSize(1200, 900);
    await evaluate(`document.querySelector('a[href="/admin/team"]').click()`);
    await until("document.body.textContent.includes('Stable team')");
    pending = true;
    await until("document.body.textContent.includes('Another device is trying to sign in')");
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Keep This Device').click()");
    await until("!document.querySelector('.crm-device-modal')");
    assert.equal(await evaluate("location.pathname"), "/admin/team");
    revoked = true;
    await until("location.pathname === '/login'");
    assert.equal(await evaluate("localStorage.getItem('token')"), null);
    // Exercise the permission and pagination fixes through the built React app.
    revoked = false;
    auditRegressionMode = true;
    user.role = "hr";
    const restoreUser = async route => {
      await evaluate(`localStorage.setItem('token', 'test-token'); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});`);
      await win.loadURL(`${base}${route}`);
    };
    const employeeReadsBefore = calls.get("/employees");
    await restoreUser("/admin/timesheets/detailed");
    await until(`!!document.querySelector('select[aria-label="Employee"] option[value="employee-125"]')`);
    assert.equal(calls.get("/employees"), employeeReadsBefore, "HR reports use safe employee options");
    // Permission-driven UI: without "Create/edit clients" the Clients page is
    // read-only and explains why; without reports the menu drops them and the
    // page explains instead of failing.
    roleGrants.hr = roleGrants.hr.filter((key) => !["manage_clients", "view_all_reports"].includes(key));
    await win.loadURL(`${base}/admin/clients`);
    await until(`!!document.querySelector('.crm-permission-note')`);
    assert.match(await evaluate("document.querySelector('.crm-permission-note').textContent"), /Create\/edit clients/);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('Add Client'))`), false);
    assert.equal(await evaluate(`!!document.querySelector('a[href="/admin/timesheets/detailed"]')`), false, "report menu hidden");
    assert.equal(await evaluate(`!!document.querySelector('a[href="/admin/timesheets/attendance"]')`), true, "attendance stays");
    await win.loadURL(`${base}/admin/timesheets/detailed`);
    await until(`document.querySelector('.crm-access-denied')?.textContent.includes('View all employee reports')`);
    roleGrants.hr.push("manage_clients", "view_all_reports");
    await win.loadURL(`${base}/admin/scheduler/schedule`);
    await until(`!!document.querySelector('.schedule-filter-row option[value="employee-125"]')`);
    await until(`document.querySelectorAll('.schedule-table tbody tr').length === 125`);
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Add New Schedule')).click()`);
    await until(`!!document.querySelector('.schedule-add-filter-row option[value="shift-125"]')`);
    assert.equal(await evaluate(`!!document.querySelector('.schedule-add-filter-row option[value="team"]')`), true);
    user.role = "employee";
    user.permissions = ["create_employees", "edit_employees"];
    await restoreUser("/admin/employees");
    await until(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Edit')`);
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Edit').click()`);
    await until(`!!document.querySelector('.employee-editor-form--edit select option[value="team"]')`);
    assert.equal(await evaluate(`document.querySelector('.employee-editor-form--edit input[type=email]').disabled`), true);
    await evaluate(`(() => {
      const form = document.querySelector('.employee-editor-form--edit');
      const input = form.querySelector('input[placeholder="Employee name"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Employee updated');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate(`document.querySelector('.employee-editor-form--edit button[type=submit]').click()`);
    await until(`!document.querySelector('.employee-editor-form--edit')`);
    assert.equal(lastBodies.get("/employees/employee-1").fullName, "Employee updated");
    assert.equal(lastBodies.get("/employees/employee-1").team, "team");
    assert.equal(Object.hasOwn(lastBodies.get("/employees/employee-1"), "email"), false);
    const timerStopsBefore = calls.get("/time-logs/stop") || 0;
    await evaluate(`document.querySelector('.crm-signout').click()`);
    await until(`location.pathname === '/login'`);
    assert.equal(calls.get("/time-logs/stop") || 0, timerStopsBefore, "web sign-out never stops the desktop timer");
    assert.equal(desktopTimerRunning, true);
    console.log("PASS: Teams polling (30 s), permission-driven menus/actions, navigation, bulk task controls, session restoration, Client timesheets/exports, device approval/revocation, HR lookups, 125 employees/shifts/schedules, delegated editing, and independent web sign-out.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    win?.destroy();
    server.close();
    app.quit();
  }
});
