const test = require("node:test");
const assert = require("node:assert/strict");
const Employee = require("../src/models/Employee");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const { getAllTimeLogs } = require("../src/modules/timers/taskTimeLogController");

test("admin report limits team records and rejects employees outside that team", async () => {
  const originalEmployeeFind = Employee.find;
  const originalLogFind = TaskTimeLog.find;
  const originalCount = TaskTimeLog.countDocuments;
  let reportFilter;
  Employee.find = () => ({ select: () => ({ lean: async () => [{ _id: "member" }] }) });
  TaskTimeLog.find = (filter) => {
    if (filter.isActiveTimer) return { lean: async () => [] };
    reportFilter = filter;
    const query = {
      populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
      lean: async () => [],
    };
    return query;
  };
  TaskTimeLog.countDocuments = async () => 0;
  const call = async (query) => {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await getAllTimeLogs({ query }, res);
    return res;
  };
  try {
    assert.equal((await call({ team: "team-1" })).code, 200);
    assert.deepEqual(reportFilter.employee.$in.map(String), ["member"]);
    assert.equal((await call({ team: "team-1", employee: "member" })).code, 200);
    assert.equal(reportFilter.employee, "member");
    assert.equal((await call({ team: "team-1", employee: "outsider" })).code, 400);
  } finally {
    Employee.find = originalEmployeeFind;
    TaskTimeLog.find = originalLogFind;
    TaskTimeLog.countDocuments = originalCount;
  }
});
