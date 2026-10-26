const test = require("node:test");
const assert = require("node:assert/strict");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const Client = require("../src/models/Client");
const mongoose = require("mongoose");
const { startTimer } = require("../src/modules/timers/taskTimeLogController");

test("desktop can start an assigned break task with no project under the selected project", async () => {
  const originals = {
    projectFindById: Project.findById,
    taskFindOne: Task.findOne,
    logFind: TaskTimeLog.find,
    logFindOne: TaskTimeLog.findOne,
    logCreate: TaskTimeLog.create,
  };
  let taskFilter;
  let created;
  Project.findById = async () => ({ status: "Active", deletedAt: null });
  Task.findOne = async (filter) => {
    taskFilter = filter;
    return { _id: "break-task", taskType: "break", project: null };
  };
  TaskTimeLog.find = () => ({ lean: async () => [] });
  TaskTimeLog.findOne = async () => null;
  TaskTimeLog.create = async (values) => {
    created = values;
    return { ...values, populate: async () => {} };
  };
  try {
    const res = {
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await startTimer({
      user: { _id: "employee", role: "employee", team: null },
      body: { project: "selected-project", task: "break-task", clientType: "desktop" },
    }, res);

    assert.equal(res.code, 201);
    assert.deepEqual(taskFilter.$and[1].$or, [
      { project: "selected-project" },
      { project: null, taskType: "work" },
      { project: null, taskType: "break" },
    ]);
    assert.deepEqual(taskFilter.$and[0].$or, [{ assignedTo: "employee" }]);
    assert.equal(created.project, "selected-project");
    assert.ok(created.desktopHeartbeatAt instanceof Date);
  } finally {
    Project.findById = originals.projectFindById;
    Task.findOne = originals.taskFindOne;
    TaskTimeLog.find = originals.logFind;
    TaskTimeLog.findOne = originals.logFindOne;
    TaskTimeLog.create = originals.logCreate;
  }
});

test("timer start rejects an inactive or unknown client", async () => {
  const original = Project.findById;
  const originalFind = TaskTimeLog.find;
  const originalClientExists = Client.exists;
  const employeeId = new mongoose.Types.ObjectId();
  TaskTimeLog.find = () => ({ lean: async () => [] });
  Project.findById = async () => ({
    status: "Active", deletedAt: null, client: "client-a", clients: ["client-a"],
  });
  Client.exists = async () => null;
  try {
    const res = {
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await startTimer({
      user: { _id: employeeId, role: "employee" },
      body: { project: "project-a", task: "task-a", client: "client-b" },
    }, res);
    assert.equal(res.code, 400);
    assert.match(res.body.message, /valid active client/);
  } finally {
    Project.findById = original;
    TaskTimeLog.find = originalFind;
    Client.exists = originalClientExists;
  }
});
