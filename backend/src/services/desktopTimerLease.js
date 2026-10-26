const TaskTimeLog = require("../models/TaskTimeLog");
const { recordAttendanceActivity } = require("./attendanceService");
const { countEvent } = require("../monitoring/trafficMetrics");

const HEARTBEAT_TIMEOUT_MS = 90_000;
const sweeps = new Map();

function stoppedValues(log, stoppedAt) {
  const pauses = (log.pauses || []).map((pause) => ({
    pausedAt: pause.pausedAt,
    resumedAt: pause.resumedAt || stoppedAt,
    reason: pause.reason,
  }));
  const totalPausedSeconds = pauses.reduce((sum, pause) =>
    sum + Math.max(0, Math.floor((pause.resumedAt - pause.pausedAt) / 1000)), 0);
  const totalIdleSeconds = pauses.reduce((sum, pause) =>
    sum + (pause.reason === "idle"
      ? Math.max(0, Math.floor((pause.resumedAt - pause.pausedAt) / 1000)) : 0), 0);
  const elapsedSeconds = Math.max(0, Math.floor((stoppedAt - log.startedAt) / 1000));
  return {
    pauses,
    stoppedAt,
    status: "stopped",
    isActiveTimer: false,
    stopReason: "desktop_disconnected",
    totalPausedSeconds,
    totalIdleSeconds,
    totalWorkedSeconds: Math.max(0, elapsedSeconds - totalPausedSeconds),
  };
}

async function sweepStaleDesktopTimers(now, employeeId) {
  const cutoff = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS);
  const filter = {
    isActiveTimer: true,
    status: { $in: ["running", "paused"] },
    desktopHeartbeatAt: { $type: "date", $lte: cutoff },
    ...(employeeId ? { employee: employeeId } : {}),
  };
  countEvent(employeeId ? "sweep.employee" : "sweep.all");
  const stale = await TaskTimeLog.find(filter).lean();
  let closed = 0;
  for (const log of stale) {
    const result = await TaskTimeLog.updateOne(
      { _id: log._id, isActiveTimer: true, status: log.status, desktopHeartbeatAt: log.desktopHeartbeatAt },
      { $set: stoppedValues(log, log.desktopHeartbeatAt) },
    );
    closed += result.modifiedCount || 0;
    if (result.modifiedCount) {
      countEvent("sweep.closed");
      await recordAttendanceActivity(log.employee, log.startedAt);
      // The server only knows the heartbeats stopped, not why (app crash,
      // shutdown/sleep, lost internet, server outage or an expired session all
      // look identical), so log the facts without claiming a cause. IDs only:
      // no tokens, names or note text.
      console.warn("[timer-lease] closed timer after missed desktop heartbeats", JSON.stringify({
        timeLog: String(log._id),
        employee: String(log.employee),
        state: log.status,
        lastHeartbeatAt: log.desktopHeartbeatAt,
        silentSeconds: Math.round((now.getTime() - new Date(log.desktopHeartbeatAt).getTime()) / 1000),
        timeoutSeconds: HEARTBEAT_TIMEOUT_MS / 1000,
      }));
    }
  }
  return closed;
}

function closeStaleDesktopTimers(now = new Date(), employeeId = null) {
  // Coalesce identical concurrent checks without caching completed sweeps or
  // relaxing the 90-second lease boundary for subsequent timer actions.
  const key = `${employeeId || "all"}:${now.getTime()}`;
  if (sweeps.has(key)) return sweeps.get(key);
  const pending = sweepStaleDesktopTimers(now, employeeId).finally(() => {
    if (sweeps.get(key) === pending) sweeps.delete(key);
  });
  sweeps.set(key, pending);
  return pending;
}

module.exports = { closeStaleDesktopTimers, HEARTBEAT_TIMEOUT_MS, stoppedValues };
