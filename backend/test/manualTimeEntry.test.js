const test = require("node:test");
const assert = require("node:assert/strict");

const TaskTimeLog = require("../src/models/TaskTimeLog");
const Employee = require("../src/models/Employee");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const Team = require("../src/models/Team");
const Client = require("../src/models/Client");
const {
  canActOnEmployee,
  createManualEntry,
  deleteManualEntry,
  getManualEntryOptions,
  validateManualEntryInput,
} = require("../src/modules/timers/manualTimeEntryController");

const ids = {
  employee: "64b000000000000000000a01",
  project: "64b000000000000000000a02",
  task: "64b000000000000000000a03",
  client: "64b000000000000000000a04",
  admin: "64b000000000000000000a05",
  lead: "64b000000000000000000a06",
  team: "64b000000000000000000a07",
};
const NOW = new Date("2026-10-09T12:00:00Z");
const valid = (overrides = {}) => ({
  employee: ids.employee, project: ids.project, task: ids.task, client: ids.client,
  startedAt: "2026-10-08T09:00:00Z", stoppedAt: "2026-10-08T11:30:00Z", reason: "Forgot to start the timer", ...overrides,
});

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const chain = (value) => ({
  select() { return this; }, sort() { return this; }, populate() { return this; },
  lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

test("validation requires ids, a sensible time range and an explanatory reason", () => {
  assert.equal(validateManualEntryInput(valid(), NOW).value.seconds, 9000);
  const invalid = [
    [{ employee: "nope" }, /valid employee/],
    [{ task: undefined }, /valid task/],
    [{ startedAt: "garbage" }, /valid start and end/],
    [{ stoppedAt: "2026-10-08T09:00:00Z" }, /after start/],
    [{ stoppedAt: "2026-10-10T09:00:00Z" }, /future/],
    [{ startedAt: "2026-10-07T09:00:00Z", stoppedAt: "2026-10-08T11:30:00Z" }, /24 hours/],
    [{ reason: "  " }, /reason/],
    [{ reason: "x".repeat(501) }, /exceed/],
  ];
  for (const [override, pattern] of invalid) {
    const result = validateManualEntryInput(valid(override), NOW);
    assert.match(result.error || "", pattern, JSON.stringify(override));
  }
});

test("manual-entry hierarchy: admin, manager and HR act on every employee; leads only on their employees", async (t) => {
  t.mock.method(Team, "exists", async (filter) => (String(filter._id) === ids.team && String(filter.teamLead) === ids.lead ? { _id: ids.team } : null));
  const target = { _id: ids.employee, role: "employee", team: ids.team, teamLead: null };
  for (const actorRole of ["admin", "alpha", "manager", "hr"]) {
    for (const role of ["employee", "team_lead", "hr", "manager", "admin", "alpha"]) {
      assert.equal(await canActOnEmployee({ _id: ids.admin, role: actorRole }, { ...target, role }), true, `${actorRole} -> ${role}`);
    }
    assert.equal(await canActOnEmployee({ _id: ids.admin, role: actorRole }, { _id: ids.admin, role: actorRole }), true, `${actorRole} self`);
  }
  for (const role of ["manager", "hr", "admin", "alpha"]) {
    assert.equal(await canActOnEmployee({ _id: ids.lead, role: "team_lead" }, { ...target, teamLead: ids.lead, role }), false);
  }
  assert.equal(await canActOnEmployee({ _id: ids.lead, role: "team_lead" }, { ...target, role: "team_lead" }), false);
  assert.equal(await canActOnEmployee({ _id: ids.lead, role: "team_lead" }, target), true);
  assert.equal(await canActOnEmployee({ _id: ids.lead, role: "team_lead" }, { ...target, team: "64b000000000000000000a99" }), false);
  assert.equal(await canActOnEmployee({ _id: ids.lead, role: "team_lead" }, { _id: ids.lead, team: ids.team }), false, "no self-entry");
  assert.equal(await canActOnEmployee({ _id: ids.employee, role: "employee" }, target), false);
});

const mockHappyPath = (t, { conflict = null, taskFound = true, createdRef } = {}) => {
  t.mock.method(Employee, "findById", () => chain({ _id: ids.employee, role: "employee", team: ids.team, isActive: true }));
  t.mock.method(Team, "exists", async () => ({ _id: ids.team }));
  t.mock.method(Project, "findOne", () => chain({ _id: ids.project, clients: [ids.client], client: null, teams: [ids.team] }));
  t.mock.method(Task, "findOne", () => chain(taskFound ? { _id: ids.task } : null));
  t.mock.method(Client, "exists", async () => ({ _id: ids.client }));
  t.mock.method(TaskTimeLog, "findOne", () => chain(conflict));
  t.mock.method(TaskTimeLog, "create", async (doc) => { if (createdRef) createdRef.doc = doc; return { ...doc, _id: "log-1" }; });
  t.mock.method(TaskTimeLog, "findById", () => chain({ _id: "log-1", entrySource: "manual" }));
};

test("an authorized manager records a stopped, clearly-marked, auditable manual entry", async (t) => {
  const created = {};
  mockHappyPath(t, { createdRef: created });
  const res = response();
  await createManualEntry({ user: { _id: ids.admin, role: "admin" }, body: valid() }, res);
  assert.equal(res.statusCode, 201);
  const doc = created.doc;
  assert.equal(doc.entrySource, "manual");
  assert.equal(doc.status, "stopped");
  assert.equal(doc.isActiveTimer, false);
  assert.equal(doc.totalWorkedSeconds, 9000);
  assert.equal(doc.totalPausedSeconds, 0);
  assert.equal(doc.manualEntry.createdBy, ids.admin);
  assert.equal(doc.manualEntry.reason, "Forgot to start the timer");
  assert.ok(doc.manualEntry.createdAt instanceof Date);
  assert.match(doc.note, /^Manual entry:/);
});

test("overlapping or duplicate time records are rejected with 409 and nothing is written", async (t) => {
  const created = {};
  mockHappyPath(t, { conflict: { startedAt: new Date("2026-10-08T10:00:00Z"), stoppedAt: null, entrySource: "timer" }, createdRef: created });
  const res = response();
  await createManualEntry({ user: { _id: ids.admin, role: "admin" }, body: valid() }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(created.doc, undefined);
});

test("the overlap query treats an open timer as running and excludes touching boundaries", async (t) => {
  let overlapFilter;
  mockHappyPath(t);
  t.mock.method(TaskTimeLog, "findOne", (filter) => { overlapFilter = filter; return chain(null); });
  await createManualEntry({ user: { _id: ids.admin, role: "admin" }, body: valid() }, response());
  assert.deepEqual(overlapFilter.startedAt, { $lt: new Date("2026-10-08T11:30:00Z") });
  assert.equal(overlapFilter["manualEntry.deletedAt"], null, "deleted manual hours may be replaced");
  assert.deepEqual(overlapFilter.$or, [{ stoppedAt: null }, { stoppedAt: { $gt: new Date("2026-10-08T09:00:00Z") } }]);
});

test("a task the employee is not permitted to work on is rejected", async (t) => {
  mockHappyPath(t, { taskFound: false });
  const res = response();
  await createManualEntry({ user: { _id: ids.admin, role: "admin" }, body: valid() }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /not assigned/);
});

test("a client that is not linked to the project is rejected", async (t) => {
  mockHappyPath(t);
  const res = response();
  await createManualEntry({ user: { _id: ids.admin, role: "admin" }, body: valid({ client: "64b000000000000000000a77" }) }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /client/i);
});

test("a team lead cannot record time for an employee outside their team", async (t) => {
  mockHappyPath(t);
  t.mock.method(Team, "exists", async () => null);
  const res = response();
  await createManualEntry({ user: { _id: ids.lead, role: "team_lead" }, body: valid() }, res);
  assert.equal(res.statusCode, 403);
});

test("the option list is filtered to what the employee may work on", async (t) => {
  let taskFilter;
  t.mock.method(Employee, "findById", () => chain({ _id: ids.employee, role: "employee", team: ids.team, isActive: true }));
  t.mock.method(Team, "exists", async () => ({ _id: ids.team }));
  t.mock.method(Project, "find", () => chain([
    { _id: ids.project, projectName: "Allowed", clients: [ids.client], teams: [ids.team] },
    { _id: "64b000000000000000000b01", projectName: "Other team", clients: [], teams: ["64b000000000000000000b02"] },
    { _id: "64b000000000000000000b03", projectName: "Legacy open", clients: [], teams: [] },
  ]));
  t.mock.method(Task, "find", (filter) => { taskFilter = filter; return chain([{ _id: ids.task, taskName: "Prep", project: ids.project }]); });
  t.mock.method(Client, "find", () => chain([{ _id: ids.client, clientName: "ABC" }]));
  const res = response();
  await getManualEntryOptions({ user: { _id: ids.admin, role: "admin" }, query: { employee: ids.employee } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.projects.map((project) => project.projectName), ["Allowed"]);
  assert.deepEqual(res.body.projects[0].clientIds, [ids.client]);
  assert.equal(taskFilter.taskType, "work");
  assert.deepEqual(taskFilter.$or[0], { assignedTo: ids.employee });
});

test("manual deletion retains its audit record and rejects timer logs, wrong roles and repeated deletion", async (t) => {
  const logId = "64b000000000000000000c01";
  const target = { _id: ids.employee, role: "employee", team: ids.team, isActive: true };
  let entry = { _id: logId, employee: ids.employee, status: "stopped", isActiveTimer: false };
  let update;
  t.mock.method(Employee, "findById", () => chain(target));
  t.mock.method(TaskTimeLog, "findOne", (filter) => {
    assert.equal(filter.entrySource, "manual");
    assert.equal(filter["manualEntry.deletedAt"], null);
    return chain(entry);
  });
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (filter, value, options) => {
    assert.equal(filter.entrySource, "manual");
    assert.equal(filter.isActiveTimer, false);
    assert.equal(filter["manualEntry.deletedAt"], null);
    assert.deepEqual(options.projection, { _id: 1 });
    update = value;
    return { _id: logId };
  });
  const call = async (role, id = logId) => {
    const res = response();
    await deleteManualEntry({ user: { _id: ids.admin, role }, params: { id } }, res);
    return res;
  };
  assert.equal((await call("manager", "invalid")).statusCode, 400);
  assert.equal((await call("employee")).statusCode, 403);
  assert.equal(update, undefined);
  target.role = "admin";
  assert.equal((await call("team_lead")).statusCode, 403, "a team lead cannot delete an admin's entry");
  target.role = "employee";
  entry.status = "running";
  assert.equal((await call("manager")).statusCode, 409);
  entry.status = "stopped";
  const deleted = await call("manager");
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.timeLogId, logId);
  assert.ok(update.$set["manualEntry.deletedAt"] instanceof Date);
  assert.equal(update.$set["manualEntry.deletedBy"], ids.admin);
  entry = null;
  assert.equal((await call("manager")).statusCode, 404, "timers and already-deleted manual entries do not match");
});

test("a changed manual entry is not deleted twice by concurrent requests", async (t) => {
  t.mock.method(TaskTimeLog, "findOne", () => chain({ _id: ids.task, employee: ids.employee, status: "stopped", isActiveTimer: false }));
  t.mock.method(Employee, "findById", () => chain({ _id: ids.employee, role: "employee" }));
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async () => null);
  const res = response();
  await deleteManualEntry({ user: { _id: ids.admin, role: "manager" }, params: { id: ids.task } }, res);
  assert.equal(res.statusCode, 409);
});
