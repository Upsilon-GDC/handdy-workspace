const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clipTimeLogToRange,
  getRequestedReportRange,
} = require("../src/modules/timers/taskTimeLogController");

test("clips an overnight timer and its pauses to the selected report day", () => {
  const log = {
    _id: "log-1",
    startedAt: new Date("2026-09-21T23:30:00.000Z"),
    stoppedAt: new Date("2026-09-22T01:00:00.000Z"),
    pauses: [{
      pausedAt: new Date("2026-09-22T00:15:00.000Z"),
      resumedAt: new Date("2026-09-22T00:30:00.000Z"),
      reason: "idle",
    }],
    status: "stopped",
    isActiveTimer: false,
  };

  const clipped = clipTimeLogToRange(log, {
    start: new Date("2026-09-22T00:00:00.000Z"),
    endExclusive: new Date("2026-09-23T00:00:00.000Z"),
  }, new Date("2026-09-23T12:00:00.000Z"));

  assert.equal(clipped.startedAt.toISOString(), "2026-09-22T00:00:00.000Z");
  assert.equal(clipped.stoppedAt.toISOString(), "2026-09-22T01:00:00.000Z");
  assert.equal(clipped.totalPausedSeconds, 900);
  assert.equal(clipped.totalIdleSeconds, 900);
  assert.equal(clipped.totalWorkedSeconds, 2700);
});

test("does not double count overlapping pauses in clipped totals", () => {
  const clipped = clipTimeLogToRange({
    startedAt: new Date("2026-09-22T00:00:00.000Z"),
    stoppedAt: new Date("2026-09-22T01:00:00.000Z"),
    pauses: [
      {
        pausedAt: new Date("2026-09-22T00:10:00.000Z"),
        resumedAt: new Date("2026-09-22T00:30:00.000Z"),
        reason: "break",
      },
      {
        pausedAt: new Date("2026-09-22T00:20:00.000Z"),
        resumedAt: new Date("2026-09-22T00:40:00.000Z"),
        reason: "idle",
      },
    ],
    status: "stopped",
  }, {
    start: new Date("2026-09-22T00:00:00.000Z"),
    endExclusive: new Date("2026-09-23T00:00:00.000Z"),
  });

  assert.equal(clipped.totalPausedSeconds, 1800);
  assert.equal(clipped.totalIdleSeconds, 600);
  assert.equal(clipped.totalWorkedSeconds, 1800);
});

test("today reports use the configured company date and clip to its boundaries", () => {
  const { dateKey, range } = getRequestedReportRange(
    { today: "true" },
    new Date("2026-09-28T20:00:00.000Z")
  );

  assert.equal(dateKey, "2026-09-29");
  assert.equal(range.start.toISOString(), "2026-09-28T18:30:00.000Z");
  assert.equal(range.endExclusive.toISOString(), "2026-09-29T18:30:00.000Z");
});
