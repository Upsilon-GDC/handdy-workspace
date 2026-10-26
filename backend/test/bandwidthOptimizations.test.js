const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const mongoose = require("mongoose");
const AuthSession = require("../src/models/AuthSession");
const DeviceLoginRequest = require("../src/models/DeviceLoginRequest");
const Employee = require("../src/models/Employee");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const Client = require("../src/models/Client");
const Team = require("../src/models/Team");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const Attendance = require("../src/models/Attendance");
const SystemSettings = require("../src/models/SystemSettings");
const { getPendingLoginRequest, getProfile } = require("../src/modules/auth/authController");
const { getIdlePolicy, updateIdlePolicy } = require("../src/modules/settings/settingsController");
const { getMyTimeLogs } = require("../src/modules/timers/taskTimeLogController");
const { getAttendanceHistory } = require("../src/modules/attendance/attendanceController");
const { closeStaleDesktopTimers } = require("../src/services/desktopTimerLease");
const { createLoginWaiter, notify, subscribe } = require("../src/services/loginNotifications");
const { beginReportSync, changedTimeLogFilter } = require("../src/services/reportSync");
const { dependencyRevision, invalidate, readRevisionPlugin } = require("../src/services/readRevisions");
const catalogCache = require("../src/middleware/catalogCache");

const flush = () => new Promise((resolve) => setImmediate(resolve));
function response() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    headers: {},
    set(name, value) { Object.assign(this.headers, typeof name === "string" ? { [name]: value } : name); return this; },
    end() { this.ended = true; return this; },
  });
}
function query(rows) {
  return { populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
    lean: async () => rows, then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) };
}
const revisionQuery = (rows) => ({ hint: () => Promise.resolve(rows) });
function revisions(t, models = [Project, Task, Client, Employee, Team]) {
  for (const Model of models) {
    invalidate(Model.modelName);
    t.mock.method(Model, "aggregate", () => revisionQuery([{ count: 1, latest: new Date("2026-10-01"), total: 1 }]));
  }
}
// Sets an optimization switch (config/optimizations.js) for one test.
const withEnv = (t, name, value) => {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
};
const withMarker = (base, sync) => ({ ...base, sync: "true", syncSince: sync.since, syncScope: sync.scope, syncReferences: sync.references });

test("login waiter preserves a notification during a read and removes disconnect listeners", async () => {
  const req = new EventEmitter();
  const res = response();
  const waiter = createLoginWaiter(req, res, ["waiter-test"]);
  notify(["waiter-test"]);
  await waiter.wait(5000);
  const pending = waiter.wait(5000);
  req.emit("aborted");
  await pending;
  assert.equal(waiter.closed, true);
  waiter.dispose();
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(res.listenerCount("close"), 0);
});

test("with OPT_LONGPOLL_EVENTS=false, idle approval monitors read every five seconds, wake on revocation, and stop on disconnect", async (t) => {
  withEnv(t, "OPT_LONGPOLL_EVENTS", "false");
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  let reads = 0;
  let active = true;
  t.mock.method(AuthSession, "findOne", async () => { reads += 1; return active ? { _id: "monitor", employee: "person", clientType: "web" } : null; });
  const requests = t.mock.method(DeviceLoginRequest, "findOne", () => { throw new Error("Browser must not query desktop requests"); });
  const req = Object.assign(new EventEmitter(), { authSession: { _id: "monitor", employee: "person" } });
  const res = response();
  const pending = getPendingLoginRequest(req, res);
  await flush();
  t.mock.timers.tick(4999);
  await flush();
  assert.equal(reads, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(reads, 2);
  active = false;
  notify(["session:monitor"]);
  await pending;
  assert.equal(reads, 3);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "SESSION_REVOKED");
  assert.equal(requests.mock.callCount(), 0);
  active = true;
  const disconnected = getPendingLoginRequest(req, response());
  await flush();
  const before = reads;
  req.emit("aborted");
  await disconnected;
  t.mock.timers.tick(20000);
  await flush();
  assert.equal(reads, before);
  assert.equal(req.listenerCount("aborted"), 0);
});

test("an idle monitor returns the original empty result at the twenty-second deadline", async (t) => {
  withEnv(t, "OPT_LONGPOLL_EVENTS", "false");
  for (const [setting, expectedReads] of [["false", 4], ["true", 1]]) {
    process.env.OPT_LONGPOLL_EVENTS = setting;
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    const reads = t.mock.method(AuthSession, "findOne", async () => ({ clientType: "web" }));
    const req = Object.assign(new EventEmitter(), { authSession: { _id: "deadline", employee: "person" } });
    const res = response();
    const pending = getPendingLoginRequest(req, res);
    await flush();
    for (let i = 0; i < 4; i += 1) { t.mock.timers.tick(5000); await flush(); }
    await pending;
    assert.deepEqual(res.body, { success: true, loginRequest: null });
    assert.equal(reads.mock.callCount(), expectedReads, `OPT_LONGPOLL_EVENTS=${setting}`);
    reads.mock.restore();
    t.mock.timers.reset();
  }
});

test("by default an idle approval monitor reads MongoDB once, then only when woken by a change", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  let reads = 0;
  let active = true;
  let request = null;
  t.mock.method(AuthSession, "findOne", async () => { reads += 1; return active ? { _id: "quiet", employee: "person", clientType: "desktop" } : null; });
  t.mock.method(DeviceLoginRequest, "findOne", () => ({ sort: async () => request }));
  const req = Object.assign(new EventEmitter(), { authSession: { _id: "quiet", employee: "person" } });

  // Nothing changes: one read at the start, none while waiting.
  const res = response();
  const pending = getPendingLoginRequest(req, res);
  await flush();
  for (let i = 0; i < 3; i += 1) { t.mock.timers.tick(5000); await flush(); }
  assert.equal(reads, 1);
  // A new sign-in request on this server wakes it immediately.
  request = { requestId: "woken", deviceName: "PC 2", clientType: "desktop" };
  notify(["employee:person"]);
  await pending;
  assert.equal(reads, 2);
  assert.equal(res.body.loginRequest.deviceName, "PC 2");

  // A revocation also wakes it at once.
  request = null;
  const revoked = response();
  const second = getPendingLoginRequest(req, revoked);
  await flush();
  active = false;
  notify(["session:quiet"]);
  await second;
  assert.equal(revoked.statusCode, 401);
  assert.equal(reads, 4);
});

test("Mongoose notifications wake desktop monitors for requests and revocations, excluding activity writes", async () => {
  const employee = new mongoose.Types.ObjectId();
  const session = new mongoose.Types.ObjectId();
  let signals = 0;
  const unsubscribe = subscribe([`employee:${employee}`, `session:${session}`, "request:notify-fixture"], () => { signals += 1; });
  try {
    const request = new DeviceLoginRequest({ requestId: "notify-fixture", employee, existingSession: session, status: "pending" });
    await DeviceLoginRequest.schema.s.hooks.execPost("save", request, [request]);
    assert.equal(signals, 1);
    request.status = "approving";
    await DeviceLoginRequest.schema.s.hooks.execPost("save", request, [request]);
    assert.equal(signals, 1);
    const activity = AuthSession.updateOne({ _id: session }, { $set: { lastActivity: new Date() } });
    await AuthSession.schema.s.hooks.execPost("updateOne", activity, [{ modifiedCount: 1 }]);
    assert.equal(signals, 1);
    const revoke = AuthSession.updateMany({ employee }, { $set: { status: "revoked" } });
    await AuthSession.schema.s.hooks.execPost("updateMany", revoke, [{ modifiedCount: 1 }]);
    assert.equal(signals, 2);
  } finally { unsubscribe(); }
});

test("desktop approval monitor wakes immediately for a new request and rechecks the database", async (t) => {
  let request = null;
  t.mock.method(AuthSession, "findOne", async () => ({ _id: "new-request-session", employee: "person", clientType: "desktop" }));
  const reads = t.mock.method(DeviceLoginRequest, "findOne", () => ({ sort: async () => request }));
  const req = Object.assign(new EventEmitter(), { authSession: { _id: "new-request-session", employee: "person" } });
  const res = response();
  const pending = getPendingLoginRequest(req, res);
  await flush();
  assert.equal(res.body, undefined);
  request = { requestId: "new-request", deviceName: "PC 2", clientType: "desktop" };
  notify(["session:new-request-session"]);
  await pending;
  assert.equal(res.body.loginRequest.deviceName, "PC 2");
  assert.equal(res.body.token, undefined);
  assert.equal(reads.mock.callCount(), 2);
});

test("profile reuses the authenticated employee and still omits secrets", async (t) => {
  const reads = t.mock.method(Employee, "findById", () => { throw new Error("duplicate query"); });
  const res = response();
  await getProfile({ user: { _id: "employee", fullName: "Employee", password: "hidden", tokenVersion: 9, rememberedSessions: ["hidden"], role: "employee", idleTrackingExempt: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.fullName, "Employee");
  for (const field of ["password", "tokenVersion", "rememberedSessions"]) assert.equal(Object.hasOwn(res.body.user, field), false);
  assert.equal(reads.mock.callCount(), 0);
});

test("settings GET is read-only, shares simultaneous reads, and invalidates after admin save", async (t) => {
  let saved = null;
  const reads = t.mock.method(SystemSettings, "findOne", async () => saved);
  const writes = t.mock.method(SystemSettings, "findOneAndUpdate", async (_filter, update) => { saved = update.$set; return saved; });
  const first = response();
  const second = response();
  await Promise.all([getIdlePolicy({ user: {} }, first), getIdlePolicy({ user: {} }, second)]);
  assert.equal(reads.mock.callCount(), 1);
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(first.body.idlePolicy.idleThresholdMinutes, 5);
  assert.equal(first.body.idlePolicy.autoLogoutMinutes, 50);
  await updateIdlePolicy({ body: { idleThresholdMinutes: 10, autoLogoutMinutes: 30 } }, response());
  const after = response();
  await getIdlePolicy({ user: { idlePolicyOverride: { idleThresholdMinutes: 3, autoLogoutMinutes: 15 } } }, after);
  assert.equal(writes.mock.callCount(), 1);
  assert.equal(reads.mock.callCount(), 2);
  assert.equal(after.body.idlePolicy.source, "employee_override");
  assert.equal(after.body.idlePolicy.autoLogoutMinutes, 15);
  const global = response();
  await getIdlePolicy({ user: {} }, global);
  assert.equal(global.body.idlePolicy.autoLogoutMinutes, 30);
});

test("identical pending lease sweeps share a query; later checks and failures are not cached", async (t) => {
  let resolve;
  let failed = false;
  const reads = t.mock.method(TaskTimeLog, "find", () => ({ lean: () => failed ? Promise.reject(new Error("unavailable")) : new Promise((done) => { resolve = done; }) }));
  const now = new Date();
  const first = closeStaleDesktopTimers(now, "coalescing");
  const second = closeStaleDesktopTimers(now, "coalescing");
  assert.equal(first, second);
  resolve([]);
  assert.deepEqual(await Promise.all([first, second]), [0, 0]);
  assert.equal(reads.mock.callCount(), 1);
  const later = closeStaleDesktopTimers(new Date(now.getTime() + 1), "coalescing");
  resolve([]);
  await later;
  assert.equal(reads.mock.callCount(), 2);
  failed = true;
  await assert.rejects(closeStaleDesktopTimers(now, "coalescing"), /unavailable/);
  failed = false;
  const retry = closeStaleDesktopTimers(now, "coalescing");
  resolve([]);
  await retry;
  assert.equal(reads.mock.callCount(), 4);
});

test("revision hooks invalidate caches for actual Mongoose document, query and model contexts", async (t) => {
  const schema = new mongoose.Schema({ name: String });
  schema.plugin(readRevisionPlugin);
  const Model = mongoose.model("BandwidthRevisionFixture", schema);
  const reads = t.mock.method(Model, "aggregate", () => revisionQuery([{ count: 1, total: 1 }]));
  let revision = await dependencyRevision([Model]);
  await dependencyRevision([Model]);
  assert.equal(reads.mock.callCount(), 1);
  for (const operation of ["save", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany", "insertMany", "bulkWrite"]) {
    const context = operation === "save" ? new Model({ name: "changed" })
      : ["insertMany", "bulkWrite"].includes(operation) ? Model : Model.find({ name: "changed" });
    await schema.s.hooks.execPost(operation, context, [{}]);
    const next = await dependencyRevision([Model]);
    assert.notEqual(next, revision, operation);
    revision = next;
  }
  assert.equal(reads.mock.callCount(), 8);
});

test("revision checks use the timestamp index and share an outstanding metadata read", async (t) => {
  const schema = new mongoose.Schema({ name: String }, { timestamps: true });
  schema.plugin(readRevisionPlugin);
  assert.ok(schema.indexes().some(([keys]) => keys.updatedAt === 1 && Object.keys(keys).length === 1));
  const Model = mongoose.model("IndexedRevisionFixture", schema);
  let resolve;
  const reads = t.mock.method(Model, "aggregate", () => ({
    hint(index) {
      assert.deepEqual(index, { updatedAt: 1 });
      return new Promise((done) => { resolve = done; });
    },
  }));
  const one = dependencyRevision([Model]);
  const two = dependencyRevision([Model]);
  assert.equal(reads.mock.callCount(), 1);
  resolve([{ count: 2, latest: new Date("2026-10-09"), total: 2 }]);
  assert.equal(await one, await two);
  await dependencyRevision([Model]);
  assert.equal(reads.mock.callCount(), 1);
});

test("catalog cache isolates employees and immediately reloads when assignments change", async (t) => {
  revisions(t, [Task]);
  const middleware = catalogCache([Task]);
  const req = { baseUrl: "/catalog-test", path: "/", query: {}, user: { _id: "person-a", role: "employee", team: "team" } };
  let loads = 0;
  async function load(request) {
    const res = response();
    await middleware(request, res, () => { loads += 1; res.json({ success: true, tasks: [{ _id: "task", assigned: request.user._id }] }); });
    return res.body;
  }
  await load(req);
  const cached = await load(req);
  assert.equal(loads, 1);
  cached.tasks[0].assigned = "tampered";
  assert.equal((await load(req)).tasks[0].assigned, "person-a");
  const other = await load({ ...req, user: { ...req.user, _id: "person-b" } });
  assert.equal(other.tasks[0].assigned, "person-b");
  invalidate("Task");
  await load(req);
  assert.equal(loads, 3);
  invalidate("Task");
  t.mock.method(Task, "aggregate", () => ({ hint() { throw new Error("revision unavailable"); } }));
  assert.equal((await load(req)).success, true);
  assert.equal(loads, 4);
});

test("report sync rejects changed scopes, renamed/deleted dependencies and old watermarks", async (t) => {
  revisions(t, [Task]);
  const filter = { employee: "person" };
  const req = { user: { _id: "person", role: "employee" }, query: { sync: "true" } };
  const initial = await beginReportSync(req, filter, [Task]);
  const next = { ...req, query: withMarker({}, initial.marker) };
  assert.equal((await beginReportSync(next, filter, [Task])).delta, true);
  assert.equal((await beginReportSync(next, { employee: "other" }, [Task])).delta, false);
  assert.equal((await beginReportSync({ ...next, user: { _id: "other", role: "employee" } }, filter, [Task])).delta, false);
  assert.equal((await beginReportSync({ ...next, query: { ...next.query, syncSince: new Date(Date.now() - 6 * 60000).toISOString() } }, filter, [Task])).delta, false);
  invalidate("Task");
  assert.equal((await beginReportSync(next, filter, [Task])).delta, false);
  t.mock.method(Task, "aggregate", () => ({ hint() { throw new Error("metadata error"); } }));
  invalidate("Task");
  assert.equal(await beginReportSync(next, filter, [Task]), null);
  assert.equal(await beginReportSync({ ...req, query: {} }, filter, [Task]), null);
});

test("time-log delta retains employee/project/task scope and includes unchanged active timers", () => {
  const previous = new Date();
  const filter = changedTimeLogFilter({ employee: "person", project: "project", task: "task", status: "running", startedAt: { $lt: previous }, $or: ["date-overlap"] }, previous);
  assert.equal(filter.employee, "person");
  assert.equal(filter.project, "project");
  assert.equal(filter.task, "task");
  assert.equal(filter.status, undefined);
  assert.deepEqual(filter.$or[1], { status: { $in: ["running", "paused"] } });
  assert.equal(filter.$or[0].updatedAt.$gte.getTime(), previous.getTime() - 1000);
});

test("personal report deltas remove deleted manual entries and outside rows, and fall back for large batches", async (t) => {
  revisions(t);
  let delta = false;
  let large = false;
  const base = { _id: "work", employee: "person", status: "stopped", startedAt: new Date("2026-09-22T04:30Z"), stoppedAt: new Date("2026-09-22T05:30Z"), pauses: [] };
  const counts = t.mock.method(TaskTimeLog, "countDocuments", async () => 1);
  t.mock.method(TaskTimeLog, "find", (filter) => {
    assert.equal(filter.employee, "person");
    if (filter.desktopHeartbeatAt) return query([]);
    delta = Boolean(filter.$or?.[0]?.updatedAt);
    if (!delta) {
      assert.equal(filter["manualEntry.deletedAt"], null);
      return query([base]);
    }
    assert.equal(Object.hasOwn(filter, "manualEntry.deletedAt"), false, "delta reads include deletion audit records");
    if (large) return query(Array.from({ length: 101 }, (_, i) => ({ ...base, _id: String(i) })));
    return query([{ ...base, stoppedAt: new Date("2026-09-22T06:30Z") },
      { ...base, _id: "deleted-manual", entrySource: "manual", manualEntry: { deletedAt: new Date() } },
      { ...base, _id: "outside", startedAt: new Date("2026-09-21T04:30Z"), stoppedAt: new Date("2026-09-21T05:30Z") }]);
  });
  const user = { _id: "person", role: "employee" };
  const params = { startDate: "2026-09-22", endDate: "2026-09-22", sync: "true" };
  const first = response();
  await getMyTimeLogs({ user, query: params }, first);
  assert.equal(first.body.timeLogs[0].totalWorkedSeconds, 3600);
  const second = response();
  await getMyTimeLogs({ user, query: withMarker(params, first.body.sync) }, second);
  assert.equal(second.body.delta, true);
  assert.equal(second.body.timeLogs[0].totalWorkedSeconds, 7200);
  assert.deepEqual(second.body.removedIds, ["deleted-manual", "outside"]);
  assert.equal(counts.mock.callCount(), 1);
  large = true;
  const fallback = response();
  await getMyTimeLogs({ user, query: withMarker(params, second.body.sync) }, fallback);
  assert.equal(fallback.body.delta, undefined);
  assert.equal(counts.mock.callCount(), 2);
  const legacy = response();
  await getMyTimeLogs({ user, query: {} }, legacy);
  assert.equal(legacy.body.sync, undefined);
  assert.equal(legacy.body.delta, undefined);
});

test("attendance delta returns checkout changes without repeating count or history queries", async (t) => {
  revisions(t, [Employee]);
  const record = { _id: "attendance", employee: "person", date: "2026-10-01", checkOut: null };
  const counts = t.mock.method(Attendance, "countDocuments", async () => 1);
  t.mock.method(Attendance, "find", (filter) => {
    assert.equal(filter.employee, "person");
    return query([{ ...record, checkOut: filter.updatedAt ? new Date("2026-10-01T12:00Z") : null }]);
  });
  const user = { _id: "person", role: "employee" };
  const first = response();
  await getAttendanceHistory({ user, query: { sync: "true" } }, first);
  const second = response();
  await getAttendanceHistory({ user, query: withMarker({}, first.body.sync) }, second);
  assert.equal(second.body.delta, true);
  assert.ok(second.body.attendance[0].checkOut);
  assert.equal(counts.mock.callCount(), 1);
});

test("catalog lists answer 304 for an unchanged list and a full 200 after any change", async (t) => {
  revisions(t, [Task]);
  const middleware = catalogCache([Task]);
  const base = { baseUrl: "/etag-test", path: "/", query: {}, headers: {}, user: { _id: "person-a", role: "employee", team: "team" } };
  let loads = 0;
  async function call(request) {
    const res = response();
    await middleware(request, res, () => { loads += 1; res.json({ success: true, tasks: [{ _id: "task" }] }); });
    return res;
  }
  const first = await call(base);
  assert.equal(first.statusCode, 200);
  const etag = first.headers.ETag;
  assert.match(etag, /^"[0-9a-f]{64}-\d+"$/);
  assert.equal(first.headers["Cache-Control"], "private, no-cache");

  const unchanged = await call({ ...base, headers: { "if-none-match": etag } });
  assert.equal(unchanged.statusCode, 304);
  assert.equal(unchanged.ended, true);
  assert.equal(unchanged.body, undefined);
  assert.equal(loads, 1, "a 304 must not run the route handler");

  const otherUser = await call({ ...base, headers: { "if-none-match": etag }, user: { ...base.user, _id: "person-b" } });
  assert.equal(otherUser.statusCode, 200, "another employee's ETag never matches");

  invalidate("Task");
  t.mock.method(Task, "aggregate", () => revisionQuery([{ count: 2, latest: new Date("2026-10-10"), total: 2 }]));
  const changed = await call({ ...base, headers: { "if-none-match": etag } });
  assert.equal(changed.statusCode, 200, "a changed revision forces a full response");
  assert.notEqual(changed.headers.ETag, etag);
});

// Phase 2 (2.2): report fingerprint for delta copies.
test("the report fingerprint groups settled rows and lists active timers, dropping zero-length sessions only with a range", async (t) => {
  const { reportChecksum } = require("../src/services/reportSync");
  const pipelines = [];
  t.mock.method(TaskTimeLog, "aggregate", async (pipeline) => {
    pipelines.push(pipeline);
    return [
      { _id: false, count: 3, seconds: 5_000_000_001, activeIds: [] },
      { _id: true, count: 1, seconds: 42, activeIds: [new mongoose.Types.ObjectId("64b000000000000000000001")] },
    ];
  });
  const filter = { employee: "person", "manualEntry.deletedAt": null };
  const ranged = await reportChecksum(TaskTimeLog, filter, { timeLogs: true, dropZeroLength: true });
  assert.deepEqual(ranged, { count: 3, seconds: 5_000_000_001, activeIds: ["64b000000000000000000001"] });
  assert.deepEqual(pipelines[0][0].$match.$and[0], filter);
  assert.ok(pipelines[0][0].$match.$and[1].$expr, "zero-length sessions are left out like clipTimeLogToRange does");
  await reportChecksum(TaskTimeLog, filter, { timeLogs: true });
  assert.deepEqual(pipelines[1][0].$match, filter, "without a range every row counts");
  t.mock.method(Attendance, "aggregate", async () => []);
  assert.deepEqual(await reportChecksum(Attendance, { employee: "person" }), { count: 0, seconds: 0 });
});

test("report deltas carry the fingerprint only when the client asks and the switch is on", async (t) => {
  revisions(t);
  const base = { _id: "work", employee: "person", status: "stopped", startedAt: new Date("2026-09-22T04:30Z"), stoppedAt: new Date("2026-09-22T05:30Z"), pauses: [] };
  t.mock.method(TaskTimeLog, "countDocuments", async () => 1);
  t.mock.method(TaskTimeLog, "find", (filter) => (filter.desktopHeartbeatAt ? query([]) : query([base])));
  const aggregates = t.mock.method(TaskTimeLog, "aggregate", async () => [{ _id: false, count: 1, seconds: 7, activeIds: [] }]);
  const user = { _id: "person", role: "employee" };
  const params = { startDate: "2026-09-22", endDate: "2026-09-22", sync: "true" };
  const first = response();
  await getMyTimeLogs({ user, query: { ...params, checksum: "true" } }, first);
  assert.equal(first.body.checksum, undefined, "a complete reply needs no fingerprint");
  assert.equal(aggregates.mock.callCount(), 0);

  const asked = response();
  await getMyTimeLogs({ user, query: { ...withMarker(params, first.body.sync), checksum: "true" } }, asked);
  assert.equal(asked.body.delta, true);
  assert.deepEqual(asked.body.checksum, { count: 1, seconds: 7, activeIds: [] });

  const notAsked = response();
  await getMyTimeLogs({ user, query: withMarker(params, asked.body.sync) }, notAsked);
  assert.equal(notAsked.body.checksum, undefined, "desktops and older dashboards do not trigger the extra query");

  withEnv(t, "OPT_REPORT_CHECKSUM", "false");
  const off = response();
  await getMyTimeLogs({ user, query: { ...withMarker(params, notAsked.body.sync), checksum: "true" } }, off);
  assert.equal(off.body.checksum, undefined);
  assert.equal(aggregates.mock.callCount(), 1);
});
