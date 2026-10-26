// Phase 3 (docs/CRM_OPTIMIZATION_PHASE_PLAN.md): retries, races and restarts
// must never count time twice, stop the wrong timer or reopen a stopped one.
const test = require("node:test");
const assert = require("node:assert/strict");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const Team = require("../src/models/Team");
const Client = require("../src/models/Client");
const { startTimer, stopTimer, heartbeatTimer } = require("../src/modules/timers/taskTimeLogController");
const { closeStaleDesktopTimers } = require("../src/services/desktopTimerLease");

const EMPLOYEE = "64b0000000000000000000e1";
const TIMER = "64b0000000000000000000a1";
const OTHER = "64b0000000000000000000a2";
const OP = "op-7f3c2a9e-1111";
const user = { _id: EMPLOYEE, role: "employee", team: "team" };

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const call = async (handler, body = {}) => {
  const res = response();
  await handler({ user, body }, res);
  return res;
};
const running = (extra = {}) => ({
  _id: TIMER, employee: EMPLOYEE, project: "project", client: "client", task: "task",
  status: "running", isActiveTimer: true, startedAt: new Date(Date.now() - 3_600_000), pauses: [], ...extra,
});
const noSweep = (t) => t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));

// ------------------------------------------------------------------ stop
test("stop never overwrites a timer the lease sweep closed first", async (t) => {
  noSweep(t);
  t.mock.method(TaskTimeLog, "findOne", async () => running());
  let predicate;
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (filter) => { predicate = filter; return null; });
  const res = await call(stopTimer);
  assert.equal(res.statusCode, 404, "the sweep's stop at the last heartbeat stands");
  assert.equal(predicate.isActiveTimer, true);
  assert.equal(predicate.status, "running", "only if still exactly as read");
  assert.equal(String(predicate._id), TIMER);
});

test("a repeated stop with the same operation ID returns the first result without a second write", async (t) => {
  noSweep(t);
  const timer = running();
  let writes = 0;
  t.mock.method(TaskTimeLog, "findOne", async (filter) => {
    if (filter.stopOperationId) return timer.stopOperationId === filter.stopOperationId ? timer : null;
    return timer.isActiveTimer ? timer : null;
  });
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (_filter, update) => { writes += 1; return Object.assign(timer, update.$set); });
  const first = await call(stopTimer, { operationId: OP });
  assert.equal(first.statusCode, 200);
  assert.equal(timer.stopOperationId, OP);
  const workedSeconds = timer.totalWorkedSeconds;
  const retry = await call(stopTimer, { operationId: OP });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.replayed, true);
  assert.equal(writes, 1);
  assert.equal(timer.totalWorkedSeconds, workedSeconds, "worked time is unchanged by the retry");
});

test("a stop aimed at one timer never stops a different, newer timer", async (t) => {
  noSweep(t);
  const writes = t.mock.method(TaskTimeLog, "findOneAndUpdate", async () => assert.fail("must not stop the newer timer"));
  t.mock.method(TaskTimeLog, "findOne", async (filter) => (String(filter._id) === OTHER ? running({ _id: OTHER }) : null));
  t.mock.method(TaskTimeLog, "exists", async () => ({ _id: OTHER }));
  const changed = await call(stopTimer, { timeLogId: TIMER });
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.body.code, "TIMER_CHANGED");
  t.mock.method(TaskTimeLog, "exists", async () => null);
  assert.equal((await call(stopTimer, { timeLogId: TIMER })).statusCode, 404, "already stopped and nothing else running");
  assert.equal(writes.mock.callCount(), 0);
});

test("malformed operation or timer IDs are refused before anything changes", async (t) => {
  const reads = t.mock.method(TaskTimeLog, "findOne", async () => assert.fail("no reads"));
  assert.equal((await call(stopTimer, { operationId: "bad id!" })).statusCode, 400);
  assert.equal((await call(stopTimer, { timeLogId: "not-an-id" })).statusCode, 400);
  assert.equal((await call(startTimer, { project: "p", task: "t", operationId: "x" })).statusCode, 400);
  assert.equal(reads.mock.callCount(), 0);
});

test("stop totals close an open pause at the stop time and add reported idle time once", async (t) => {
  noSweep(t);
  const startedAt = new Date(Date.now() - 600_000);
  const paused = running({ status: "paused", startedAt, pauses: [{ pausedAt: new Date(Date.now() - 120_000), resumedAt: null, reason: "break" }] });
  t.mock.method(TaskTimeLog, "findOne", async () => paused);
  let written;
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.status, "paused");
    written = update.$set;
    return { ...paused, ...update.$set };
  });
  const res = await call(stopTimer, { idleSeconds: 300 });
  assert.equal(res.statusCode, 200);
  assert.equal(written.pauses.length, 1, "no idle pause is added to a paused timer");
  assert.ok(written.pauses[0].resumedAt instanceof Date);
  assert.ok(Math.abs(written.totalPausedSeconds - 120) <= 1);
  assert.ok(Math.abs(written.totalWorkedSeconds - 480) <= 1);
  assert.equal(written.isActiveTimer, false);
});

// ----------------------------------------------------------------- start
function startMocks(t) {
  t.mock.method(Project, "findById", async () => ({ _id: "project", status: "Active", teams: ["team"] }));
  t.mock.method(Team, "exists", async () => true);
  t.mock.method(Client, "exists", async () => true);
  t.mock.method(Task, "findOne", async () => ({ _id: "task", isActive: true }));
  noSweep(t);
}
const startedDoc = (extra = {}) => ({ ...running({ startOperationId: OP }), populate: async () => {}, ...extra });

test("a repeated start with the same operation ID returns the same timer instead of a conflict", async (t) => {
  startMocks(t);
  const earlier = startedDoc();
  t.mock.method(TaskTimeLog, "findOne", async (filter) => (filter.startOperationId === OP ? earlier : null));
  const creates = t.mock.method(TaskTimeLog, "create", async () => assert.fail("must not start twice"));
  const res = await call(startTimer, { project: "project", task: "task", client: "client", operationId: OP });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.replayed, true);
  assert.equal(res.body.timeLog, earlier);
  assert.equal(creates.mock.callCount(), 0);
  const reused = await call(startTimer, { project: "project", task: "other-task", client: "client", operationId: OP });
  assert.equal(reused.statusCode, 409);
  assert.equal(reused.body.code, "OPERATION_ID_REUSED");
});

test("two identical starts at once: the second gets the first one's timer", async (t) => {
  startMocks(t);
  let created = null;
  t.mock.method(TaskTimeLog, "findOne", async (filter) => (filter.startOperationId ? created : null));
  t.mock.method(TaskTimeLog, "create", async (data) => {
    if (created) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    assert.equal(data.startOperationId, OP);
    created = startedDoc();
    return created;
  });
  const [a, b] = [await call(startTimer, { project: "project", task: "task", client: "client", operationId: OP }),
    await call(startTimer, { project: "project", task: "task", client: "client", operationId: OP })];
  assert.equal(a.statusCode, 201);
  assert.ok([200, 201].includes(b.statusCode));
  assert.equal(String(b.body.timeLog._id), TIMER);
});

test("without an operation ID a second start is still refused with a clear code", async (t) => {
  startMocks(t);
  t.mock.method(TaskTimeLog, "findOne", async () => null);
  t.mock.method(TaskTimeLog, "create", async () => { throw Object.assign(new Error("E11000"), { code: 11000 }); });
  const res = await call(startTimer, { project: "project", task: "task" });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "ACTIVE_TIMER_EXISTS");
});

// ------------------------------------------------------- heartbeat / sweep
test("a late heartbeat after stop never reopens the timer", async (t) => {
  let predicate;
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (filter) => { predicate = filter; return null; });
  noSweep(t);
  const res = await call(heartbeatTimer);
  assert.equal(res.statusCode, 404);
  assert.equal(predicate.isActiveTimer, true);
  assert.deepEqual(predicate.status, { $in: ["running", "paused"] });
});

test("the lease sweep is safe to run again after a server restart", async (t) => {
  const stale = running({ desktopHeartbeatAt: new Date(Date.now() - 300_000) });
  let closed = false;
  t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => (closed ? [] : [stale]) }));
  t.mock.method(TaskTimeLog, "updateOne", async (filter) => {
    assert.equal(filter.isActiveTimer, true, "only an unchanged active timer is closed");
    assert.equal(filter.desktopHeartbeatAt, stale.desktopHeartbeatAt);
    if (closed) return { modifiedCount: 0 };
    closed = true;
    return { modifiedCount: 1 };
  });
  t.mock.method(console, "warn", () => {});
  assert.equal(await closeStaleDesktopTimers(new Date(), EMPLOYEE), 1);
  assert.equal(await closeStaleDesktopTimers(new Date(Date.now() + 1), EMPLOYEE), 0, "a second run changes nothing");
});
