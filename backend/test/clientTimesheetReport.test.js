const test = require("node:test");
const assert = require("node:assert/strict");
const Employee = require("../src/models/Employee");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const { getAllTimeLogs, getMyTeamTimeLogs, getMyTimeLogs } = require("../src/modules/timers/taskTimeLogController");

test("reports expose existing client relationships without changing log data or employee permissions", async () => {
  const original = { find: TaskTimeLog.find, count: TaskTimeLog.countDocuments, employees: Employee.find };
  const log = { _id: "log", employee: { _id: "member", fullName: "Employee" },
    client: { _id: "client-a", clientName: "ABC" }, project: { _id: "project", projectName: "Tax" },
    task: { _id: "task", taskType: "work" }, startedAt: new Date("2026-10-01T02:02:58Z"),
    stoppedAt: new Date("2026-10-01T02:08:09Z"), status: "stopped", totalWorkedSeconds: 8,
    totalIdleSeconds: 303, pauses: [{ reason: "idle", pausedAt: new Date("2026-10-01T02:03:06Z"),
      resumedAt: new Date("2026-10-01T02:08:09Z") }] };
  const before = JSON.stringify(log);
  let filter;
  let populations;
  TaskTimeLog.find = (query) => {
    if (query.isActiveTimer) return { lean: async () => [] };
    filter = query;
    populations = [];
    return { populate(...values) { populations.push(values); return this; },
      sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [log] };
  };
  TaskTimeLog.countDocuments = async () => 1;
  Employee.find = (query) => {
    assert.equal(query.teamLead, "lead");
    return { select: async () => [{ _id: { toString: () => "member" } }] };
  };
  const call = async (handler, query = {}, user = { _id: "lead", role: "team_lead" }) => {
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ user, query }, response);
    return response;
  };
  try {
    for (const handler of [getAllTimeLogs, getMyTeamTimeLogs, getMyTimeLogs]) {
      const response = await call(handler);
      assert.equal(response.code, 200);
      assert.equal(response.body.timeLogs[0].client.clientName, "ABC");
      const project = populations.find(([value]) => value?.path === "project")?.[0];
      assert.ok(project.select.includes("clientName client clients"));
      assert.deepEqual(project.populate.map((value) => value.path), ["client", "clients"]);
      assert.ok(populations.some(([path, select]) => path === "client" && select === "clientName"));
      if (handler === getMyTeamTimeLogs) assert.equal(filter.employee.$in[0].toString(), "member");
      if (handler === getMyTimeLogs) assert.equal(filter.employee, "lead");
    }
    assert.equal((await call(getMyTeamTimeLogs, { employee: "outside-team" })).code, 403);
    assert.equal(JSON.stringify(log), before);
  } finally {
    TaskTimeLog.find = original.find; TaskTimeLog.countDocuments = original.count; Employee.find = original.employees;
  }
});
