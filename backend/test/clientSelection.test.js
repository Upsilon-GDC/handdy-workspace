const test = require("node:test");
const assert = require("node:assert/strict");
const Client = require("../src/models/Client");
const Project = require("../src/models/Project");
const Team = require("../src/models/Team");
const Task = require("../src/models/Task");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const router = require("../src/modules/clients/clientRoutes");
const { protect } = require("../src/middleware/authMiddleware");
const { startTimer } = require("../src/modules/timers/taskTimeLogController");

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

for (const role of ["employee", "team_lead"]) {
  test(`${role} client lookup keeps authentication, active filtering and limited fields`, async (t) => {
    const route = router.stack.find(layer => layer.route?.path === "/" && layer.route.methods.get).route;
    assert.equal(route.stack[0].handle, protect);
    let fields;
    const clients = [{ _id: "client-a", clientName: "ABC Company", status: "Active" }];
    t.mock.method(Client, "find", filter => {
      assert.deepEqual(filter, { status: { $ne: "Inactive" } });
      return {
        sort() { return this; },
        select(value) { fields = value; return this; },
        then(resolve, reject) { return Promise.resolve(clients).then(resolve, reject); },
      };
    });
    const res = response();
    await route.stack.at(-1).handle({ user: { role }, query: {} }, res);
    assert.equal(fields, "clientName status");
    assert.equal(res.body.count, 1);
    assert.deepEqual(res.body.clients, clients);
    const mutationGuards = router.stack.filter(layer => !layer.route);
    assert.equal(mutationGuards[0].handle, protect);
    let allowed = false;
    mutationGuards[1].handle({ user: { role } }, res, () => { allowed = true; });
    assert.equal(allowed, false);
    assert.equal(res.statusCode, 403);
  });

  test(`${role} timer start records the selected client ID for an unlinked shared project`, async (t) => {
    t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));
    t.mock.method(Project, "findById", async () => ({ status: "Active", deletedAt: null, teams: ["team"], clients: [], client: null }));
    t.mock.method(Client, "exists", async filter => {
      assert.deepEqual(filter, { _id: "client-b", status: "Active" });
      return { _id: "client-b" };
    });
    t.mock.method(Team, "exists", async () => ({ _id: "team" }));
    t.mock.method(Task, "findOne", async filter => {
      assert.equal(filter._id, "task");
      assert.deepEqual(filter.$and[1].$or[0], { project: "project" });
      if (role === "team_lead") assert.deepEqual(filter.$and[0], { $or: [{ team: "team" }, { teams: "team" }] });
      else assert.deepEqual(filter.$and[0].$or[0], { assignedTo: "employee" });
      return { _id: "task" };
    });
    t.mock.method(TaskTimeLog, "findOne", async () => null);
    let saved;
    t.mock.method(TaskTimeLog, "create", async values => {
      saved = values;
      return { ...values, populate: async () => {} };
    });
    const res = response();
    await startTimer({ user: { _id: "employee", team: "team", role },
      body: { project: "project", task: "task", client: "client-b", clientType: "desktop" } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(saved.client, "client-b");
    assert.equal(saved.project, "project");
    assert.equal(saved.task, "task");
  });
}
