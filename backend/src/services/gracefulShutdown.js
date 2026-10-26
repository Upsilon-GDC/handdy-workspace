// Render stops the old instance with SIGTERM during a deploy. Finish what is in
// flight instead of cutting a stop or heartbeat write in half: refuse new
// connections, let open requests finish (long-polls end within 20 s), stop the
// background jobs, run final tasks, then close MongoDB. Anything still open
// after `timeoutMs` is cut off. Render allows 30 s by default.
function installGracefulShutdown({
  server,
  intervals = [],
  beforeExit = async () => {},
  disconnect = async () => {},
  timeoutMs = 25_000,
  processRef = process,
  exit = (code) => process.exit(code),
  logger = console,
}) {
  let stopping = false;

  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    logger.log(`[shutdown] ${signal}: finishing open requests before exit.`);
    for (const interval of intervals) if (interval) clearInterval(interval);
    const force = setTimeout(() => {
      logger.warn("[shutdown] Open requests did not finish in time; exiting.");
      exit(0);
    }, timeoutMs);
    force.unref?.();
    try {
      await new Promise((resolve) => {
        server.close(() => resolve());
        // Keep-alive connections with no request in flight close at once.
        server.closeIdleConnections?.();
      });
      await beforeExit();
      await disconnect();
    } catch (error) {
      logger.error(`[shutdown] ${error.message}`);
    } finally {
      clearTimeout(force);
      exit(0);
    }
  }

  processRef.once("SIGTERM", () => void stop("SIGTERM"));
  processRef.once("SIGINT", () => void stop("SIGINT"));
  return { stop };
}

module.exports = { installGracefulShutdown };
