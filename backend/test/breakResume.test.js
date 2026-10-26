const test = require("node:test");
const assert = require("node:assert/strict");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const { resumeTimer } = require("../src/modules/timers/taskTimeLogController");

test("End Break closes the existing pause without replacing history or inserting records", async () => {
  const original = TaskTimeLog.findOneAndUpdate;
  const originalFind = TaskTimeLog.find;
  TaskTimeLog.find = () => ({ lean: async () => [] });
  let updates = 0;
  TaskTimeLog.findOneAndUpdate = async (filter, update, options) => {
    assert.equal(filter.status, "paused");
    assert.equal(filter.pauses.$elemMatch.resumedAt, null);
    assert.deepEqual(filter.pauses.$elemMatch.reason, { $in: ["break", "manual"] });
    assert.deepEqual(Object.keys(update), ["$set"]);
    assert.deepEqual(Object.keys(update.$set).sort(), ["pauses.$[elem].resumedAt", "status"]);
    assert.ok(update.$set["pauses.$[elem].resumedAt"] instanceof Date);
    assert.equal(update.$set.status, "running");
    assert.equal(options.arrayFilters[0]["elem.resumedAt"], null);
    assert.equal(options.returnDocument, "after");
    assert.equal(options.upsert, undefined);
    return updates++ === 0 ? { status: "running" } : null;
  };
  try {
    const call = async () => {
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await resumeTimer({ user: { _id: "employee" }, body: { reason: "break" } }, res);
      return res;
    };
    assert.equal((await call()).code, 200);
    assert.equal((await call()).code, 404);
  } finally {
    TaskTimeLog.findOneAndUpdate = original;
    TaskTimeLog.find = originalFind;
  }
});
