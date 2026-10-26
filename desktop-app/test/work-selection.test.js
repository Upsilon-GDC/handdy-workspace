const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

class FakeOption {
  constructor(text = "", value = "") {
    this.textContent = text;
    this.value = value;
    this.dataset = {};
  }
}

class FakeSelect {
  constructor() {
    this.options = [];
    this.selectedIndex = -1;
    this.disabled = false;
    this.listeners = {};
    this.rebuilds = 0;
  }
  get value() { return this.options[this.selectedIndex]?.value ?? ""; }
  set value(value) { this.selectedIndex = this.options.findIndex((option) => option.value === value); }
  get selectedOptions() { return this.selectedIndex >= 0 ? [this.options[this.selectedIndex]] : []; }
  replaceChildren(...options) { this.rebuilds += 1; this.options = options; this.selectedIndex = options.length ? 0 : -1; }
  appendChild(option) { this.options.push(option); if (this.selectedIndex < 0) this.selectedIndex = 0; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  choose(value) { this.value = value; return this.listeners.change?.(); }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ role = "employee" } = {}) {
  const nodes = new Map([["projectSelect", new FakeSelect()], ["clientSelect", new FakeSelect()], ["taskSelect", new FakeSelect()]]);
  const values = new Map([["token", "test-only"]]);
  const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const state = {
    projects: [{ _id: "p1", projectName: "Tax Preparation", clientName: "KCPA" }, { _id: "p2", projectName: "Audit", clientName: "Renau" }],
    clients: [
      { _id: "client-a", clientName: "Alpha", status: "Active" },
      { _id: "client-b", clientName: "Beta", status: "Active" },
    ],
    tasks: { p1: [{ _id: "t1", taskName: "TAX 1" }, { _id: "t2", taskName: "TAX 2" }], p2: [{ _id: "t3", taskName: "Audit 1" }] },
    breakTasks: [],
    failTasks: false,
    projectPages: null,
    taskPages: {},
    taskUrls: [],
    startRequests: [],
    startBodies: [],
    pending: null,
    pendingStart: null,
    clientRequests: [],
    clientPending: null,
    clientFailure: false,
    clientResponse: null,
    cacheModes: [],
    startFailures: 0,
    startError: null,
    stopBodies: [],
    stopError: null,
    activeRequests: 0,
  };
  const context = vm.createContext({
    console: { ...console, log() {}, trace() {}, debug() {}, warn() {} },
    AbortSignal, Date, Intl, JSON, localStorage, sessionStorage: localStorage,
    setInterval: () => 1, clearInterval() {}, setTimeout, Option: FakeOption,
    document: {
      body: { dataset: { page: "dashboard" } },
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { textContent: "", hidden: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, replaceChildren() {}, appendChild() {} });
        return nodes.get(id);
      },
      createElement: () => ({ dataset: {}, classList: { add() {} }, appendChild() {} }),
      querySelectorAll: () => [], addEventListener() {},
    },
    window: { electronAPI: {}, location: { replace() {} }, addEventListener() {} },
    fetch: async (url, options = {}) => {
      const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
      state.cacheModes.push([new URL(url).pathname, options.cache]);
      if (url.includes("/clients")) {
        assert.equal(options.headers.Authorization, "Bearer test-only");
        state.clientRequests.push(url);
        const clients = [...state.clients];
        if (state.clientPending) await state.clientPending;
        if (state.clientFailure) throw new Error("offline");
        return json(state.clientResponse || { clients });
      }
      if (url.includes("/projects")) {
        const page = Number(new URL(url).searchParams.get("page") || 1);
        const pages = state.projectPages || [state.projects];
        return json({ projects: pages[page - 1] || [], totalPages: pages.length });
      }
      if (url.includes("/tasks")) {
        state.taskUrls.push(url);
        if (state.pending) await state.pending;
        if (state.failTasks) return json({ message: "boom" }, false);
        const params = new URL(url).searchParams;
        const projectId = params.get("project");
        const page = Number(new URL(url).searchParams.get("page") || 1);
        const pages = params.get("taskType") === "break"
          ? [state.breakTasks]
          : state.taskPages[projectId] || [state.tasks[projectId] || []];
        return json({ success: true, tasks: pages[page - 1] || [], totalPages: pages.length });
      }
      if (url.includes("/time-logs/start")) {
        state.startRequests.push(url);
        const body = JSON.parse(options.body);
        state.startBodies.push(body);
        if (state.pendingStart) await state.pendingStart;
        if (state.startFailures > 0) {
          state.startFailures -= 1;
          throw new TypeError("network down");
        }
        if (state.startError) return { ok: false, status: state.startError.status, json: async () => state.startError.body };
        return json({ timeLog: {
          _id: "log-1", status: "running", startedAt: new Date().toISOString(),
          project: { _id: body.project }, client: body.client ? { _id: body.client } : null,
          task: { _id: body.task, taskType: "work" }, pauses: [],
        } });
      }
      if (url.includes("/time-logs/stop")) {
        state.stopBodies.push(JSON.parse(options.body || "{}"));
        if (state.stopError) return { ok: false, status: state.stopError.status, json: async () => state.stopError.body };
        return json({ timeLogs: [] });
      }
      if (url.includes("/time-logs/active")) state.activeRequests += 1;
      if (url.includes("/auth/me")) return json({ user: { _id: "test-user", fullName: "Test Employee", role } });
      return json({ timeLogs: [] });
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../renderer.js"), "utf8"), context);
  localStorage.setItem("user", JSON.stringify({ _id: "test-user", role }));
  return { state, context, project: nodes.get("projectSelect"), client: nodes.get("clientSelect"), task: nodes.get("taskSelect"), run: (source) => vm.runInContext(source, context) };
}

test("desktop client selector uses all active clients and starts promptly", async () => {
  const h = harness();
  await h.context.loadClients();
  await h.context.loadProjects();
  await h.project.choose("p1");
  await h.task.choose("t1");
  assert.deepEqual(h.client.options.map((option) => option.textContent), ["Select client", "Alpha", "Beta"]);
  await h.context.startTimer();
  assert.equal(h.state.startRequests.length, 0, "a client is required when active clients are available");
  await h.client.choose("client-b");
  let releaseStart;
  h.state.pendingStart = new Promise((resolve) => { releaseStart = resolve; });
  const pending = h.context.startTimer();
  assert.equal(h.run("timerStatus.textContent"), "Starting...");
  assert.equal(h.run("timerMessage.textContent"), "Starting timer...");
  releaseStart();
  await pending;
  assert.equal(h.state.startBodies[0].client, "client-b");
  assert.equal(h.client.disabled, true);
  assert.equal(h.run("timerStatus.textContent"), "Working");
});

for (const role of ["employee", "team_lead"]) {
  test(`${role}: client catalog is available after project selection, even without project client links`, async () => {
    const h = harness({ role });
    await h.context.loadClients();
    assert.equal(h.client.disabled, true);
    assert.equal(h.client.options[0].textContent, "Select project first");
    await h.context.loadProjects();
    await h.project.choose("p1");
    assert.equal(h.client.disabled, false);
    assert.deepEqual(h.client.options.map(option => option.value), ["", "client-a", "client-b"]);
    await h.client.choose("client-a");
    await h.task.choose("t1");
    await h.client.choose("client-b");
    assert.equal(h.task.value, "t1");
    await h.context.startTimer();
    assert.deepEqual(h.state.startBodies[0].client, "client-b");
    assert.equal(h.state.startBodies[0].project, "p1");
    assert.equal(h.state.startBodies[0].task, "t1");
  });
}

test("one client is selected automatically; a genuinely empty catalog uses the empty state", async () => {
  const h = harness();
  h.state.clients = [h.state.clients[0]];
  await h.context.loadProjects();
  await h.project.choose("p1");
  assert.equal(h.client.value, "client-a");
  assert.equal(h.client.disabled, false);
  h.state.clients = [];
  await h.context.loadClients();
  assert.equal(h.client.value, "");
  assert.equal(h.client.disabled, true);
  assert.equal(h.client.options[0].textContent, "No clients available");
});

test("project changes preserve a valid shared client; removal from the catalog clears it", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  await h.client.choose("client-b");
  await h.task.choose("t1");
  await h.project.choose("p2");
  assert.equal(h.client.value, "client-b");
  assert.equal(h.task.value, "");
  h.state.clients = [h.state.clients[0], { _id: "client-c", clientName: "Gamma", status: "Active" }];
  await h.context.loadClients();
  assert.equal(h.client.value, "");
  await h.project.choose("");
  assert.equal(h.client.disabled, true);
  assert.equal(h.client.options[0].textContent, "Select project first");
});

test("refresh and saved selection restore retain client IDs and names without rebuilding unchanged options", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  await h.client.choose("client-b");
  await h.task.choose("t2");
  const rebuilds = h.client.rebuilds;
  await h.context.refreshDesktopData();
  assert.equal(h.client.value, "client-b");
  assert.equal(h.client.selectedOptions[0].textContent, "Beta");
  assert.equal(h.client.rebuilds, rebuilds);
  h.run('selectedClientId = ""; selectedProjectId = ""; selectedTaskId = "";');
  h.context.restoreWorkSelection();
  await h.context.loadClients();
  await h.context.loadProjects();
  await h.context.loadTasks("p1");
  assert.equal(h.client.value, "client-b");
  assert.equal(h.task.value, "t2");
});

test("failed or malformed client requests show an error and never masquerade as an empty catalog", async () => {
  const h = harness();
  h.state.clientFailure = true;
  await h.context.loadProjects();
  await h.project.choose("p1");
  assert.equal(h.client.options[0].textContent, "Unable to load clients");
  await h.task.choose("t1");
  await h.context.startTimer();
  assert.equal(h.state.startRequests.length, 0);
  h.state.clientFailure = false;
  h.state.clientResponse = { success: true };
  assert.equal(await h.context.loadClients(), false);
  assert.equal(h.client.options[0].textContent, "Unable to load clients");
  h.state.clientResponse = null;
  await h.context.loadClients();
  await h.client.choose("client-b");
  h.state.clientFailure = true;
  await h.context.loadClients();
  assert.equal(h.client.value, "client-b", "A transient failure preserves the last successfully authorized options");
});

test("stale client responses cannot replace a newer authorized list", async () => {
  const h = harness();
  await h.context.loadProjects();
  let release;
  h.state.clientPending = new Promise(resolve => { release = resolve; });
  const first = h.project.choose("p1");
  h.state.clientPending = null;
  h.state.clients = [{ _id: "new", clientName: "New client", status: "Active" }];
  await h.project.choose("p2");
  release();
  await first;
  assert.equal(h.project.value, "p2");
  assert.deepEqual(h.client.options.map(option => option.value), ["", "new"]);
});

test("inactive and malformed rows never create selectable clients; duplicate IDs are deduplicated", async () => {
  const h = harness();
  h.state.clients.push(null, { _id: "inactive", clientName: "Inactive", status: "Inactive" },
    { clientName: "Missing ID" }, { _id: "blank", clientName: " " }, h.state.clients[0]);
  await h.context.loadProjects();
  await h.project.choose("p1");
  assert.deepEqual(h.client.options.map(option => option.value), ["", "client-a", "client-b"]);
});

test("an active timer retains its recorded client even if it is no longer selectable for new work", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  h.run('currentTimeLog = { project: {_id: "p1"}, client: {_id: "old", clientName: "Recorded client"} };');
  h.context.updateClientName();
  assert.equal(h.client.value, "old");
  assert.equal(h.client.selectedOptions[0].textContent, "Recorded client");
  assert.equal(h.client.disabled, true);
});

test("idle stop preserves project/client/task for an explicit Start; manual Stop still clears the task", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.context.loadClients();
  await h.project.choose('p1');
  await h.task.choose('t2');
  await h.client.choose('client-b');
  await h.context.startTimer();
  await h.context.stopTimer({ idleSeconds: 300 });
  assert.equal(h.project.value, 'p1');
  assert.equal(h.task.value, 't2');
  assert.equal(h.client.value, 'client-b');
  await h.context.refreshDesktopData();
  assert.equal(h.task.value, 't2');
  await h.context.startTimer();
  assert.deepEqual(h.state.startBodies.map(({ project, client, task }) => ({ project, client, task })), [
    { project: 'p1', client: 'client-b', task: 't2' }, { project: 'p1', client: 'client-b', task: 't2' },
  ]);
  await h.context.stopTimer();
  assert.equal(h.task.value, '');
});

test("selected project and task survive repeated and overlapping background refreshes", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  assert.equal(h.task.disabled, false);
  assert.deepEqual(h.task.options.map((option) => option.textContent), ["Select Task", "TAX 1", "TAX 2"]);
  await h.task.choose("t2");

  const projectRebuilds = h.project.rebuilds;
  const taskRebuilds = h.task.rebuilds;
  await Promise.all([h.context.refreshDesktopData(), h.context.refreshDesktopData(), h.context.refreshDesktopData()]);
  await h.context.refreshDesktopData();

  assert.equal(h.project.value, "p1");
  assert.equal(h.task.value, "t2");
  assert.equal(h.run("selectedProjectId + '/' + selectedTaskId"), "p1/t2");
  assert.equal(h.project.rebuilds, projectRebuilds, "unchanged project list must not rebuild the dropdown");
  assert.equal(h.task.rebuilds, taskRebuilds, "unchanged task list must not rebuild the dropdown");
});

test("newly assigned task appears on refresh without losing the selection", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  await h.task.choose("t1");
  h.state.tasks.p1.push({ _id: "t9", taskName: "New assignment" });

  await h.context.refreshDesktopData();

  assert.ok(h.task.options.some((option) => option.value === "t9"));
  assert.equal(h.project.value, "p1");
  assert.equal(h.task.value, "t1");
});

test("project and task selectors load every API page", async () => {
  const h = harness();
  h.state.projectPages = [
    [{ _id: "p1", projectName: "Tax Preparation", clientName: "KCPA" }],
    [{ _id: "p2", projectName: "Audit", clientName: "Renau" }],
  ];
  h.state.taskPages.p1 = [
    [{ _id: "t1", taskName: "TAX 1" }],
    [{ _id: "t2", taskName: "TAX 2" }],
  ];

  await h.context.loadProjects();
  assert.deepEqual(h.project.options.map((option) => option.value), ["", "p1", "p2"]);
  await h.project.choose("p1");
  assert.deepEqual(h.task.options.map((option) => option.value), ["", "t1", "t2"]);
});

test("a note is not saved automatically and survives refresh until Save note is used", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  await h.task.choose("t1");

  h.run("timerNote.value = 'Prepare supporting documents'; noteDirty = true");
  await h.context.refreshDesktopData();

  assert.equal(h.run("timerNote.value"), "Prepare supporting documents");
  assert.equal(h.run("localStorage.getItem(getNoteDraftStorageKey())"), null);

  await h.context.saveNote();
  assert.equal(
    h.run("localStorage.getItem(getNoteDraftStorageKey())"),
    "Prepare supporting documents"
  );
});

test("changing project keeps the new project, clears only the task, and ignores stale task responses", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  await h.task.choose("t1");

  let release;
  h.state.pending = new Promise((resolve) => { release = resolve; });
  const staleLoad = h.project.choose("p1");
  await flush();
  h.state.pending = null;
  await h.project.choose("p2");
  release();
  await staleLoad;

  assert.equal(h.project.value, "p2");
  assert.equal(h.run("selectedTaskId"), "");
  assert.deepEqual(h.task.options.map((option) => option.textContent), ["Select Task", "Audit 1"]);
  assert.ok(h.state.taskUrls.every((url) => /project=p[12]&|taskType=break&/.test(url)), "tasks are requested by project or break type");
});

test("assigned projectless break task appears in the task dropdown", async () => {
  const h = harness();
  h.state.breakTasks = [{ _id: "lunch", taskName: "Lunch", taskType: "break", project: null }];
  await h.context.loadProjects();
  await h.project.choose("p1");

  assert.deepEqual(h.task.options.map((option) => option.textContent), [
    "Select Task", "TAX 1", "TAX 2", "Lunch (Break)",
  ]);
  assert.equal(h.task.options.at(-1).dataset.taskType, "break");
  await h.task.choose("lunch");
  assert.equal(h.run("selectedTaskId"), "lunch");
});

test("task dropdown shows explicit empty and error states", async () => {
  const h = harness();
  await h.context.loadProjects();

  h.state.tasks.p2 = [];
  await h.project.choose("p2");
  assert.equal(h.task.options[0].textContent, "No tasks available for this project");
  assert.equal(h.task.disabled, true);
  assert.equal(h.project.value, "p2");

  h.state.failTasks = true;
  await h.project.choose("p1");
  assert.equal(h.task.options[0].textContent, "Unable to load tasks");
  assert.equal(h.task.disabled, true);
  assert.equal(h.project.value, "p1");

  await h.project.choose("");
  assert.equal(h.task.options[0].textContent, "Select Task");
  assert.equal(h.task.disabled, true);
});

test("start refuses a hidden stored task when the visible dropdown has no task", async () => {
  const h = harness();
  await h.context.loadProjects();
  h.project.value = "p1";
  h.run("selectedProjectId = 'p1'; selectedTaskId = 't2'");

  await h.context.startTimer();

  assert.equal(h.state.startRequests.length, 0);
  assert.equal(h.run("selectedTaskId"), "");
  assert.equal(h.run("timerMessage.textContent"), "Please select a project and task first.");
});

test("an inactive server timer clears the previous task and requires a fresh selection", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  await h.task.choose("t2");

  await h.context.loadActiveTimer();

  assert.equal(h.run("selectedTaskId"), "");
  assert.equal(h.task.value, "");
  assert.deepEqual(h.task.options.map((option) => option.value), ["", "t1", "t2"]);
});

test("project and task lists revalidate with the server's ETag; the timesheet sync is never stored", async () => {
  const h = harness();
  await h.context.loadProjects();
  await h.project.choose("p1");
  await h.run("loadTodayTimesheet()");
  const modes = Object.fromEntries(h.state.cacheModes.map(([pathname, mode]) => [pathname.replace(/^.*\/api/, ""), mode]));
  assert.equal(modes["/projects"], "no-cache", "unchanged projects cost a 304 instead of the full list");
  assert.equal(modes["/tasks"], "no-cache");
  assert.equal(modes["/time-logs/history"], "no-store");
});

// Phase 3: retried starts and stops are safe (operation IDs, named timers).
async function readyToStart(h) {
  await h.context.loadProjects();
  await h.context.loadClients();
  await h.project.choose("p1");
  await h.task.choose("t1");
  await h.client.choose("client-b");
}

test("a start retried after a lost response reuses its operation ID; the next start gets a new one", async () => {
  const h = harness();
  await readyToStart(h);
  h.state.startFailures = 1;
  await h.context.startTimer();
  assert.equal(h.run("timerMessage.textContent"), "Unable to reach the backend server.");
  const first = h.state.startBodies[0].operationId;
  assert.match(first, /^[A-Za-z0-9_-]{8,100}$/);
  await h.context.startTimer();
  assert.equal(h.state.startBodies[1].operationId, first, "the retry can be recognised by the server");
  await h.context.stopTimer();
  await h.task.choose("t1"); // a manual Stop clears the task selection
  await h.context.startTimer();
  assert.notEqual(h.state.startBodies[2].operationId, first, "a new start after the server answered");
});

test("a start refused because a timer already runs shows that timer instead of an error", async () => {
  const h = harness();
  await readyToStart(h);
  h.state.startError = { status: 400, body: { success: false, code: "ACTIVE_TIMER_EXISTS", message: "You already have an active timer." } };
  await h.context.startTimer();
  assert.equal(h.state.activeRequests, 1, "reloads the running timer from the server");
  assert.equal(h.run("timerMessage.textContent"), "A timer was already running. It is shown again.");
});

test("the stop button names its timer, and a changed timer is reconciled instead of stopped", async () => {
  const h = harness();
  await readyToStart(h);
  await h.context.startTimer();
  await h.context.stopTimer();
  assert.equal(h.state.stopBodies[0].timeLogId, "log-1");
  assert.match(h.state.stopBodies[0].operationId, /^[A-Za-z0-9_-]{8,100}$/);
  await h.task.choose("t1");
  await h.context.startTimer();
  h.state.stopError = { status: 409, body: { success: false, code: "TIMER_CHANGED", message: "A different timer is running now." } };
  const before = h.state.activeRequests;
  await h.context.stopTimer();
  assert.equal(h.state.activeRequests, before + 1);
  assert.equal(h.run("timerMessage.textContent"), "A different timer is running now. Your timer has been refreshed.");
  assert.notEqual(h.state.stopBodies[1].operationId, h.state.stopBodies[0].operationId);
});
