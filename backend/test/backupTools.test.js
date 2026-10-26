const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");
const { databaseNameFromUri, oldBackups, readCollection, writeCollection } = require("../scripts/backupTools");

test("backups keep ObjectIds, dates, numbers and nested data exactly", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "crm-backup-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const documents = [
    { _id: new mongoose.Types.ObjectId(), employee: new mongoose.Types.ObjectId(), startedAt: new Date("2026-10-26T04:30:00.123Z"),
      totalWorkedSeconds: 3600, rate: 12.5, pauses: [{ pausedAt: new Date("2026-10-26T05:00:00Z"), reason: "break" }], note: "Ünïcode ✓" },
    { _id: new mongoose.Types.ObjectId(), deletedAt: null, isActiveTimer: false },
  ];
  async function* cursor() { yield* documents; }
  const file = path.join(folder, "task_time_logs.jsonl.gz");
  assert.equal(await writeCollection(cursor(), file), 2);
  const restored = [];
  for await (const document of readCollection(file)) restored.push(document);
  assert.equal(restored.length, 2);
  assert.ok(restored[0]._id instanceof mongoose.Types.ObjectId);
  assert.equal(String(restored[0]._id), String(documents[0]._id));
  assert.ok(restored[0].startedAt instanceof Date);
  assert.equal(restored[0].startedAt.getTime(), documents[0].startedAt.getTime());
  // Numbers come back as their exact stored type (whole number vs decimal).
  assert.equal(restored[0].totalWorkedSeconds._bsontype, "Int32");
  assert.equal(restored[0].totalWorkedSeconds.valueOf(), 3600);
  assert.equal(restored[0].rate._bsontype, "Double");
  assert.equal(restored[0].rate.valueOf(), 12.5);
  assert.equal(restored[0].pauses[0].pausedAt.toISOString(), "2026-10-26T05:00:00.000Z");
  assert.equal(restored[0].note, "Ünïcode ✓");
  assert.equal(restored[1].deletedAt, null);
});

test("the live database name is read from the address so restores can refuse it", () => {
  assert.equal(databaseNameFromUri("mongodb+srv://user:pw@cluster0.abc.mongodb.net/crm?retryWrites=true"), "crm");
  assert.equal(databaseNameFromUri("mongodb://localhost:27017/handdy"), "handdy");
  assert.equal(databaseNameFromUri("mongodb+srv://user:pw@cluster0.abc.mongodb.net/?retryWrites=true"), "test");
});

test("--keep removes only the oldest dated backup folders", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-backups-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ["2026-10-24T18-00-00Z", "2026-10-25T18-00-00Z", "2026-10-26T18-00-00Z", "notes"]) fs.mkdirSync(path.join(root, name));
  assert.deepEqual(oldBackups(root, 2).map((folder) => path.basename(folder)), ["2026-10-24T18-00-00Z"]);
  assert.deepEqual(oldBackups(root, 5), []);
});
