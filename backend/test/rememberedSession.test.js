const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRememberedSession,
  hashRememberedSession,
  revokeRememberedSession,
} = require("../src/utils/rememberedSessionUtils");

test("remembered sessions use opaque random tokens and persist only a hash", () => {
  const first = createRememberedSession();
  const second = createRememberedSession();
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.token, first.tokenHash);
  assert.equal(hashRememberedSession(first.token), first.tokenHash);
  assert.ok(first.expiresAt.getTime() > Date.now());
});

test("sign-out atomically revokes only the remembered credential presented by that device", async () => {
  const first = createRememberedSession();
  const updates = [];
  const EmployeeModel = {
    async updateOne(filter, update) { updates.push({ filter, update }); },
  };

  await revokeRememberedSession(EmployeeModel, "employee-1", first.token);
  assert.deepEqual(updates, [
    {
      filter: { _id: "employee-1" },
      update: { $pull: { rememberedSessions: { tokenHash: first.tokenHash } } },
    },
    {
      filter: { _id: "employee-1", rememberedSessionTokenHash: first.tokenHash },
      update: { $set: { rememberedSessionTokenHash: null, rememberedSessionExpires: null } },
    },
  ]);
});

test("logout ends the device session before revoking the remembered credential", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret";
  const Employee = require("../src/models/Employee");
  const AuthSession = require("../src/models/AuthSession");
  const DeviceLoginRequest = require("../src/models/DeviceLoginRequest");
  const { logout } = require("../src/modules/auth/authController");

  const calls = [];
  const originals = [
    [Employee, "updateOne", Employee.updateOne],
    [AuthSession, "updateOne", AuthSession.updateOne],
    [DeviceLoginRequest, "updateMany", DeviceLoginRequest.updateMany],
  ];
  AuthSession.updateOne = async () => { calls.push("session"); };
  DeviceLoginRequest.updateMany = async () => { calls.push("requests"); };
  Employee.updateOne = async () => {
    calls.push("remembered");
    throw new Error("database unavailable");
  };

  try {
    await assert.rejects(
      logout(
        { user: { _id: "employee-1" }, authSession: { _id: "session-1" }, body: { rememberedSessionToken: "remember-me" } },
        { status() { return this; }, json() { return this; } },
      ),
      /database unavailable/,
    );
    assert.deepEqual(calls, ["session", "requests", "remembered"]);
  } finally {
    for (const [model, key, original] of originals) model[key] = original;
  }
});
