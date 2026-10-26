const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Attendance = require("../src/models/Attendance");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const { deriveAttendance, recordAttendanceActivity, syncAttendanceForDay } = require("../src/services/attendanceService");
const { closeStaleDesktopTimers } = require("../src/services/desktopTimerLease");
const { stopTimer } = require("../src/controllers/taskTimeLogController");

const EMPLOYEE = "64b000000000000000000e01";
const at = (iso) => new Date(iso);
const query = (rows) => ({ select() { return this; }, lean: async () => rows });
// The readyState getter is non-configurable, so node's mocks cannot restore
// it; set the backing field instead (no connection events are emitted).
const withReadyState = (t, state) => {
  const previous = mongoose.connection._readyState;
  mongoose.connection._readyState = state;
  t.after(() => { mongoose.connection._readyState = previous; });
};
const connected = (t) => withReadyState(t, 1);

test("a day's attendance runs from its first timer start to its last stop", () => {
  assert.equal(deriveAttendance([]), null);
  const day = deriveAttendance([
    { startedAt: at("2026-10-23T08:30:00Z"), stoppedAt: at("2026-10-23T09:00:00Z"), status: "stopped" },
    { startedAt: at("2026-10-23T03:30:00Z"), stoppedAt: at("2026-10-23T07:00:00Z"), status: "stopped" },
    { startedAt: at("2026-10-23T07:30:00Z"), stoppedAt: at("2026-10-23T08:00:00Z"), status: "stopped" },
  ]);
  assert.deepEqual(day, { checkIn: at("2026-10-23T03:30:00Z"), checkOut: at("2026-10-23T09:00:00Z"), totalHours: 5.5, status: "Present" });
});

test("a running or paused timer keeps the day checked in", () => {
  for (const status of ["running", "paused"]) {
    const day = deriveAttendance([
      { startedAt: at("2026-10-23T03:30:00Z"), stoppedAt: at("2026-10-23T05:00:00Z"), status: "stopped" },
      { startedAt: at("2026-10-23T06:00:00Z"), stoppedAt: null, status },
    ]);
    assert.equal(day.checkIn.toISOString(), "2026-10-23T03:30:00.000Z");
    assert.equal(day.checkOut, null);
    assert.equal(day.totalHours, 0);
  }
});

test("syncing a day reads that company day's sessions and upserts one timer-sourced row", async (t) => {
  let findFilter;
  let saved;
  t.mock.method(TaskTimeLog, "find", (filter) => {
    findFilter = filter;
    return query([{ startedAt: at("2026-10-22T19:00:00Z"), stoppedAt: at("2026-10-23T02:00:00Z"), status: "stopped" }]);
  });
  t.mock.method(Attendance, "findOneAndUpdate", async (filter, update, options) => { saved = { filter, update, options }; return {}; });

  await syncAttendanceForDay(EMPLOYEE, "2026-10-23", "Asia/Kolkata");
  assert.equal(findFilter.employee, EMPLOYEE);
  assert.equal(findFilter["manualEntry.deletedAt"], null, "deleted manual entries never count");
  // 2026-10-23 in Asia/Kolkata is 18:30 UTC on the 22nd to 18:30 UTC on the 23rd.
  assert.equal(findFilter.startedAt.$gte.toISOString(), "2026-10-22T18:30:00.000Z");
  assert.equal(findFilter.startedAt.$lt.toISOString(), "2026-10-23T18:30:00.000Z");
  assert.deepEqual(saved.filter, { employee: EMPLOYEE, date: "2026-10-23" });
  assert.equal(saved.update.$set.source, "timer");
  assert.equal(saved.update.$set.status, "Present");
  assert.equal(saved.update.$set.totalHours, 7);
  assert.equal(saved.options.upsert, true, "the unique employee/date index keeps it to one row");
});

test("a day whose only activity was removed becomes Absent, and older check-in rows are untouched", async (t) => {
  let saved;
  t.mock.method(TaskTimeLog, "find", () => query([]));
  t.mock.method(Attendance, "findOneAndUpdate", async (filter, update, options) => { saved = { filter, update, options }; return null; });
  await syncAttendanceForDay(EMPLOYEE, "2026-10-23", "Asia/Kolkata");
  assert.deepEqual(saved.filter, { employee: EMPLOYEE, date: "2026-10-23", source: "timer" });
  assert.deepEqual(saved.update.$set, { status: "Absent", checkIn: null, checkOut: null, totalHours: 0 });
  assert.equal(saved.options.upsert, undefined, "never creates an Absent row");
});

test("activity is filed under the company date the session started on", async (t) => {
  connected(t);
  const dates = [];
  t.mock.method(TaskTimeLog, "find", () => query([{ startedAt: at("2026-10-22T19:00:00Z"), stoppedAt: null, status: "running" }]));
  t.mock.method(Attendance, "findOneAndUpdate", async (filter) => { dates.push(filter.date); return {}; });
  // 00:30 on the 23rd in India, still the 22nd in UTC.
  await recordAttendanceActivity(EMPLOYEE, at("2026-10-22T19:00:00Z"), "Asia/Kolkata");
  assert.deepEqual(dates, ["2026-10-23"]);
});

test("attendance problems never fail the timer action, and updates for one day run in order", async (t) => {
  connected(t);
  const events = [];
  let release;
  const firstWrite = new Promise((resolve) => { release = resolve; });
  let call = 0;
  t.mock.method(TaskTimeLog, "find", () => { events.push(`read-${++call}`); return query([]); });
  t.mock.method(Attendance, "findOneAndUpdate", async () => {
    const mine = call;
    if (mine === 1) await firstWrite;
    events.push(`write-${mine}`);
    if (mine === 2) throw new Error("database unavailable");
    return {};
  });
  t.mock.method(console, "error", () => {});
  const first = recordAttendanceActivity(EMPLOYEE, at("2026-10-23T04:00:00Z"), "Asia/Kolkata");
  const second = recordAttendanceActivity(EMPLOYEE, at("2026-10-23T05:00:00Z"), "Asia/Kolkata");
  await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.deepEqual(await first, {});
  assert.equal(await second, null, "a failed update is logged, not thrown");
  assert.deepEqual(events, ["read-1", "write-1", "read-2", "write-2"]);
  assert.equal(console.error.mock.callCount(), 1);
});

test("without a database connection attendance is skipped", async (t) => {
  withReadyState(t, 0);
  t.mock.method(TaskTimeLog, "find", () => assert.fail("must not query"));
  assert.equal(await recordAttendanceActivity(EMPLOYEE, new Date()), null);
});

test("stopping a timer checks the employee out on the day the timer started", async (t) => {
  connected(t);
  const startedAt = at("2026-10-23T03:30:00Z");
  const timer = { _id: "log", employee: EMPLOYEE, status: "running", startedAt, pauses: [], async save() { this.saved = true; } };
  t.mock.method(TaskTimeLog, "findOne", async () => timer);
  t.mock.method(TaskTimeLog, "find", (filter) => (filter.isActiveTimer
    ? { lean: async () => [] }
    : query([{ startedAt, stoppedAt: timer.stoppedAt, status: timer.status }])));
  let saved;
  t.mock.method(Attendance, "findOneAndUpdate", async (filter, update) => { saved = { filter, update }; return {}; });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await stopTimer({ user: { _id: EMPLOYEE }, body: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(timer.saved, true);
  assert.equal(saved.filter.date, "2026-10-23");
  assert.equal(saved.update.$set.checkOut.getTime(), timer.stoppedAt.getTime());
});

test("a timer closed for missed heartbeats checks out at the last heartbeat", async (t) => {
  connected(t);
  const startedAt = at("2026-10-23T03:30:00Z");
  const heartbeat = at("2026-10-23T06:00:00Z");
  const log = { _id: "timer", employee: EMPLOYEE, status: "running", isActiveTimer: true, startedAt, desktopHeartbeatAt: heartbeat, pauses: [] };
  t.mock.method(TaskTimeLog, "find", (filter) => (filter.isActiveTimer
    ? { lean: async () => [log] }
    : query([{ startedAt, stoppedAt: heartbeat, status: "stopped" }])));
  t.mock.method(TaskTimeLog, "updateOne", async () => ({ modifiedCount: 1 }));
  t.mock.method(console, "warn", () => {});
  let saved;
  t.mock.method(Attendance, "findOneAndUpdate", async (filter, update) => { saved = { filter, update }; return {}; });
  assert.equal(await closeStaleDesktopTimers(at("2026-10-23T09:00:00Z"), EMPLOYEE), 1);
  assert.equal(saved.update.$set.checkOut.toISOString(), heartbeat.toISOString());
  assert.equal(saved.update.$set.totalHours, 2.5);
});
