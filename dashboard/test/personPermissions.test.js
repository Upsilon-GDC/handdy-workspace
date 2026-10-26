import test from "node:test";
import assert from "node:assert/strict";
import {
  clearPersonPermission,
  countOverrideChanges,
  effectivePersonPermissions,
  overrideCount,
  overrideState,
  setPersonPermission,
} from "../src/utils/personPermissions.js";

const role = ["create_tasks", "edit_tasks", "export_reports"];
const applicable = ["create_tasks", "edit_tasks", "export_reports", "add_manual_entries"];

test("a person has their role's switches plus personal on, minus personal off", () => {
  assert.deepEqual(effectivePersonPermissions(role, undefined, applicable), role);
  const overrides = { granted: ["add_manual_entries", "manage_clients"], revoked: ["create_tasks"] };
  assert.deepEqual(effectivePersonPermissions(role, overrides, applicable),
    ["edit_tasks", "export_reports", "add_manual_entries"], "manage_clients cannot apply to this role");
  assert.equal(overrideState(overrides, "create_tasks"), "off");
  assert.equal(overrideState(overrides, "add_manual_entries"), "on");
  assert.equal(overrideState(overrides, "edit_tasks"), null);
});

test("switching back to the role's value leaves no personal setting", () => {
  let overrides = { granted: [], revoked: [] };
  overrides = setPersonPermission(overrides, "create_tasks", false, role);
  assert.deepEqual(overrides, { granted: [], revoked: ["create_tasks"] });
  overrides = setPersonPermission(overrides, "add_manual_entries", true, role);
  assert.equal(overrideCount(overrides), 2);
  overrides = setPersonPermission(overrides, "create_tasks", true, role);
  overrides = setPersonPermission(overrides, "add_manual_entries", false, role);
  assert.deepEqual(overrides, { granted: [], revoked: [] });
});

test("one switch can be handed back to the role and changes are counted per switch", () => {
  const before = { granted: ["add_manual_entries"], revoked: ["create_tasks"] };
  const after = clearPersonPermission(before, "create_tasks");
  assert.deepEqual(after, { granted: ["add_manual_entries"], revoked: [] });
  assert.equal(countOverrideChanges(before, after), 1);
  assert.equal(countOverrideChanges(before, { granted: ["create_tasks"], revoked: [] }), 2);
  assert.equal(countOverrideChanges(before, before), 0);
});
