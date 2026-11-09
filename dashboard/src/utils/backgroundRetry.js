export function retryDelay(failures) {
  return Math.min(30000, 2000 * 2 ** Math.min(10, Math.max(0, failures - 1)));
}

export function waitForRetry(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

// Healthy long-polls keep their usual cadence; only failures back off.
export async function monitorLoginRequests({ signal, read, onRequest, hidden }) {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const response = await read(signal);
      if (signal.aborted) return;
      if (response?.loginRequest) { onRequest(response.loginRequest); return; }
      failures = 0;
      await waitForRetry(hidden() ? 15000 : 1000, signal);
    } catch (error) {
      if (signal.aborted || [401, 403].includes(error?.response?.status)) return;
      await waitForRetry(retryDelay(++failures), signal);
    }
  }
}
