const test = require("node:test");
const assert = require("node:assert/strict");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const Task = require("../src/models/Task");
const { stopTimer } = require("../src/modules/timers/taskTimeLogController");

// The stop is one conditional update: it applies only while the timer is
// still active in the status that was read.
const conditionalStop = (timer, onWrite = () => {}) => async (filter, update) => {
  if (timer.status !== filter.status || timer.isActiveTimer === false) return null;
  onWrite();
  Object.assign(timer, update.$set);
  return timer;
};

test("short configured idle thresholds remain separate, preserve IDs and are idempotent", async (t) => {
  t.mock.method(Task, "findById", () => ({ select: () => ({ lean: async () => ({ idleLogout: true }) }) }));
  const originalFind = TaskTimeLog.find;
  const originalFindOne = TaskTimeLog.findOne;
  const originalUpdate = TaskTimeLog.findOneAndUpdate;
  TaskTimeLog.find = () => ({ lean: async () => [] });
  try {
    for (const seconds of [30, 60, 180, 300]) {
      let saves = 0;
      const timer = { _id: 'log', employee: 'employee', project: 'project', client: 'client', task: 'task',
        status: 'running', startedAt: new Date(Date.now() - 600_000), pauses: [] };
      TaskTimeLog.findOne = async () => timer.status === 'running' ? timer : null;
      TaskTimeLog.findOneAndUpdate = conditionalStop(timer, () => { saves++; });
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      const request = { user: { _id: 'employee' }, body: { idleSeconds: seconds } };
      await stopTimer(request, res);
      assert.equal(res.code, 200);
      assert.equal(timer.totalIdleSeconds, seconds);
      assert.ok(Math.abs(timer.totalWorkedSeconds - (600 - seconds)) <= 1);
      assert.deepEqual([timer._id, timer.employee, timer.project, timer.client, timer.task], ['log', 'employee', 'project', 'client', 'task']);
      await stopTimer(request, res);
      assert.equal(res.code, 404);
      assert.equal(timer.pauses.length, 1);
      assert.equal(saves, 1);
    }
  } finally {
    TaskTimeLog.find = originalFind;
    TaskTimeLog.findOne = originalFindOne;
    TaskTimeLog.findOneAndUpdate = originalUpdate;
  }
});

test("inactivity stop stores a red idle interval and excludes it from worked time", async (t) => {
  t.mock.method(Task, "findById", () => ({ select: () => ({ lean: async () => ({ idleLogout: true }) }) }));
  const originalFind = TaskTimeLog.find;
  const originalFindOne = TaskTimeLog.findOne;
  const startedAt = new Date(Date.now() - 600_000);
  const originalUpdate = TaskTimeLog.findOneAndUpdate;
  const timer = { status: "running", startedAt, pauses: [] };
  TaskTimeLog.find = () => ({ lean: async () => [] });
  TaskTimeLog.findOne = async () => timer;
  TaskTimeLog.findOneAndUpdate = conditionalStop(timer);
  try {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await stopTimer({ user: { _id: "employee" }, body: { idleSeconds: 300 } }, res);
    assert.equal(res.code, 200);
    assert.equal(timer.status, "stopped");
    assert.equal(timer.pauses.length, 1);
    assert.equal(timer.pauses[0].reason, "idle");
    assert.equal(timer.totalIdleSeconds, 300);
    assert.equal(timer.totalPausedSeconds, 300);
    assert.ok(timer.totalWorkedSeconds >= 299 && timer.totalWorkedSeconds <= 300);
  } finally {
    TaskTimeLog.find = originalFind;
    TaskTimeLog.findOne = originalFindOne;
    TaskTimeLog.findOneAndUpdate = originalUpdate;
  }
});

test("a task with idle logout turned off rejects stale automatic stops and can still be stopped manually", async (t) => {
  const timer = { _id: "log", task: "task", status: "running", startedAt: new Date(Date.now() - 600_000), pauses: [] };
  t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));
  t.mock.method(TaskTimeLog, "findOne", async () => timer);
  t.mock.method(Task, "findById", () => ({ select: () => ({ lean: async () => ({ idleLogout: false }) }) }));
  const write = t.mock.method(TaskTimeLog, "findOneAndUpdate", conditionalStop(timer));
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  for (const body of [{ idleSeconds: 300 }, { logoutReason: "inactivity" }]) {
    await stopTimer({ user: { _id: "employee" }, body }, res);
    assert.equal(res.code, 409);
    assert.equal(res.body.code, "IDLE_LOGOUT_DISABLED");
    assert.equal(timer.status, "running");
    assert.deepEqual(timer.pauses, []);
  }
  assert.equal(write.mock.callCount(), 0);
  await stopTimer({ user: { _id: "employee" }, body: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(timer.status, "stopped");
  assert.equal(timer.totalIdleSeconds, 0);
  assert.ok(timer.totalWorkedSeconds >= 600);
});
