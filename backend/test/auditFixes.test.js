const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const Employee = require("../src/models/Employee");
const AuthSession = require("../src/models/AuthSession");
const DeviceLoginRequest = require("../src/models/DeviceLoginRequest");
const Project = require("../src/models/Project");
const Team = require("../src/models/Team");
const Task = require("../src/models/Task");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const Client = require("../src/models/Client");
const { hashSecret } = require("../src/services/authSessionService");
const { waitForLoginRequest, changePassword } = require("../src/modules/auth/authController");
const { startTimer } = require("../src/modules/timers/taskTimeLogController");
const { getEmployeeOptions } = require("../src/modules/employees/employeeController");
const { getBillingReport } = require("../src/modules/billing/billingController");
const employeeRoutes = require("../src/modules/employees/employeeRoutes");
const teamRoutes = require("../src/modules/teams/teamRoutes");

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("billing keeps recorded clients and missing project-client references through controller enrichment", async (t) => {
  const employeeId = "507f1f77bcf86cd799439011";
  const employee = { _id: employeeId, projectRates: [{ project: "shared", chargeRate: 25 }] };
  const query = (records) => ({ select(fields) { this.fields = fields; return this; }, sort() { return this; }, lean: async () => records });
  t.mock.method(Employee, "findOne", () => query(employee));
  const logsQuery = query([
    { _id: "recorded", task: "task", project: "shared", client: "client-a", startedAt: "2026-10-01T10:00:00Z", stoppedAt: "2026-10-01T11:00:00Z", totalWorkedSeconds: 3600 },
    { _id: "legacy", task: "task", project: "shared", startedAt: "2026-10-01T11:00:00Z", stoppedAt: "2026-10-01T12:00:00Z", totalWorkedSeconds: 3600 },
  ]);
  t.mock.method(TaskTimeLog, "find", () => logsQuery);
  t.mock.method(Task, "find", () => query([{ _id: "task", taskName: "Shared work", taskType: "work" }]));
  t.mock.method(Project, "find", () => query([{ _id: "shared", projectName: "Shared project", clients: ["client-a", "deleted-client"] }]));
  t.mock.method(Client, "find", (filter) => {
    assert.deepEqual(new Set(filter._id.$in), new Set(["client-a", "deleted-client"]));
    return query([{ _id: "client-a", clientName: "Recorded client" }]);
  });
  const res = response();
  await getBillingReport({ user: { role: "admin" }, query: { employee: employeeId, startDate: "2026-10-01", endDate: "2026-10-01" } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(logsQuery.fields.split(" ").includes("client"));
  assert.deepEqual(new Set(res.body.report.projects.map((project) => project.clientName)), new Set(["Recorded client", "Unassigned client"]));
  assert.equal(res.body.report.summary.taskSeconds, 7200);
  assert.equal(res.body.report.summary.totalBillableAmount, 50);
});

function approvalFixture(t, { expired = false, tokenVersion = 3 } = {}) {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "audit-regression-test-secret-only";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  const oldHash = hashSecret("old-remembered-token");
  const employee = {
    _id: "employee", email: "audit@example.invalid", role: "employee", isActive: true,
    tokenVersion, rememberedSessions: [{ tokenHash: oldHash, expiresAt: new Date(Date.now() + 60_000) }],
    comparePassword: async () => true, save: async () => {},
  };
  const session = { _id: "session", sessionId: "session-id", deviceId: "device", status: "active", expiresAt: new Date(Date.now() + 60_000) };
  const stored = {
    _id: "request", requestId: "request-id", requestTokenHash: hashSecret("request-secret"),
    status: "approved", employee: employee._id, requestedSession: session._id,
    tokenVersion: 3, rememberedTokenHash: oldHash,
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)),
  };
  t.mock.method(Employee, "findById", () => ({ select: async () => employee }));
  t.mock.method(AuthSession, "findOne", async () => session.status === "active" ? session : null);
  t.mock.method(AuthSession, "updateMany", async () => ({ modifiedCount: 0 }));
  t.mock.method(AuthSession, "updateOne", async (_filter, update) => Object.assign(session, update.$set));
  t.mock.method(DeviceLoginRequest, "findOne", (filter) => ({ select: async () => {
    if (filter.requestId !== stored.requestId || filter.requestTokenHash !== stored.requestTokenHash) return null;
    const snapshot = { ...stored };
    snapshot.save = async () => Object.assign(stored, snapshot);
    return snapshot;
  } }));
  t.mock.method(DeviceLoginRequest, "findOneAndUpdate", async (filter, update) => {
    if (filter.status.$in) {
      if (!filter.status.$in.includes(stored.status) || stored.expiresAt > filter.expiresAt.$lte) return null;
    } else if (stored.status !== filter.status || stored.requestTokenHash !== filter.requestTokenHash
        || stored.expiresAt <= filter.expiresAt.$gt) return null;
    Object.assign(stored, update.$set);
    return { ...stored };
  });
  t.mock.method(DeviceLoginRequest, "updateMany", async (filter, update) => {
    if (filter.status.$in.includes(stored.status)) Object.assign(stored, update.$set);
    return { modifiedCount: 1 };
  });
  const exchange = async () => {
    const res = response();
    await waitForLoginRequest({ params: { requestId: stored.requestId }, body: { requestToken: "request-secret" } }, res);
    return res;
  };
  return { stored, employee, session, oldHash, exchange };
}

test("concurrent approval exchanges issue credentials once and rotate the remembered token", async (t) => {
  const { stored, employee, oldHash, exchange } = approvalFixture(t);
  const results = await Promise.all([exchange(), exchange()]);
  assert.equal(results.filter((result) => result.statusCode === 200).length, 1);
  assert.equal(results.filter((result) => result.body.token).length, 1);
  assert.equal(stored.status, "consumed");
  assert.equal(employee.rememberedSessions.some((item) => item.tokenHash === oldHash), false);
  assert.equal(employee.rememberedSessions.length, 1);
  assert.equal((await exchange()).body.token, undefined);
});

test("expired approvals never issue credentials or revive a device session", async (t) => {
  const { session, exchange } = approvalFixture(t, { expired: true });
  const result = await exchange();
  assert.equal(result.statusCode, 410);
  assert.equal(result.body.token, undefined);
  assert.equal(session.status, "expired");
});

test("a stale expiry waiter cannot revoke an already consumed approval", async (t) => {
  const { stored, session, exchange } = approvalFixture(t, { expired: true });
  const update = DeviceLoginRequest.findOneAndUpdate;
  t.mock.method(DeviceLoginRequest, "findOneAndUpdate", async (filter, mutation, options) => {
    // Another waiter consumed the approval after this waiter's initial read.
    stored.status = "consumed";
    return update(filter, mutation, options);
  });
  assert.equal((await exchange()).body.token, undefined);
  assert.equal(stored.status, "consumed");
  assert.equal(session.status, "active");
});

test("approval from an older password version cannot mint a current token", async (t) => {
  const { exchange } = approvalFixture(t, { tokenVersion: 4 });
  const result = await exchange();
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.token, undefined);
});

test("password change cancels an unconsumed approval while preserving the acting session", async (t) => {
  const { employee, session, stored, exchange } = approvalFixture(t);
  const res = response();
  await changePassword({ user: { _id: employee._id }, authSession: session,
    body: { currentPassword: "old-password", newPassword: "new-test-password" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(jwt.decode(res.body.token).tokenVersion, 4);
  assert.equal(stored.status, "cancelled");
  assert.equal(session.status, "active");
  assert.equal((await exchange()).body.token, undefined);
});

test("timer start rejects another team's project and retains own-team and legacy access", async (t) => {
  let created = 0;
  let projectTeams = ["other-team"];
  t.mock.method(Project, "findById", async () => ({ status: "Active", teams: projectTeams }));
  t.mock.method(Team, "exists", async () => ({ _id: "own-team" }));
  t.mock.method(Task, "findOne", async () => ({ project: null, taskType: "work" }));
  t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));
  t.mock.method(TaskTimeLog, "findOne", async () => null);
  t.mock.method(TaskTimeLog, "create", async (values) => { created += 1; return { ...values, populate: async () => {} }; });
  const req = { user: { _id: "employee", role: "employee", team: "own-team" }, body: { project: "project", task: "task" } };
  const denied = response();
  await startTimer(req, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(created, 0);
  for (const teams of [["own-team"], []]) {
    projectTeams = teams;
    const allowed = response();
    await startTimer(req, allowed);
    assert.equal(allowed.statusCode, 201);
  }
  assert.equal(created, 2);
});

test("HR and delegated lookup access does not grant employee or team mutations", () => {
  const guard = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack[1].handle;
  const options = guard(employeeRoutes, "/options", "get");
  const teams = guard(teamRoutes, "/", "get");
  for (const user of [{ role: "hr" }, { role: "employee", permissions: ["create_employees"] }, { role: "team_lead", permissions: ["edit_employees"] }]) {
    for (const middleware of [options, teams]) {
      let allowed = false;
      middleware({ user }, response(), () => { allowed = true; });
      assert.equal(allowed, true);
    }
    for (const middleware of [guard(employeeRoutes, "/:id/reset-password", "put"), guard(teamRoutes, "/", "post")]) {
      if (user.role === "hr" && middleware === guard(teamRoutes, "/", "post")) continue;
      const res = response();
      middleware({ user }, res, () => assert.fail("Mutation was unexpectedly authorized"));
      assert.equal(res.statusCode, 403);
    }
  }
  const denied = response();
  options({ user: { role: "employee", permissions: [] } }, denied, () => assert.fail("Undelegated employee obtained all employee options"));
  assert.equal(denied.statusCode, 403);
});

test("operational employee options paginate and exclude account/security/rate fields", async (t) => {
  let selection;
  let skip;
  const query = { select(value) { selection = value; return this; }, populate() { return this; },
    sort() { return this; }, skip(value) { skip = value; return this; }, limit: async () => [{ _id: "employee-101", fullName: "Employee 101" }] };
  t.mock.method(Employee, "countDocuments", async () => 101);
  t.mock.method(Employee, "find", () => query);
  const res = response();
  await getEmployeeOptions({ query: { page: "2", limit: "100" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalPages, 2);
  assert.equal(skip, 100);
  assert.equal(res.body.employees[0]._id, "employee-101");
  assert.doesNotMatch(selection, /password|token|permissions|projectRates|address/i);
});
