import test from "node:test";
import assert from "node:assert/strict";
import { createReportLoader } from "../src/utils/reportLoader.js";

const marker = { since: new Date().toISOString(), scope: "scope", references: "references" };
const initialRows = Array.from({ length: 205 }, (_, index) => ({ _id: String(index), startedAt: "2026-10-01T04:00Z", status: "running" }));

test("background refresh fetches only changed rows and merges stops, new sessions and removals", async () => {
  const requests = [];
  let changed = false;
  const load = createReportLoader(async (_path, params) => {
    requests.push(params);
    if (changed) return { delta: true, sync: marker, removedIds: ["1"], timeLogs: [
      { ...initialRows[0], status: "stopped", totalWorkedSeconds: 60 },
      { _id: "new", startedAt: "2026-10-02T04:00Z", status: "running" },
    ] };
    return { sync: marker, totalPages: 3, timeLogs: initialRows.slice((params.page - 1) * 100, params.page * 100) };
  });
  const first = await load("/time-logs/my", "timeLogs");
  assert.equal(first.timeLogs.length, 205);
  changed = true;
  const next = await load("/time-logs/my", "timeLogs", {}, { force: false });
  assert.equal(requests.length, 4);
  assert.equal(requests[3].syncSince, marker.since);
  assert.equal(next.timeLogs.length, 205);
  assert.equal(next.timeLogs[0]._id, "new");
  assert.equal(next.timeLogs.find((row) => row._id === "0").status, "stopped");
  assert.equal(next.timeLogs.some((row) => row._id === "1"), false);
  assert.equal(first.timeLogs[0].status, "running", "refresh must not mutate the currently displayed report");
});

test("manual refresh, changed filters, and changed sessions request a full report", async () => {
  const requests = [];
  let session = "first-token";
  const load = createReportLoader(async (_path, params) => { requests.push(params); return { sync: marker, attendance: [{ _id: "day", date: "2026-10-01" }] }; }, () => session);
  await load("/attendance", "attendance", { startDate: "2026-10-01" });
  await load("/attendance", "attendance", { startDate: "2026-10-01" });
  await load("/attendance", "attendance", { startDate: "2026-10-02" }, { force: false });
  session = "second-token";
  await load("/attendance", "attendance", { startDate: "2026-10-01" }, { force: false });
  for (const params of requests) assert.equal(params.syncSince, undefined);
});

test("older servers still paginate completely on every background refresh", async () => {
  let requests = 0;
  const load = createReportLoader(async (_path, params) => {
    requests += 1;
    return { timeLogs: [{ _id: String(params.page) }], totalPages: 2 };
  });
  await load("/old", "timeLogs");
  const next = await load("/old", "timeLogs", {}, { force: false });
  assert.equal(requests, 4);
  assert.deepEqual(next.timeLogs.map((row) => row._id), ["1", "2"]);
});

test("a renamed/deleted task forces a full replacement and drops stale cached records", async () => {
  let generation = 0;
  const load = createReportLoader(async (_path, params) => generation++ === 0
    ? { sync: marker, timeLogs: [{ _id: "old", task: { taskName: "Old name" } }] }
    : (assert.equal(params.syncReferences, "references"), { sync: { ...marker, references: "new-references" }, timeLogs: [{ _id: "new", task: { taskName: "Renamed" } }] }));
  await load("/rename", "timeLogs");
  const next = await load("/rename", "timeLogs", {}, { force: false });
  assert.deepEqual(next.timeLogs.map((row) => row._id), ["new"]);
  assert.equal(next.timeLogs[0].task.taskName, "Renamed");
});

test("failed later pages cannot replace a complete cached report with partial data", async () => {
  let stage = "initial";
  const load = createReportLoader(async (_path, params) => {
    if (stage === "initial") return { sync: marker, timeLogs: [{ _id: "complete" }] };
    if (stage === "failed") {
      if (params.page === 2) throw new Error("offline");
      return { sync: marker, totalPages: 2, timeLogs: [{ _id: "partial" }] };
    }
    return { sync: marker, delta: true, timeLogs: [] };
  });
  await load("/failure", "timeLogs");
  stage = "failed";
  await assert.rejects(load("/failure", "timeLogs"), /offline/);
  stage = "recover";
  const recovered = await load("/failure", "timeLogs", {}, { force: false });
  assert.deepEqual(recovered.timeLogs.map((row) => row._id), ["complete"]);
});

test("concurrent background refreshes share a request and logout rejects late results", async () => {
  let session = "original";
  let resolve;
  let calls = 0;
  const load = createReportLoader(() => { calls += 1; return new Promise((done) => { resolve = done; }); }, () => session);
  const one = load("/concurrent", "timeLogs", {}, { force: false });
  const two = load("/concurrent", "timeLogs", {}, { force: false });
  assert.equal(calls, 1);
  session = "changed";
  resolve({ timeLogs: [], sync: marker });
  const result = await Promise.allSettled([one, two]);
  assert.ok(result.every((item) => item.status === "rejected"));
});

test("five-minute reconciliation replaces delta caches to recover missed deletions", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const requests = [];
  const load = createReportLoader(async (_path, params) => { requests.push(params); return { sync: marker, timeLogs: [] }; });
  await load("/reconcile", "timeLogs");
  t.mock.timers.tick(5 * 60000);
  await load("/reconcile", "timeLogs", {}, { force: false });
  assert.equal(requests[1].syncSince, undefined);
});

// Phase 2 (2.2): delta copies proven complete by the server's fingerprint.
const stamped = (id, updatedAt, extra = {}) => ({ _id: id, startedAt: "2026-10-01T04:00:00.000Z", updatedAt, status: "stopped", ...extra });

test("the copy fingerprint counts rows and change-seconds, leaving out active timers", async () => {
  const { reportChecksum } = await import("../src/utils/reportLoader.js");
  const rows = [
    stamped("a", "2026-10-01T04:00:00.900Z"),
    stamped("b", "2026-10-01T05:00:01.000Z"),
    stamped("live", "2026-10-01T06:00:00.000Z", { status: "running" }),
    { _id: "legacy" },
  ];
  const expected = Math.floor(Date.parse(rows[0].updatedAt) / 1000) + Math.floor(Date.parse(rows[1].updatedAt) / 1000);
  assert.deepEqual(reportChecksum(rows, ["live"]), { count: 3, seconds: expected }, "rows without updatedAt count but add nothing");
});

test("a matching fingerprint keeps an open report on deltas past five minutes, with an hourly full reload", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { reportChecksum } = await import("../src/utils/reportLoader.js");
  const rows = [stamped("1", "2026-10-01T04:10:00.000Z"), stamped("2", "2026-10-01T04:20:00.000Z")];
  const requests = [];
  const load = createReportLoader(async (_path, params) => {
    requests.push(params);
    if (!params.syncSince) return { sync: marker, totalPages: 1, timeLogs: rows };
    return { delta: true, sync: marker, removedIds: [], timeLogs: [], checksum: { ...reportChecksum(rows), activeIds: [] } };
  });
  await load("/time-logs/admin", "timeLogs");
  assert.equal(requests[0].checksum, "true", "the loader asks for the fingerprint");
  for (let minute = 0; minute < 55; minute += 1) {
    t.mock.timers.tick(60_000);
    await load("/time-logs/admin", "timeLogs", {}, { force: false });
  }
  assert.equal(requests.filter((params) => !params.syncSince).length, 1, "no full reload for 55 minutes");
  t.mock.timers.tick(5 * 60_000);
  await load("/time-logs/admin", "timeLogs", {}, { force: false });
  assert.equal(requests.at(-1).syncSince, undefined, "full reload after an hour");
});

test("a fingerprint mismatch falls back to the five-minute full reload", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const rows = [stamped("1", "2026-10-01T04:10:00.000Z")];
  const requests = [];
  const load = createReportLoader(async (_path, params) => {
    requests.push(params);
    if (!params.syncSince) return { sync: marker, totalPages: 1, timeLogs: rows };
    // The server has a row this copy never received.
    return { delta: true, sync: marker, removedIds: [], timeLogs: [], checksum: { count: 2, seconds: 1, activeIds: [] } };
  });
  await load("/time-logs/admin", "timeLogs");
  t.mock.timers.tick(4 * 60_000);
  await load("/time-logs/admin", "timeLogs", {}, { force: false });
  assert.equal(requests.at(-1).syncSince, marker.since, "still a delta within five minutes");
  t.mock.timers.tick(60_000);
  await load("/time-logs/admin", "timeLogs", {}, { force: false });
  assert.equal(requests.at(-1).syncSince, undefined, "unproven copy is fully reloaded as before");
});
