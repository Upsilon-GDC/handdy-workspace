// Any duty can be given to any role (2026-10-26). Company-wide duties cover
// the company; team duties cover the person's own team (services/teamScope.js).
const test = require("node:test");
const assert = require("node:assert/strict");

const Employee = require("../src/models/Employee");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const Team = require("../src/models/Team");
const { ownTeamIds, teamMemberFilter } = require("../src/services/teamScope");
const { deleteTask, getAllTasks, resolveProjectForTeams, updateTask } = require("../src/modules/tasks/taskController");
const { canActOnEmployee } = require("../src/modules/timers/manualTimeEntryController");
const { getMyTeam } = require("../src/modules/employees/employeeController");
const { getBillingEmployeeAccess } = require("../src/utils/billingUtils");
const attendanceRoutes = require("../src/modules/attendance/attendanceRoutes");
const employeeRoutes = require("../src/modules/employees/employeeRoutes");
const teamRoutes = require("../src/modules/teams/teamRoutes");
const taskRoutes = require("../src/modules/tasks/taskRoutes");
const taskTimeLogRoutes = require("../src/modules/timers/taskTimeLogRoutes");

const TEAM = "64b000000000000000000b01";
const OTHER_TEAM = "64b000000000000000000b02";
const ME = "64b000000000000000000c01";
const MATE = "64b000000000000000000c02";

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

// A senior employee given task and manual-entry duties for their own team.
const senior = (granted = []) => ({ _id: ME, role: "employee", team: TEAM, permissionOverrides: { granted } });

const activeTeam = (t, ids = [TEAM]) => {
  t.mock.method(Team, "findOne", (filter) => ({
    select() { return this; },
    lean: async () => (ids.includes(String(filter._id)) && filter.isActive ? { _id: filter._id } : null),
  }));
};

test("own team: the teams a lead leads, or the active team an employee belongs to", async (t) => {
  t.mock.method(Team, "find", (filter) => ({ distinct: async () => (String(filter.teamLead) === "lead" ? [TEAM, OTHER_TEAM] : []) }));
  activeTeam(t);
  assert.deepEqual(await ownTeamIds({ _id: "lead", role: "team_lead", team: OTHER_TEAM }), [TEAM, OTHER_TEAM]);
  assert.deepEqual((await ownTeamIds(senior())).map(String), [TEAM]);
  assert.deepEqual(await ownTeamIds({ _id: ME, role: "employee", team: OTHER_TEAM }), [], "inactive team");
  assert.deepEqual(await ownTeamIds({ _id: "hr-1", role: "hr", team: null }), []);

  assert.deepEqual(await teamMemberFilter({ _id: "lead", role: "team_lead" }), { teamLead: "lead", isActive: true }, "leads unchanged");
  const filter = await teamMemberFilter(senior());
  assert.deepEqual({ ...filter, team: { $in: filter.team.$in.map(String) } },
    { team: { $in: [TEAM] }, role: "employee", isActive: true });
});

test("an employee with task duties manages only their own team's tasks", async (t) => {
  activeTeam(t);
  t.mock.method(Team, "exists", async () => ({ _id: TEAM }));
  // Task creation resolves the person's teams with Team.find({ _id: { $in } }).
  t.mock.method(Team, "find", async (filter) => (filter._id.$in.map(String).includes(TEAM) ? [{ _id: TEAM }] : []));
  // New tasks go to the own team; another team is refused.
  const res = response();
  await resolveProjectForTeams({ user: senior(["create_tasks"]), query: { teams: OTHER_TEAM } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /another team/);
  const noTeam = response();
  await resolveProjectForTeams({ user: { ...senior(["create_tasks"]), team: null }, query: {} }, noTeam);
  assert.match(noTeam.body.message, /not assigned to an active team/);

  let deleteFilter;
  t.mock.method(Task, "findOne", async (filter) => { deleteFilter = filter; return null; });
  await deleteTask({ user: senior(["archive_tasks"]), params: { id: "task-1" } }, response());
  assert.deepEqual(JSON.parse(JSON.stringify(deleteFilter.$or)), [{ team: { $in: [TEAM] } }, { teams: { $in: [TEAM] } }],
    "archiving is limited to the own team");

  let hrFilter;
  t.mock.method(Task, "findOne", async (filter) => { hrFilter = filter; return null; });
  await deleteTask({ user: { _id: "hr-1", role: "hr" }, params: { id: "task-1" } }, response());
  assert.equal(hrFilter.$or, undefined, "HR still works with every team");
});

test("an employee given only Create tasks adds tasks for their own team, as the Add task form sends them", async (t) => {
  activeTeam(t);
  t.mock.method(Team, "find", async (filter) => (filter._id.$in.map(String).includes(TEAM) ? [{ _id: TEAM }] : []));
  t.mock.method(Project, "find", () => ({ select() { return this; }, lean: async () => [{ _id: "p1", teams: [TEAM] }] }));
  t.mock.method(Task, "exists", async () => null);
  t.mock.method(Task, "find", () => ({ select() { return this; }, lean: async () => [] }));
  t.mock.method(Task, "insertMany", async (tasks) => tasks);
  const route = taskRoutes.stack.find((layer) => layer.route?.path === "/bulk" && layer.route.methods.post).route.stack;
  const send = async (teams) => {
    const res = response();
    const req = {
      user: senior(["create_tasks"]), params: {}, query: {},
      body: { taskName: "Debugging", taskType: "work", teams, project: null, assignToAllEmployees: true,
        assignedTo: [], idleLogout: false, taskNames: ["Debugging"], autoProjects: true },
    };
    for (const layer of route.slice(1)) { // everything after sign-in
      let advanced = false;
      await layer.handle(req, res, () => { advanced = true; });
      if (!advanced) break;
    }
    return res;
  };

  const created = await send([TEAM]);
  assert.equal(created.statusCode, 201, created.body?.message);
  assert.deepEqual(created.body.tasks.map((task) => [task.taskName, task.teams.map(String), task.assignToAllEmployees]),
    [["Debugging", [TEAM], true]]);
  const elsewhere = await send([OTHER_TEAM]);
  assert.equal(elsewhere.statusCode, 400);
  assert.match(elsewhere.body.message, /another team/);
});

test("someone given Edit tasks edits their own team's tasks; switching one off still needs Archive tasks", async (t) => {
  activeTeam(t);
  t.mock.method(Team, "find", async (filter) => (filter._id.$in.map(String).includes(TEAM) ? [{ _id: TEAM }] : []));
  t.mock.method(Task, "find", () => ({ select() { return this; }, lean: async () => [] }));
  let task;
  let scope;
  const makeTask = (teams = [TEAM]) => ({
    _id: "t1", taskCode: "TSK-1", taskName: "Debuging", taskType: "work", project: null, team: teams[0], teams,
    assignedTo: [], assignToAllEmployees: true, isActive: true, idleLogout: false, saved: 0, save() { this.saved += 1; },
  });
  t.mock.method(Task, "findOne", async (filter) => { scope = filter; return task; });
  t.mock.method(Task, "findById", () => ({ populate() { return this; }, then: (resolve) => Promise.resolve(task).then(resolve) }));
  const edit = async (body, granted = ["edit_tasks"]) => {
    const res = response();
    await updateTask({ user: senior(granted), params: { id: "t1" }, body }, res);
    return res;
  };
  // What the Tasks page's edit form sends for a team lead or employee: no teams.
  const form = { taskName: "Debugging", taskType: "work", project: null, assignToAllEmployees: true, assignedTo: [], idleLogout: true };

  task = makeTask();
  const saved = await edit(form);
  assert.equal(saved.statusCode, 200, saved.body?.message);
  assert.deepEqual([task.taskName, task.idleLogout, task.teams.map(String), task.saved], ["Debugging", true, [TEAM], 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.$or)), [{ team: { $in: [TEAM] } }, { teams: { $in: [TEAM] } }], "own team only");

  task = makeTask();
  assert.equal((await edit({ ...form, isActive: true })).statusCode, 200, "an unchanged status is fine");
  task = makeTask();
  const off = await edit({ ...form, isActive: false });
  assert.equal(off.statusCode, 403);
  assert.equal(task.saved, 0);
  task = makeTask();
  assert.equal((await edit({ ...form, isActive: false }, ["edit_tasks", "archive_tasks"])).statusCode, 200);

  // A task HR shared with another team is not narrowed to this person's team.
  task = makeTask([TEAM, OTHER_TEAM]);
  const shared = await edit(form);
  assert.equal(shared.statusCode, 400);
  assert.match(shared.body.message, /another team/);
  assert.equal(task.saved, 0);
});

test("the task list adds the own team's tasks only for task management, never for the desktop list", async (t) => {
  activeTeam(t);
  t.mock.method(Team, "exists", async () => ({ _id: TEAM }));
  const filters = [];
  t.mock.method(Task, "countDocuments", async (filter) => { filters.push(filter); return 0; });
  const chain = { populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, then: (resolve) => resolve([]) };
  t.mock.method(Task, "find", () => chain);
  const list = (user, query) => getAllTasks({ user, query: { all: "true", ...query } }, response());
  const hasTeamClause = (filter) => JSON.stringify(filter).includes(`{"team":{"$in":["${TEAM}"]}}`);

  await list(senior(["edit_tasks"]), { scope: "manage" });
  await list(senior(["edit_tasks"]), {});
  await list(senior([]), { scope: "manage" });
  assert.deepEqual(filters.map(hasTeamClause), [true, false, false]);
});

test("an employee with manual-entry duty corrects teammates' time, never their own or another team's", async (t) => {
  t.mock.method(Team, "exists", async (filter) => (String(filter._id) === TEAM && filter.isActive ? { _id: TEAM } : null));
  const actor = senior(["add_manual_entries"]);
  assert.equal(await canActOnEmployee(actor, { _id: MATE, role: "employee", team: TEAM }), true);
  assert.equal(await canActOnEmployee(actor, { _id: ME, role: "employee", team: TEAM }), false, "not themselves");
  assert.equal(await canActOnEmployee(actor, { _id: MATE, role: "employee", team: OTHER_TEAM }), false);
  assert.equal(await canActOnEmployee(actor, { _id: MATE, role: "team_lead", team: TEAM }), false, "not their lead");
  assert.equal(await canActOnEmployee({ ...actor, team: OTHER_TEAM }, { _id: MATE, role: "employee", team: OTHER_TEAM }), false,
    "an inactive team gives no access");
});

test("teammates are listed without rates or contact details for someone who is not the lead", async (t) => {
  activeTeam(t);
  const calls = {};
  t.mock.method(Employee, "countDocuments", async (filter) => { calls.filter = filter; return 1; });
  t.mock.method(Employee, "find", () => ({
    select(fields) { calls.select = fields; return this; },
    populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
    lean: async () => [{ _id: MATE, fullName: "Mate" }],
  }));
  const res = response();
  await getMyTeam({ user: senior(["view_team_timesheets"]), query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.filter.role, "employee");
  assert.doesNotMatch(calls.select, /rate|email|password|phone|address/i);
});

test("billing follows the permission, not the role", () => {
  const target = "64b000000000000000000d01";
  assert.equal(getBillingEmployeeAccess({ role: "team_lead", permissionOverrides: { granted: ["view_billing_amounts"] } }, target).forbidden, false);
  assert.equal(getBillingEmployeeAccess({ role: "employee" }, target).forbidden, true);
  assert.equal(getBillingEmployeeAccess({ role: "hr" }, target).forbidden, false, "HR keeps billing by default");
  assert.equal(getBillingEmployeeAccess({ role: "hr", permissionOverrides: { revoked: ["view_billing_amounts"] } }, target).forbidden, true);
  assert.equal(getBillingEmployeeAccess({ role: "manager" }, target).forbidden, false);
});

test("team and company report endpoints open by permission instead of role", async () => {
  const gate = (router, path, method = "get") => {
    const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
    return layer.route.stack.slice(1, -1).map((item) => item.handle);
  };
  const passes = async (handlers, user) => {
    for (const handle of handlers) {
      let advanced = false;
      await handle({ user, params: {}, query: {}, body: {} }, response(), () => { advanced = true; });
      if (!advanced) return false;
    }
    return true;
  };
  const teamViewer = { role: "employee", permissionOverrides: { granted: ["view_team_timesheets"] } };
  const companyViewer = { role: "team_lead", permissionOverrides: { granted: ["view_all_reports"] } };
  const plain = { role: "employee" };
  const cases = [
    [taskTimeLogRoutes, "/team", teamViewer, true],
    [taskTimeLogRoutes, "/team", plain, false],
    [attendanceRoutes, "/team/history", teamViewer, true],
    [attendanceRoutes, "/team/history", { role: "team_lead", permissionOverrides: { revoked: ["view_team_timesheets"] } }, true],
    [attendanceRoutes, "/team/history", plain, false],
    [attendanceRoutes, "/admin/history", companyViewer, true],
    [attendanceRoutes, "/admin/history", { role: "hr" }, true],
    [attendanceRoutes, "/admin/history", plain, false],
    [employeeRoutes, "/options", companyViewer, true],
    [employeeRoutes, "/options", plain, false],
    [employeeRoutes, "/my-team", { role: "employee", permissionOverrides: { granted: ["create_tasks"] } }, true],
    [employeeRoutes, "/my-team", plain, false],
    [teamRoutes, "/", { role: "employee", permissionOverrides: { granted: ["edit_teams"] } }, true],
    [teamRoutes, "/", plain, false],
  ];
  for (const [router, path, user, expected] of cases) {
    assert.equal(await passes(gate(router, path), user), expected, `${path} ${JSON.stringify(user)}`);
  }
});
