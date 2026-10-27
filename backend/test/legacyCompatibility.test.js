const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const Attendance = require("../src/models/Attendance");
const Employee = require("../src/models/Employee");
const AuthSession = require("../src/models/AuthSession");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const Team = require("../src/models/Team");
const Client = require("../src/models/Client");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const attendance = require("../src/modules/attendance/attendanceController");
const timers = require("../src/modules/timers/taskTimeLogController");
const { protect } = require("../src/middleware/authMiddleware");
const { clearAuthCache } = require("../src/services/authCache");
const { authorizeRoles } = require("../src/middleware/authorizeRoles");

const query = (value) => ({ select() { return this; }, sort() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers = { ...this.headers, [name]: value }; },
  json(body) { this.body = body; return this; } });
const user = { _id: "legacy-employee", team: "team", role: "employee", isActive: true, tokenVersion: 0 };
async function call(handler, body = {}) {
  const res = response();
  await handler({ user, body, query: {} }, res);
  return res;
}

test("legacy attendance check-in and checkout keep the same record and response contract", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 9, 4, 0) });
  let record;
  let inserts = 0;
  t.mock.method(Attendance, "findOne", () => query(record && !record.checkOut ? record : null));
  t.mock.method(Attendance, "create", async (data) => {
    inserts += 1;
    record = { _id: "attendance", ...data, save: async () => {} };
    return record;
  });
  const checkedIn = await call(attendance.checkIn);
  assert.equal(checkedIn.statusCode, 201);
  assert.equal(checkedIn.body.attendance._id, "attendance");
  t.mock.timers.tick(3_600_000);
  const checkedOut = await call(attendance.checkOut);
  assert.equal(checkedOut.statusCode, 200);
  assert.equal(checkedOut.body.attendance._id, "attendance");
  assert.equal(record.totalHours, 1);
  assert.equal(inserts, 1);
});

test("legacy timer start, manual pause, resume and stop preserve work and break history", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 9, 4, 0) });
  let timer;
  let inserts = 0;
  t.mock.method(Project, "findById", async () => ({ _id: "project", status: "Active", teams: ["team"] }));
  t.mock.method(Team, "exists", async () => true);
  t.mock.method(Client, "exists", async () => true);
  t.mock.method(Task, "findOne", async () => ({ _id: "task", isActive: true }));
  t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));
  t.mock.method(TaskTimeLog, "findOne", (filter) => query(timer && (
    typeof filter.status === "string" ? timer.status === filter.status : filter.status.$in.includes(timer.status)
  ) ? timer : null));
  t.mock.method(TaskTimeLog, "create", async (data) => {
    inserts += 1;
    timer = { _id: "timer", ...data, pauses: [], populate: async () => {}, save: async () => {} };
    return timer;
  });
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.employee, user._id);
    if (!timer || timer.status !== filter.status) return null;
    // Stop: one conditional update with every final value.
    if (update.$set.stoppedAt) return Object.assign(timer, update.$set);
    if (update.$push) timer.pauses.push(update.$push.pauses);
    if (update.$set["pauses.$[elem].resumedAt"]) timer.pauses.at(-1).resumedAt = update.$set["pauses.$[elem].resumedAt"];
    timer.status = update.$set.status;
    return timer;
  });
  assert.equal((await call(timers.startTimer, { project: "project", client: "client", task: "task" })).statusCode, 201);
  t.mock.timers.tick(60_000);
  assert.equal((await call(timers.pauseTimer)).statusCode, 200);
  assert.equal(timer.pauses[0].reason, "manual");
  t.mock.timers.tick(20_000);
  assert.equal((await call(timers.resumeTimer)).statusCode, 200);
  t.mock.timers.tick(30_000);
  const stopped = await call(timers.stopTimer);
  assert.equal(stopped.statusCode, 200);
  assert.equal(stopped.body.timeLog._id, "timer");
  assert.equal(timer.totalWorkedSeconds, 90);
  assert.equal(timer.totalPausedSeconds, 20);
  assert.equal(timer.status, "stopped");
  assert.equal(timer.isActiveTimer, false);
  assert.equal(inserts, 1);
});

test("existing session authentication rejects revoked sessions and unauthorized report roles", async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-legacy-protocol-test-secret";
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  t.mock.method(Employee, "findById", () => query(user));
  let active = true;
  t.mock.method(AuthSession, "findOne", async () => active ? { _id: "session", lastActivity: new Date() } : null);
  const token = jwt.sign({ employeeId: user._id, tokenVersion: 0, sessionId: "session", deviceId: "device" }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  let authenticated = false;
  await protect(req, response(), () => { authenticated = true; });
  assert.equal(authenticated, true);
  const forbidden = response();
  authorizeRoles("admin", "manager", "hr")(req, forbidden, () => assert.fail("employee must not receive admin reports"));
  assert.equal(forbidden.statusCode, 403);
  active = false;
  clearAuthCache(); // a real revocation is a write, which clears the cache
  const revoked = response();
  await protect(req, revoked, () => assert.fail("revoked session must not authenticate"));
  assert.equal(revoked.statusCode, 401);
  assert.equal(revoked.body.code, "SESSION_REVOKED");
});

test("desktop heartbeat reads only the timer ID and preserves its legacy acknowledgement", async (t) => {
  t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (_filter, update, options) => {
    assert.ok(update.$set.desktopHeartbeatAt instanceof Date);
    assert.deepEqual(options.projection, { _id: 1 });
    assert.equal(options.returnDocument, "after");
    return { _id: "timer" };
  });
  const acknowledgement = await call(timers.heartbeatTimer);
  assert.equal(acknowledgement.statusCode, 200);
  assert.deepEqual(acknowledgement.body, { success: true, timeLogId: "timer" });
});
