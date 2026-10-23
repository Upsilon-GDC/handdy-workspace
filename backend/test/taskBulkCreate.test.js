const test = require("node:test");
const assert = require("node:assert/strict");
const Task = require("../src/models/Task");
const Team = require("../src/models/Team");
const Project = require("../src/models/Project");
const { createTask, createTasksBulk, getAllTasks, updateTask } = require("../src/controllers/taskController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

// Task.find(...).select(...).lean() resolving to the given rows.
const taskQuery = (rows) => () => ({ select: () => ({ lean: async () => (typeof rows === "function" ? rows() : rows) }) });

test("bulk task creation reuses one configuration without a fixed batch limit", async () => {
  const originals = {
    teamFind: Team.find,
    projectFindOne: Project.findOne,
    taskExists: Task.exists,
    taskFind: Task.find,
    insertMany: Task.insertMany,
  };
  let inserted;
  Team.find = async () => [{ _id: "team-1" }];
  Project.findOne = () => ({ select: () => ({ lean: async () => ({ teams: ["team-1"] }) }) });
  Task.exists = async () => false;
  Task.find = taskQuery([]);
  Task.insertMany = async (tasks) => { inserted = tasks; return tasks.map((task, index) => ({ _id: `task-${index}`, ...task })); };

  try {
    const taskNames = Array.from({ length: 30 }, (_, index) => `Task ${index + 1}`);
    const res = response();
    await createTasksBulk({
      user: { _id: "admin-1", role: "admin" },
      body: {
        taskNames,
        taskType: "work",
        project: "project-1",
        teams: ["team-1"],
        assignToAllEmployees: true,
        idleLogout: true,
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.tasks.length, 30);
    assert.deepEqual(inserted.map((task) => task.taskName), taskNames);
    assert.equal(new Set(inserted.map((task) => task.taskCode)).size, 30);
    for (const task of inserted) {
      assert.equal(task.project, "project-1");
      assert.deepEqual(task.teams, ["team-1"]);
      assert.equal(task.assignToAllEmployees, true);
      assert.deepEqual(task.assignedTo, []);
      assert.equal(task.idleLogout, true);
      assert.equal(task.createdBy, "admin-1");
    }
  } finally {
    Team.find = originals.teamFind;
    Project.findOne = originals.projectFindOne;
    Task.exists = originals.taskExists;
    Task.find = originals.taskFind;
    Task.insertMany = originals.insertMany;
  }
});

test("bulk task creation creates each task name for every selected project", async () => {
  const originals = {
    teamFind: Team.find,
    projectFindOne: Project.findOne,
    taskExists: Task.exists,
    taskFind: Task.find,
    insertMany: Task.insertMany,
  };
  let inserted;
  Team.find = async () => [{ _id: "team-1" }];
  Project.findOne = () => ({ select: () => ({ lean: async () => ({ teams: ["team-1"] }) }) });
  Task.exists = async () => false;
  Task.find = taskQuery([]);
  Task.insertMany = async (tasks) => { inserted = tasks; return tasks; };

  try {
    const res = response();
    await createTasksBulk({
      user: { _id: "admin-1", role: "admin" },
      body: {
        taskNames: ["Research", "Review"],
        projects: ["project-1", "project-2"],
        taskType: "work",
        teams: ["team-1"],
        assignToAllEmployees: true,
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(inserted.length, 4);
    assert.deepEqual(
      inserted.map((task) => [task.taskName, task.project]),
      [
        ["Research", "project-1"],
        ["Review", "project-1"],
        ["Research", "project-2"],
        ["Review", "project-2"],
      ]
    );
  } finally {
    Team.find = originals.teamFind;
    Project.findOne = originals.projectFindOne;
    Task.exists = originals.taskExists;
    Task.find = originals.taskFind;
    Task.insertMany = originals.insertMany;
  }
});

test("team-only creation stores one work task across all selected-team projects", async () => {
  const originals = {
    teamFind: Team.find,
    projectFind: Project.find,
    projectFindOne: Project.findOne,
    taskExists: Task.exists,
    taskFind: Task.find,
    insertMany: Task.insertMany,
  };
  let inserted;
  Team.find = async ({ _id }) => _id.$in.map((id) => ({ _id: id }));
  Project.find = () => ({ select: () => ({ lean: async () => [
    { _id: "project-a", teams: ["team-a"] },
    { _id: "project-b", teams: ["team-a", "team-b"] },
    { _id: "project-c", teams: ["team-b"] },
  ] }) });
  Project.findOne = ({ _id }) => ({ select: () => ({ lean: async () => ({
    teams: _id === "project-b" ? ["team-a", "team-b"] : [_id === "project-a" ? "team-a" : "team-b"],
  }) }) });
  Task.exists = async () => false;
  Task.find = taskQuery([]);
  Task.insertMany = async (tasks) => { inserted = tasks; return tasks; };
  try {
    const res = response();
    await createTasksBulk({
      user: { _id: "admin-1", role: "admin" },
      body: { taskNames: ["Review"], taskType: "work", teams: ["team-a", "team-b"], autoProjects: true },
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].project, null);
    assert.deepEqual(inserted[0].teams, ["team-a", "team-b"]);
    assert.ok(inserted.every((task) => task.assignToAllEmployees && task.assignedTo.length === 0));
  } finally {
    Team.find = originals.teamFind;
    Project.find = originals.projectFind;
    Project.findOne = originals.projectFindOne;
    Task.exists = originals.taskExists;
    Task.find = originals.taskFind;
    Task.insertMany = originals.insertMany;
  }
});

test("team-only work creation requires an assigned active project", async () => {
  const originalTeamFind = Team.find;
  const originalProjectFind = Project.find;
  Team.find = async () => [{ _id: "team-a" }];
  Project.find = () => ({ select: () => ({ lean: async () => [] }) });
  try {
    const res = response();
    await createTasksBulk({
      user: { _id: "admin-1", role: "admin" },
      body: { taskNames: ["Review"], taskType: "work", teams: ["team-a"], autoProjects: true },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /No active projects/);
  } finally {
    Team.find = originalTeamFind;
    Project.find = originalProjectFind;
  }
});

test("bulk task creation rejects empty and duplicate name batches", async () => {
  for (const [taskNames, message] of [
    [["Only one"], "Select at least two tasks or projects for bulk creation."],
    [["One", ""], "Select at least two tasks or projects for bulk creation."],
    [["Review", " review "], "Task names in the same batch must be unique."],
  ]) {
    const res = response();
    await createTasksBulk({ user: { _id: "admin-1", role: "admin" }, body: { taskNames } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, message);
  }
});

test("task management can request every matching task without pagination", async () => {
  const originals = {
    countDocuments: Task.countDocuments,
    find: Task.find,
  };
  const tasks = Array.from({ length: 78 }, (_, index) => ({ _id: `task-${index}` }));
  let skipCalled = false;
  let limitCalled = false;
  const query = {
    populate() { return this; },
    sort() { return this; },
    skip() { skipCalled = true; return this; },
    limit() { limitCalled = true; return this; },
    then(resolve) { return Promise.resolve(tasks).then(resolve); },
  };
  Task.countDocuments = async () => tasks.length;
  Task.find = () => query;

  try {
    const res = response();
    await getAllTasks({
      user: { _id: "admin-1", role: "admin" },
      query: { all: "true" },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.tasks.length, 78);
    assert.equal(res.body.totalTasks, 78);
    assert.equal(res.body.totalPages, 1);
    assert.equal(skipCalled, false);
    assert.equal(limitCalled, false);
  } finally {
    Task.countDocuments = originals.countDocuments;
    Task.find = originals.find;
  }
});

// Shared stubs for the duplicate-task tests: two named teams, one project
// assigned to both, and an in-memory task collection.
const withTaskStore = async (stored, run) => {
  const originals = {
    teamFind: Team.find, projectFind: Project.find, projectFindOne: Project.findOne,
    taskExists: Task.exists, taskFind: Task.find, insertMany: Task.insertMany, create: Task.create,
    findOne: Task.findOne, findById: Task.findById,
  };
  const teamNames = { "team-a": "Accounts", "team-b": "Audit Team" };
  Team.find = async ({ _id }) => (_id.$in || []).map((id) => ({ _id: id, teamName: teamNames[id] }));
  Project.find = () => ({ select: () => ({ lean: async () => [{ _id: "project-1", teams: ["team-a", "team-b"] }] }) });
  Project.findOne = () => ({ select: () => ({ lean: async () => ({ teams: ["team-a", "team-b"] }) }) });
  Task.exists = async () => false;
  Task.find = taskQuery(() => stored.map((task) => ({ ...task })));
  Task.insertMany = async (tasks) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const created = tasks.map((task, index) => ({ _id: `new-${stored.length + index}`, ...task }));
    stored.push(...created);
    return created;
  };
  try {
    await run();
  } finally {
    Object.assign(Team, { find: originals.teamFind });
    Object.assign(Project, { find: originals.projectFind, findOne: originals.projectFindOne });
    Object.assign(Task, {
      exists: originals.taskExists, find: originals.taskFind, insertMany: originals.insertMany,
      create: originals.create, findOne: originals.findOne, findById: originals.findById,
    });
  }
};
const admin = { _id: "admin-1", role: "admin" };
const teamTaskBody = (taskNames, teams = ["team-a"]) => ({ taskNames, taskType: "work", teams, autoProjects: true });

test("creating a task name that already exists for a selected team is rejected", async () => {
  const stored = [{ _id: "existing", taskName: "  review ", taskType: "work", project: null, teams: ["team-a"], isActive: true }];
  await withTaskStore(stored, async () => {
    const res = response();
    await createTasksBulk({ user: admin, body: teamTaskBody(["Review", "Filing"], ["team-a", "team-b"]) }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "DUPLICATE_TASK");
    assert.equal(res.body.message, "A task named \"review\" already exists for Accounts. Use the existing task instead of creating a duplicate.");
    assert.equal(stored.length, 1, "no part of the batch is created");
  });
});

test("an inactive duplicate points to reactivating the existing task", async () => {
  const stored = [{ _id: "old", taskName: "Review", taskType: "work", project: null, teams: ["team-b"], isActive: false }];
  await withTaskStore(stored, async () => {
    const res = response();
    await createTasksBulk({ user: admin, body: teamTaskBody(["review"], ["team-b"]) }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /^A task named "Review" already exists for Audit Team\. Activate the existing task/);
  });
});

test("same-named tasks in another team, of another type or for another project are not duplicates", async () => {
  const stored = [
    { _id: "other-team", taskName: "Review", taskType: "work", project: null, teams: ["team-b"] },
    { _id: "break", taskName: "Review", taskType: "break", project: null, teams: ["team-a"] },
    { _id: "similar", taskName: "Reviews", taskType: "work", project: null, teams: ["team-a"] },
    { _id: "legacy-team", taskName: "Filing", taskType: "work", project: null, team: "team-b", teams: [] },
  ];
  await withTaskStore(stored, async () => {
    const res = response();
    await createTasksBulk({ user: admin, body: teamTaskBody(["Review", "Filing"]) }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(stored.length, 6, "both names are created");

    stored.push({ _id: "project-2-task", taskName: "Audit", taskType: "work", project: "project-2", teams: ["team-a"] });
    const projectTask = response();
    await createTasksBulk({ user: admin, body: {
      taskNames: ["Audit", "Prep"], taskType: "work", projects: ["project-1"], teams: ["team-a"], assignToAllEmployees: true,
    } }, projectTask);
    assert.equal(projectTask.statusCode, 201);
  });
});

test("a team-wide task conflicts with a same-named task tied to one of its projects", async () => {
  const stored = [{ _id: "project-task", taskName: "Review", taskType: "work", project: "project-1", teams: ["team-a"] }];
  await withTaskStore(stored, async () => {
    const res = response();
    await createTasksBulk({ user: admin, body: teamTaskBody(["Review"]) }, res);
    assert.equal(res.statusCode, 409);
  });
});

test("a double-submitted request creates the task only once", async () => {
  const stored = [];
  await withTaskStore(stored, async () => {
    const first = response();
    const second = response();
    await Promise.all([
      createTasksBulk({ user: admin, body: teamTaskBody(["Month-end close"]) }, first),
      createTasksBulk({ user: admin, body: teamTaskBody(["Month-end close"]) }, second),
    ]);
    assert.deepEqual([first.statusCode, second.statusCode].sort(), [201, 409]);
    assert.equal(stored.length, 1);
  });
});

test("the single-task endpoint applies the same duplicate rule", async () => {
  const stored = [{ _id: "existing", taskName: "Review", taskType: "work", project: "project-1", teams: ["team-a"] }];
  await withTaskStore(stored, async () => {
    Task.findOne = async () => null;
    let created = 0;
    Task.create = async () => { created += 1; return { _id: "new" }; };
    const res = response();
    await createTask({ user: admin, body: { taskName: "REVIEW", taskType: "work", project: "project-1", teams: ["team-a"] } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(created, 0);
  });
});

test("renaming onto an existing task is rejected while other edits still save", async () => {
  const stored = [{ _id: "filing", taskName: "Filing", taskType: "work", project: null, teams: ["team-a"] }];
  await withTaskStore(stored, async () => {
    const makeTask = () => ({
      _id: "review", taskCode: "TSK-1", taskName: "Review", taskType: "work", project: null,
      team: "team-a", teams: ["team-a"], assignedTo: [], assignToAllEmployees: true, isActive: true,
      idleLogout: false, saved: 0, save() { this.saved += 1; },
    });
    let task = makeTask();
    Task.findOne = async () => task;
    Task.findById = () => ({ populate() { return this; }, then: (resolve) => Promise.resolve(task).then(resolve) });

    const rename = response();
    await updateTask({ user: admin, params: { id: "review" }, body: { taskName: " filing ", teams: ["team-a"], project: null } }, rename);
    assert.equal(rename.statusCode, 409);
    assert.equal(task.saved, 0);

    task = makeTask();
    const edit = response();
    await updateTask({ user: admin, params: { id: "review" }, body: { taskName: "Review", teams: ["team-a"], project: null, idleLogout: true, isActive: false } }, edit);
    assert.equal(edit.statusCode, 200);
    assert.equal(task.saved, 1);
    assert.equal(task.idleLogout, true);

    task = makeTask();
    const addTeam = response();
    await updateTask({ user: admin, params: { id: "review" }, body: { taskName: "Review", teams: ["team-a", "team-b"] } }, addTeam);
    assert.equal(addTeam.statusCode, 200, "adding a team with no same-named task is allowed");
    assert.deepEqual(task.teams, ["team-a", "team-b"]);
  });
});
