import test from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSION_VERSION_HEADER,
  createPermissionVersionTracker,
  notePermissionVersion,
  onPermissionVersion,
} from "../src/api/permissionVersion.js";

test("API responses pass the permissions fingerprint to listeners", () => {
  const seen = [];
  const stop = onPermissionVersion((version) => seen.push(version));
  notePermissionVersion({ [PERMISSION_VERSION_HEADER]: "abc" });
  notePermissionVersion({});
  notePermissionVersion(undefined);
  stop();
  notePermissionVersion({ [PERMISSION_VERSION_HEADER]: "later" });
  assert.deepEqual(seen, ["abc"]);
});

test("permissions reload once when an administrator changes them, never in a loop", () => {
  let reloads = 0;
  const tracker = createPermissionVersionTracker(() => { reloads += 1; });

  tracker.seen("v1");
  assert.equal(reloads, 0, "nothing to compare with before the first load");
  tracker.loaded("v1");
  tracker.seen("v1");
  assert.equal(reloads, 0, "unchanged");

  tracker.seen("v2");
  tracker.seen("v2");
  assert.equal(reloads, 1, "one reload per change, even if several responses carry it");
  tracker.loaded("v2");
  tracker.seen("v2");
  assert.equal(reloads, 1, "the reload's own response does not reload again");

  tracker.loaded("");
  tracker.seen("v2");
  assert.equal(reloads, 1, "a response without a fingerprint keeps the last one");
});
