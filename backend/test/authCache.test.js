const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const Employee = require("../src/models/Employee");
const AuthSession = require("../src/models/AuthSession");
const { protect } = require("../src/middleware/authMiddleware");
const { clearAuthCache } = require("../src/services/authCache");
const { PERMISSION_VERSION_HEADER, setRoleOverride } = require("../src/services/permissionService");

const response = () => ({
  statusCode: 200,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  json(body) { this.body = body; return this; },
});
const query = (value) => ({ select: async () => value });
const baseUser = { _id: "emp-1", isActive: true, tokenVersion: 0, role: "employee" };

const setup = (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-auth-cache-test-secret";
  clearAuthCache();
  t.after(() => {
    clearAuthCache();
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  });
  const token = jwt.sign({ employeeId: "emp-1", tokenVersion: 0, sessionId: "s1", deviceId: "d1" }, process.env.JWT_SECRET);
  return { headers: { authorization: `Bearer ${token}` } };
};

test("repeated requests reuse the cached employee and session instead of re-reading Atlas", async (t) => {
  const req = setup(t);
  let employeeReads = 0;
  let sessionReads = 0;
  t.mock.method(Employee, "findById", () => { employeeReads += 1; return query({ ...baseUser }); });
  t.mock.method(AuthSession, "findOne", async () => { sessionReads += 1; return { _id: "s", lastActivity: new Date(), expiresAt: new Date(Date.now() + 60_000) }; });
  for (let i = 0; i < 5; i += 1) {
    let ok = false;
    await protect({ headers: req.headers }, response(), () => { ok = true; });
    assert.equal(ok, true);
  }
  assert.equal(employeeReads, 1);
  assert.equal(sessionReads, 1);
});

test("every response carries a fingerprint of the person's permissions, which changes with them", async (t) => {
  const req = setup(t);
  let person = { ...baseUser };
  t.mock.method(Employee, "findById", () => query(person));
  t.mock.method(AuthSession, "findOne", async () => ({ _id: "s", lastActivity: new Date(), expiresAt: new Date(Date.now() + 60_000) }));
  const versionNow = async () => {
    clearAuthCache();
    const res = response();
    await protect({ headers: req.headers }, res, () => {});
    return res.headers[PERMISSION_VERSION_HEADER];
  };

  const first = await versionNow();
  assert.match(first, /^[\w-]{12}$/);
  assert.equal(await versionNow(), first, "unchanged permissions keep the fingerprint");

  person = { ...baseUser, permissionOverrides: { granted: ["create_tasks"] } };
  const personal = await versionNow();
  assert.notEqual(personal, first, "a personal exception changes it");

  t.after(() => setRoleOverride("employee", require("../src/utils/permissions").DEFAULT_ROLE_PERMISSIONS.employee));
  setRoleOverride("employee", ["view_tasks"]);
  assert.notEqual(await versionNow(), personal, "a role change changes it");
});

test("clearing the cache (what any Employee/AuthSession write does) forces a fresh check", async (t) => {
  const req = setup(t);
  let revoked = false;
  t.mock.method(Employee, "findById", () => query({ ...baseUser }));
  t.mock.method(AuthSession, "findOne", async () => (revoked ? null
    : { _id: "s", lastActivity: new Date(), expiresAt: new Date(Date.now() + 60_000) }));
  await protect({ headers: req.headers }, response(), () => {});
  revoked = true;
  const stillCached = response();
  let passed = false;
  await protect({ headers: req.headers }, stillCached, () => { passed = true; });
  assert.equal(passed, true, "within the short TTL a cached session is still honoured");
  clearAuthCache();
  const after = response();
  await protect({ headers: req.headers }, after, () => assert.fail("revoked session must not authenticate"));
  assert.equal(after.statusCode, 401);
  assert.equal(after.body.code, "SESSION_REVOKED");
});

test("the plugin clears the cache after writes, except explicitly skipped ones, and both models use it", () => {
  const mongoose = require("mongoose");
  const { authCachePlugin, getAuthEntry, setAuthEntry } = require("../src/services/authCache");
  for (const Model of [Employee, AuthSession]) {
    assert.ok(Model.schema.plugins.some((plugin) => plugin.fn === authCachePlugin), `${Model.modelName} uses authCachePlugin`);
  }
  const schema = new mongoose.Schema({});
  authCachePlugin(schema);
  const hooks = schema.s.hooks._posts.get("updateOne");
  assert.ok(hooks.length > 0);
  setAuthEntry("e", "s", "d", { employee: {}, authSession: {}, touchedAt: 0 });
  for (const hook of hooks) hook.fn.call({ getOptions: () => ({ skipAuthCacheClear: true }) });
  assert.ok(getAuthEntry("e", "s", "d"), "skipped writes keep the cache");
  for (const hook of hooks) hook.fn.call({ getOptions: () => ({}) });
  assert.equal(getAuthEntry("e", "s", "d"), null);
  clearAuthCache();
});
