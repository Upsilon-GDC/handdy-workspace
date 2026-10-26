const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret";

const Employee = require("../src/models/Employee");
const AuthSession = require("../src/models/AuthSession");
const { login, quickLogin } = require("../src/modules/auth/authController");

const PASSWORD = "correct-password";

function fakeEmployee({ role, isActive = true }) {
  return {
    _id: "6a952f26effaab09e60bb7b4",
    fullName: `${role} user`,
    email: `${role}@example.com`,
    role,
    isActive,
    tokenVersion: 0,
    rememberedSessions: [],
    comparePassword: async (candidate) => candidate === PASSWORD,
    save: async () => {},
  };
}

function withEmployee(employee, fn) {
  const original = Employee.findOne;
  const originalSessionMethods = {
    updateMany: AuthSession.updateMany,
    findOne: AuthSession.findOne,
    create: AuthSession.create,
  };
  Employee.findOne = () => ({ select: async () => employee });
  AuthSession.updateMany = async () => ({ modifiedCount: 0 });
  AuthSession.findOne = async () => null;
  AuthSession.create = async (data) => ({ _id: "6a952f26effaab09e60bb7b5", ...data });
  return fn().finally(() => {
    Employee.findOne = original;
    Object.assign(AuthSession, originalSessionMethods);
  });
}

async function call(handler, body) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler({ body }, res);
  return res;
}

for (const role of ["alpha", "admin", "employee", "team_lead", "hr", "manager"]) {
  test(`${role} can log in with valid credentials`, () =>
    withEmployee(fakeEmployee({ role }), async () => {
      const res = await call(login, { email: `${role}@example.com`, password: PASSWORD });
      assert.equal(res.statusCode, 200, res.body?.message);
      assert.ok(res.body.token);
      assert.equal(res.body.user.role, role);
    }));

  test(`${role} can use quick login`, () =>
    withEmployee(fakeEmployee({ role }), async () => {
      const res = await call(quickLogin, { rememberedSessionToken: "remembered-token" });
      assert.equal(res.statusCode, 200, res.body?.message);
      assert.equal(res.body.user.role, role);
    }));
}

test("invalid password is rejected", () =>
  withEmployee(fakeEmployee({ role: "employee" }), async () => {
    const res = await call(login, { email: "employee@example.com", password: "wrong" });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, "Invalid email or password.");
    assert.equal(res.body.token, undefined);
  }));

test("unknown email is rejected", () =>
  withEmployee(null, async () => {
    const res = await call(login, { email: "nobody@example.com", password: PASSWORD });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, "Invalid email or password.");
  }));

test("inactive account is rejected", () =>
  withEmployee(fakeEmployee({ role: "employee", isActive: false }), async () => {
    const res = await call(login, { email: "employee@example.com", password: PASSWORD });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /inactive/i);
    assert.equal(res.body.token, undefined);
  }));
