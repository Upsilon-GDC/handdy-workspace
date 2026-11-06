import { useEffect, useRef } from "react";

// Refresh management data every five minutes while visible. Manual refresh,
// returning to the tab and reconnecting can still request an earlier update.
const DEFAULT_REFRESH_MS = 5 * 60_000;

export default function useDataRefresh(refresh, intervalMs = DEFAULT_REFRESH_MS, enabled = true) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    // Guards against a timer/event tick that fires (or was already in
    // flight) right as the component unmounts — once unmounted, no new
    // invocation of the consumer's refresh callback is allowed, so it can
    // never set state on an unmounted component from a race like that.
    const mountedRef = { current: true };
    let refreshing = false;
    const run = async () => {
      if (!mountedRef.current || refreshing || document.visibilityState !== "visible") return;
      refreshing = true;
      try {
        await refreshRef.current?.();
      } finally {
        refreshing = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(run, intervalMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
