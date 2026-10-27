import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUser, permissionOwnerFor } from "../src/utils/authUser.js";

// The shape /auth/me and /auth/login return (backend buildUserResponse).
const apiUser = { id: "6a952f25effaab09e60bb7aa", fullName: "Team Lead", role: "team_lead", permissions: [] };

test("the signed-in user from the API gets an _id, so their permissions are loaded", () => {
  const user = normalizeUser(apiUser);
  assert.equal(user._id, apiUser.id);
  assert.equal(user.id, apiUser.id);
  // Without an owner the dashboard never asked for permissions, and every
  // HR, team lead and employee account looked as if it had none.
  assert.equal(permissionOwnerFor(user, "token-1"), `${apiUser.id}:token-1`);
  assert.equal(permissionOwnerFor(user, null), "", "signed out");
});

test("users stored before the fix, and role spellings, are normalized too", () => {
  assert.equal(normalizeUser({ _id: "a", role: "Team Lead" })._id, "a");
  assert.equal(normalizeUser({ _id: "a", role: "Team Lead" }).role, "team_lead");
  assert.equal(normalizeUser({ id: "b", role: "Administrator" }).role, "admin");
  assert.equal(normalizeUser(null), null);
  assert.equal("_id" in normalizeUser({ role: "employee" }), false, "no id, nothing invented");
});
