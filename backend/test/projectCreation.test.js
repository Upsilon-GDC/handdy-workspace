const test = require("node:test");
const assert = require("node:assert/strict");
const Project = require("../src/models/Project");
const Team = require("../src/models/Team");
const { createProject } = require("../src/modules/projects/projectController");

test("project creation only requires a name and one or more active teams", async () => {
  const originals = { exists: Project.exists, create: Project.create, teamFind: Team.find };
  let created;
  Project.exists = async () => false;
  Project.create = async (values) => {
    created = values;
    return values;
  };
  Team.find = (_filter) => ({
    select: async () => [
      { _id: "team-a", teamName: "Team A" },
      { _id: "team-b", teamName: "Team B" },
    ],
  });

  try {
    const res = {
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await createProject({
      user: { _id: "admin-a" },
      body: { projectName: "Monthly Accounts", teams: ["team-a", "team-b"] },
    }, res);

    assert.equal(res.code, 201);
    assert.equal(created.projectName, "Monthly Accounts");
    assert.deepEqual(created.teams, ["team-a", "team-b"]);
    assert.deepEqual(created.clients, []);
    assert.equal(created.client, null);
    assert.equal(created.clientName, "");
    assert.equal(created.status, undefined);
  } finally {
    Project.exists = originals.exists;
    Project.create = originals.create;
    Team.find = originals.teamFind;
  }
});
