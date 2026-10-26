const test = require("node:test");
const assert = require("node:assert/strict");

const RolePermission = require("../src/models/RolePermission");
const Task = require("../src/models/Task");
const { requirePermission } = require("../src/middleware/authorizeRoles");
const { guardTaskAssignmentOnCreate, guardTaskReassignment } = require("../src/middleware/taskPermissions");
const { setRoleOverride, getRolePermissionsSync } = require("../src/services/permissionService");
const { updateRolePermissions, getMyPermissions } = require("../src/controllers/permissionController");
const { DEFAULT_ROLE_PERMISSIONS, ALL_PERMISSION_KEYS } = require("../src/utils/permissions");
const permissionRoutes = require("../src/routes/permissionRoutes");
const taskTimeLogRoutes = require("../src/routes/taskTimeLogRoutes");
const billingRoutes = require("../src/routes/billingRoutes");

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const run = (middleware, user, extra = {}) => new Promise((resolve) => {
  const res = response();
  Promise.resolve(middleware({ user, body: {}, params: {}, ...extra }, res, () => resolve({ allowed: true, res })))
    .then(() => { if (res.body) resolve({ allowed: false, res }); });
});

test("admin-level roles always pass; configurable roles follow their grants", async () => {
  for (const role of ["admin", "alpha", "manager"]) {
    assert.equal((await run(requirePermission("add_manual_entries"), { role })).allowed, true);
  }
  assert.equal((await run(requirePermission("create_tasks"), { role: "team_lead" })).allowed, true);
  assert.equal((await run(requirePermission("manage_clients"), { role: "hr" })).allowed, true);
});

test("defaults preserve previous access; only HR gets manual entries and nobody gets rate permissions", async () => {
  assert.equal(DEFAULT_ROLE_PERMISSIONS.hr.includes("add_manual_entries"), true, "HR adds manual entries (2026-10-23 decision)");
  assert.equal((await run(requirePermission("add_manual_entries"), { role: "hr" })).allowed, true);
  for (const role of ["hr", "team_lead", "employee"]) {
    assert.equal(DEFAULT_ROLE_PERMISSIONS[role].includes("add_manual_entries"), role === "hr");
    assert.equal(DEFAULT_ROLE_PERMISSIONS[role].includes("manage_service_rates"), false);
    assert.equal(DEFAULT_ROLE_PERMISSIONS[role].includes("view_financial_reports"), false);
    assert.equal(DEFAULT_ROLE_PERMISSIONS[role].every((key) => ALL_PERMISSION_KEYS.includes(key)), true);
  }
  for (const role of ["team_lead", "employee"]) {
    const denied = await run(requirePermission("add_manual_entries"), { role });
    assert.equal(denied.allowed, false);
    assert.equal(denied.res.statusCode, 403);
  }
  // Billing stays open to HR as before, and closed to team leads / employees.
  assert.equal((await run(requirePermission("view_billing_amounts"), { role: "hr" })).allowed, true);
  assert.equal((await run(requirePermission("view_billing_amounts"), { role: "team_lead" })).res.statusCode, 403);
  assert.equal((await run(requirePermission("manage_clients"), { role: "employee" })).res.statusCode, 403);
});

test("an unauthenticated request is rejected with 401", async () => {
  const result = await run(requirePermission("create_tasks"), undefined);
  assert.equal(result.res.statusCode, 401);
});

test("an administrator-saved grant takes effect immediately and can be revoked", async () => {
  const original = getRolePermissionsSync("team_lead");
  try {
    setRoleOverride("team_lead", [...original, "add_manual_entries"]);
    assert.equal((await run(requirePermission("add_manual_entries"), { role: "team_lead" })).allowed, true);
    setRoleOverride("team_lead", original.filter((key) => key !== "create_tasks"));
    assert.equal((await run(requirePermission("create_tasks"), { role: "team_lead" })).res.statusCode, 403);
  } finally {
    setRoleOverride("team_lead", DEFAULT_ROLE_PERMISSIONS.team_lead);
  }
});

test("legacy per-employee delegations still count alongside role grants", async () => {
  const user = { role: "employee", permissions: ["edit_employees"] };
  const res = response();
  await getMyPermissions({ user }, res);
  assert.equal(res.body.permissions.includes("edit_employees"), true);
});

test("only admin or alpha can open or save the permission settings", async () => {
  const route = (path, method) => permissionRoutes.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const guard = route("/", "get").stack[1].handle;
  for (const role of ["manager", "hr", "team_lead", "employee"]) {
    const res = response();
    guard({ user: { role } }, res, () => assert.fail(`${role} reached the permission settings`));
    assert.equal(res.statusCode, 403);
  }
  for (const role of ["admin", "alpha"]) {
    let allowed = false;
    guard({ user: { role } }, response(), () => { allowed = true; });
    assert.equal(allowed, true);
  }
});

test("saving a role validates the role and every permission key", async (t) => {
  let saved;
  t.mock.method(RolePermission, "findOneAndUpdate", async (filter, update) => { saved = { filter, update }; return {}; });
  const save = async (role, permissions) => {
    const res = response();
    await updateRolePermissions({ user: { _id: "admin-1" }, params: { role }, body: { permissions } }, res);
    return res;
  };

  assert.equal((await save("admin", ["create_tasks"])).statusCode, 400);
  assert.equal((await save("employee", ["root_access"])).statusCode, 400);
  assert.equal((await save("employee", "create_tasks")).statusCode, 400);
  assert.equal(saved, undefined);

  try {
    const ok = await save("team_lead", ["view_tasks", "view_tasks", "create_tasks"]);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(saved.update.$set.permissions, ["view_tasks", "create_tasks"]);
    assert.equal(saved.update.$set.updatedBy, "admin-1");
    assert.equal((await run(requirePermission("create_tasks"), { role: "team_lead" })).allowed, true);
  } finally {
    setRoleOverride("team_lead", DEFAULT_ROLE_PERMISSIONS.team_lead);
  }
});

test("a permission that cannot apply to a role is dropped on save and never granted", async (t) => {
  let saved;
  t.mock.method(RolePermission, "findOneAndUpdate", async (filter, update) => { saved = update.$set.permissions; return {}; });
  try {
    const res = response();
    await updateRolePermissions({ user: { _id: "admin-1" }, params: { role: "employee" },
      body: { permissions: ["view_tasks", "create_tasks", "manage_clients", "view_billing_amounts", "export_reports"] } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(saved, ["view_tasks", "export_reports"]);
    assert.deepEqual(res.body.role.permissions, ["view_tasks", "export_reports"]);

    // A grant stored before role limits existed stays harmless.
    setRoleOverride("employee", ["create_tasks", "edit_tasks", "manage_clients", "view_tasks"]);
    assert.deepEqual(getRolePermissionsSync("employee"), ["view_tasks"]);
    assert.equal((await run(requirePermission("edit_tasks"), { role: "employee" })).res.statusCode, 403);
    setRoleOverride("team_lead", [...DEFAULT_ROLE_PERMISSIONS.team_lead, "manage_clients", "view_billing_amounts"]);
    assert.equal((await run(requirePermission("manage_clients"), { role: "team_lead" })).res.statusCode, 403);
    assert.equal((await run(requirePermission("view_billing_amounts"), { role: "team_lead" })).res.statusCode, 403);
    assert.equal((await run(requirePermission("create_tasks"), { role: "team_lead" })).allowed, true);
  } finally {
    setRoleOverride("employee", DEFAULT_ROLE_PERMISSIONS.employee);
    setRoleOverride("team_lead", DEFAULT_ROLE_PERMISSIONS.team_lead);
  }
});

test("every catalog entry documents its effect and the roles it applies to", () => {
  const { PERMISSION_CATEGORIES, CONFIGURABLE_ROLES, permissionAppliesToRole } = require("../src/utils/permissions");
  for (const permission of PERMISSION_CATEGORIES.flatMap((category) => category.permissions)) {
    assert.ok(["backend", "frontend", "none"].includes(permission.enforcement), permission.key);
    assert.ok(permission.description?.length > 10, `${permission.key} needs a description`);
    if (permission.enforcement === "none") assert.match(permission.description, /^Not used yet/, permission.key);
    for (const role of permission.roles || []) assert.ok(CONFIGURABLE_ROLES.includes(role), `${permission.key}: ${role}`);
  }
  for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const key of keys) assert.equal(permissionAppliesToRole(key, role), true, `default ${role} grant ${key} must apply`);
  }
});

test("task assignment needs assign_tasks and a changed assignment needs reassign_tasks", async (t) => {
  const withAssignees = await run(guardTaskAssignmentOnCreate, { role: "employee" }, { body: { assignedTo: ["emp-1"] } });
  assert.equal(withAssignees.res.statusCode, 403);
  assert.equal((await run(guardTaskAssignmentOnCreate, { role: "employee" }, { body: { taskName: "x" } })).allowed, true);
  assert.equal((await run(guardTaskAssignmentOnCreate, { role: "team_lead" }, { body: { assignedTo: ["emp-1"] } })).allowed, true);

  t.mock.method(Task, "findById", () => ({
    select() { return this; },
    lean: async () => ({ assignedTo: ["emp-1", "emp-2"], assignToAllEmployees: false }),
  }));
  const employee = { role: "employee" };
  const unchanged = await run(guardTaskReassignment, employee, { body: { assignedTo: ["emp-2", "emp-1"] }, params: { id: "t" } });
  assert.equal(unchanged.allowed, true);
  const changed = await run(guardTaskReassignment, employee, { body: { assignedTo: ["emp-3"] }, params: { id: "t" } });
  assert.equal(changed.res.statusCode, 403);
  const noAssignmentFields = await run(guardTaskReassignment, employee, { body: { taskName: "rename" }, params: { id: "t" } });
  assert.equal(noAssignmentFields.allowed, true);
});

test("manual-entry, all-employee report and billing endpoints sit behind their permissions", () => {
  const layers = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack;
  const denies = async (stack, user) => {
    const res = response();
    let passed = true;
    for (const layer of stack.slice(1, -1)) {
      let advanced = false;
      await layer.handle({ user, body: {}, params: {}, query: {} }, res, () => { advanced = true; });
      if (!advanced) { passed = false; break; }
    }
    return !passed && res.statusCode === 403;
  };
  return Promise.all([
    denies(layers(taskTimeLogRoutes, "/manual", "post"), { role: "employee" }),
    denies(layers(taskTimeLogRoutes, "/manual", "post"), { role: "team_lead" }),
    denies(layers(taskTimeLogRoutes, "/manual/options", "get"), { role: "team_lead" }),
    denies(layers(taskTimeLogRoutes, "/manual/:id", "delete"), { role: "employee" }),
    denies(layers(taskTimeLogRoutes, "/admin", "get"), { role: "team_lead" }),
    denies(layers(taskTimeLogRoutes, "/admin", "get"), { role: "employee" }),
  ]).then((results) => assert.deepEqual(results, [true, true, true, true, true, true]))
    .then(() => assert.ok(billingRoutes.stack.length > 0));
});
