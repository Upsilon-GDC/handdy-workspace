// Personal permission exceptions (Permissions page, "By employee").
const test = require("node:test");
const assert = require("node:assert/strict");

const Employee = require("../src/models/Employee");
const { requirePermission } = require("../src/middleware/authorizeRoles");
const { getEffectivePermissionsSync } = require("../src/services/permissionService");
const {
  getMyPermissions,
  listEmployeePermissions,
  updateEmployeePermissions,
} = require("../src/modules/permissions/permissionController");
const permissionRoutes = require("../src/modules/permissions/permissionRoutes");

const LEAD_ID = "64b000000000000000000a07";

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const allowed = async (user, key) => {
  const res = response();
  let passed = false;
  await requirePermission(key)({ user }, res, () => { passed = true; });
  return passed;
};

// Mongoose query stand-in: every chained call returns the same query.
const query = (value, calls = {}) => ({
  select(fields) { calls.select = fields; return this; },
  populate(path, fields) { calls.populate = [path, fields]; return this; },
  sort(order) { calls.sort = order; return this; },
  lean: async () => value,
});

test("a person's own settings add or remove permissions on top of their role", async () => {
  const lead = { role: "team_lead", permissionOverrides: { granted: ["add_manual_entries"], revoked: ["create_tasks"] } };
  assert.equal(await allowed(lead, "add_manual_entries"), true, "personal on");
  assert.equal(await allowed(lead, "create_tasks"), false, "personal off beats the role");
  assert.equal(await allowed(lead, "edit_tasks"), true, "everything else follows the role");
  assert.equal(await allowed({ role: "team_lead" }, "add_manual_entries"), false, "other team leads are unchanged");

  // Any duty can be given to one person, whatever their role.
  const employee = { role: "employee", permissionOverrides: { granted: ["manage_clients"] } };
  assert.equal(await allowed(employee, "manage_clients"), true);
  assert.equal(await allowed({ role: "employee" }, "manage_clients"), false, "other employees are unchanged");

  // Admin-level roles keep everything; legacy delegations still count.
  assert.equal(await allowed({ role: "admin", permissionOverrides: { revoked: ["create_tasks"] } }, "create_tasks"), true);
  const res = response();
  await getMyPermissions({ user: { ...lead, permissions: ["edit_employees"] } }, res);
  assert.ok(res.body.permissions.includes("add_manual_entries"));
  assert.ok(res.body.permissions.includes("edit_employees"));
  assert.ok(!res.body.permissions.includes("create_tasks"));
});

test("people without personal settings get exactly their role's permissions", () => {
  for (const user of [{ role: "hr" }, { role: "hr", permissionOverrides: {} }, { role: "hr", permissionOverrides: { granted: null } }]) {
    assert.ok(getEffectivePermissionsSync(user).includes("view_billing_amounts"));
  }
});

test("the employee list shows active people in configurable roles with their exceptions", async (t) => {
  const calls = {};
  t.mock.method(Employee, "find", (filter) => {
    calls.filter = filter;
    return query([
      { _id: LEAD_ID, employeeId: "E7", fullName: "Asha Rao", email: "asha@example.com", role: "team_lead",
        team: { name: "Design" }, permissionOverrides: { granted: ["add_manual_entries", "assign_tasks"], revoked: ["create_tasks"] } },
      { _id: "64b000000000000000000a08", fullName: "", email: "new@example.com", role: "employee", team: null },
    ], calls);
  });
  const res = response();
  await listEmployeePermissions({ user: { role: "admin" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.filter, { isActive: true, role: { $in: ["hr", "team_lead", "employee"] } });
  assert.match(calls.select, /\+permissionOverrides\.granted \+permissionOverrides\.revoked/);
  assert.doesNotMatch(calls.select, /password|rate/i, "only what the page shows");
  const [lead, newcomer] = res.body.employees;
  assert.equal(lead.team, "Design");
  assert.deepEqual([lead.granted, lead.revoked], [["add_manual_entries"], ["create_tasks"]], "retired keys are not sent to the page");
  assert.ok(lead.permissions.includes("add_manual_entries") && !lead.permissions.includes("create_tasks"));
  assert.equal(newcomer.fullName, "new@example.com");
  assert.deepEqual([newcomer.granted, newcomer.revoked], [[], []]);
});

test("saving a person's settings validates them and stores the complete exception list", async (t) => {
  t.mock.method(console, "info", () => {});
  const people = {
    [LEAD_ID]: { _id: LEAD_ID, fullName: "Asha Rao", role: "team_lead", isActive: true, team: { name: "Design" } },
    "64b000000000000000000a09": { _id: "64b000000000000000000a09", role: "manager", isActive: true },
    "64b000000000000000000a0a": { _id: "64b000000000000000000a0a", role: "employee", isActive: false },
  };
  t.mock.method(Employee, "findById", (id) => query(people[id] || null));
  let saved;
  t.mock.method(Employee, "updateOne", async (filter, update) => { saved = { filter, update }; return {}; });
  const save = async (employeeId, body) => {
    const res = response();
    await updateEmployeePermissions({ user: { _id: "admin-1", role: "admin" }, params: { employeeId }, body }, res);
    return res;
  };

  assert.equal((await save("not-an-id", {})).statusCode, 400);
  assert.equal((await save("64b000000000000000000aff", {})).statusCode, 404);
  assert.equal((await save("64b000000000000000000a0a", {})).statusCode, 404, "inactive accounts are not listed or edited");
  assert.equal((await save("64b000000000000000000a09", { granted: [] })).statusCode, 400, "admin-level roles are fixed");
  assert.equal((await save(LEAD_ID, { granted: ["root_access"] })).statusCode, 400);
  assert.equal((await save(LEAD_ID, { revoked: "create_tasks" })).statusCode, 400);
  const both = await save(LEAD_ID, { granted: ["create_tasks"], revoked: ["create_tasks"] });
  assert.equal(both.statusCode, 400);
  assert.match(both.body.message, /both on and off/);
  assert.equal(saved, undefined, "nothing is written for a rejected request");

  const ok = await save(LEAD_ID, { granted: ["add_manual_entries", "add_manual_entries", "manage_clients"], revoked: ["create_tasks"] });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(saved.filter, { _id: LEAD_ID });
  assert.deepEqual(saved.update.$set["permissionOverrides.granted"], ["add_manual_entries", "manage_clients"], "duplicates removed");
  assert.deepEqual(saved.update.$set["permissionOverrides.revoked"], ["create_tasks"]);
  assert.equal(saved.update.$set["permissionOverrides.updatedBy"], "admin-1");
  assert.ok(saved.update.$set["permissionOverrides.updatedAt"] instanceof Date);
  assert.ok(ok.body.employee.permissions.includes("add_manual_entries"));
  assert.ok(!ok.body.employee.permissions.includes("create_tasks"));

  // Empty lists hand every switch back to the role.
  const cleared = await save(LEAD_ID, {});
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(saved.update.$set["permissionOverrides.granted"], []);
  assert.deepEqual(saved.update.$set["permissionOverrides.revoked"], []);
  assert.ok(cleared.body.employee.permissions.includes("create_tasks"));
});

test("only admin, alpha or manager can list or change a person's permissions", () => {
  for (const [path, method] of [["/employees", "get"], ["/employees/:employeeId", "put"]]) {
    const route = permissionRoutes.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route;
    assert.ok(route, `${method.toUpperCase()} ${path} exists`);
    const guard = route.stack[1].handle;
    for (const role of ["hr", "team_lead", "employee"]) {
      const res = response();
      guard({ user: { role } }, res, () => assert.fail(`${role} reached ${path}`));
      assert.equal(res.statusCode, 403);
    }
    for (const role of ["admin", "alpha", "manager"]) {
      let passed = false;
      guard({ user: { role } }, response(), () => { passed = true; });
      assert.equal(passed, true);
    }
  }
});

test("the sign-in check loads each person's exceptions", () => {
  const source = require("node:fs").readFileSync(require.resolve("../src/middleware/authMiddleware"), "utf8");
  assert.match(source, /\+permissionOverrides\.granted \+permissionOverrides\.revoked/);
});
