const test = require("node:test");
const assert = require("node:assert/strict");
const Employee = require("../src/models/Employee");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const Team = require("../src/models/Team");
const Client = require("../src/models/Client");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const { getAllTimeLogs, getMyTeamTimeLogs, clipTimeLogToRange } = require("../src/modules/timers/taskTimeLogController");
const { getBillingReport } = require("../src/modules/billing/billingController");
const query = (rows) => ({ select() { return this; }, populate() { return this; }, sort() { return this; },
  skip() { return this; }, limit() { return this; }, lean: async () => rows,
  then(resolve, reject) { return Promise.resolve(rows).then(resolve, reject); } });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("full company/team reports exclude deleted manual entries and no-range clipping rejects them", async (t) => {
  t.mock.method(Employee, "find", () => query([{ _id: "employee" }]));
  t.mock.method(TaskTimeLog, "find", (filter) => {
    if (!filter.desktopHeartbeatAt) assert.equal(filter["manualEntry.deletedAt"], null);
    return query([]);
  });
  t.mock.method(TaskTimeLog, "countDocuments", async (filter) => {
    assert.equal(filter["manualEntry.deletedAt"], null);
    return 0;
  });
  for (const [handler, role] of [[getAllTimeLogs, "manager"], [getMyTeamTimeLogs, "team_lead"]]) {
    const res = response();
    await handler({ user: { _id: "lead", role }, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.timeLogs, []);
  }
  assert.equal(clipTimeLogToRange({ entrySource: "manual", manualEntry: { deletedAt: new Date() } }, null), null);
});

test("billing never charges the retained hours of deleted manual entries", async (t) => {
  const employeeId = "64b000000000000000000a01";
  t.mock.method(Employee, "findOne", () => query({ _id: employeeId, fullName: "Employee", projectRates: [] }));
  t.mock.method(TaskTimeLog, "find", (filter) => {
    assert.equal(filter["manualEntry.deletedAt"], null);
    assert.equal(filter.status, "stopped");
    return query([]);
  });
  for (const Model of [Project, Task, Team, Client]) t.mock.method(Model, "find", () => query([]));
  const res = response();
  await getBillingReport({ user: { _id: employeeId, role: "manager" }, query: { employee: employeeId, startDate: "2026-10-08", endDate: "2026-10-08" } }, res);
  assert.equal(res.statusCode, 200);
});
