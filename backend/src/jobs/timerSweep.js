const { closeStaleDesktopTimers } = require("../services/desktopTimerLease");
const { countEvent } = require("../monitoring/trafficMetrics");

const SWEEP_INTERVAL_MS = 30_000;
// Three failures in a row means disconnected timers are not being closed.
const FAILURES_BEFORE_ALERT = 3;

// Closes desktop timers whose heartbeats stopped (at their last heartbeat) every
// 30 s, and once at startup for timers left open while the server was down.
// Safe to run again: each close only applies to a still-unchanged timer.
async function startTimerSweep({ intervalMs = SWEEP_INTERVAL_MS, logger = console, sweep = closeStaleDesktopTimers } = {}) {
  let failuresInARow = 0;
  const timer = setInterval(() => {
    sweep()
      .then(() => { failuresInARow = 0; })
      .catch((error) => {
        failuresInARow += 1;
        countEvent("sweep.failed");
        logger.error("Unable to close stale desktop timers:", error);
        if (failuresInARow === FAILURES_BEFORE_ALERT) {
          logger.warn(`[alert] The stale-timer sweep failed ${FAILURES_BEFORE_ALERT} times in a row; disconnected timers are not being closed.`);
        }
      });
  }, intervalMs);
  timer.unref();
  await sweep();
  return timer;
}

module.exports = { SWEEP_INTERVAL_MS, startTimerSweep };
