// Diagnostic attribution only. Identity comes from authenticated server context,
// never from a request's employee/name headers or payload. No extra DB reads.
const MAX_ROWS = 2000;
const MAX_ROUTES = 64;
const versions = new Map();
const versionPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[A-Za-z0-9.-]{1,24})?$/;
const clean = (value, limit) => String(value || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, limit);
const validVersion = value => typeof value === 'string' && versionPattern.test(value) ? value : null;

function requestEmployee(req) {
  const user = req.user, session = req.authSession;
  if (!user?._id || !session || String(session.employee) !== String(user._id)) return null;
  const client = session.clientType === 'desktop' ? 'desktop' : session.clientType === 'web' ? 'web' : 'unknown';
  const sessionKey = `${user._id}:${session._id}`;
  let version = 'web';
  if (client !== 'web') {
    const reported = req.method === 'POST' && req.originalUrl?.split('?')[0] === '/api/time-logs/heartbeat'
      ? validVersion(req.body?.appVersion) : null;
    const agentVersion = validVersion(/(?:^|\s)(?:CRM|handdy-desktop-app)\/([^\s]+)/i.exec(req.headers?.['user-agent'] || '')?.[1]);
    version = reported || agentVersion || versions.get(sessionKey) || 'unknown';
    if (version !== 'unknown') {
      if (!versions.has(sessionKey) && versions.size >= MAX_ROWS) versions.delete(versions.keys().next().value);
      versions.set(sessionKey, version);
    }
  }
  return { key: `${user._id}:${client}:${version}`, employeeId: clean(user.employeeId, 64),
    employeeName: clean(user.fullName, 120), client, appVersion: version };
}

function recordEmployee(bucket, employee, { route, status, requestBytes, responseBytes }) {
  if (!employee) return;
  if (!bucket.employees.has(employee.key)) {
    if (bucket.employees.size >= MAX_ROWS) { bucket.employeeLimitReached = true; return; }
    bucket.employees.set(employee.key, { ...employee, requests: 0, requestBytes: 0, responseBytes: 0,
      errors: 0, firstSeenAt: new Date(), lastSeenAt: new Date(), routes: new Map() });
  }
  const row = bucket.employees.get(employee.key);
  row.requests++; row.requestBytes += requestBytes; row.responseBytes += responseBytes;
  if (status >= 400) row.errors++;
  row.lastSeenAt = new Date();
  const routeKey = row.routes.has(route) || row.routes.size < MAX_ROUTES ? route : 'other routes';
  const entry = row.routes.get(routeKey) || { requests: 0, responseBytes: 0 };
  entry.requests++; entry.responseBytes += responseBytes; row.routes.set(routeKey, entry);
}

function employeeReport(bucket) {
  const mb = bytes => Number((bytes / 1_000_000).toFixed(4));
  const rows = [...bucket.employees.values()].sort((a, b) => b.responseBytes - a.responseBytes);
  return { limitReached: bucket.employeeLimitReached === true,
    attributedRequests: rows.reduce((sum, row) => sum + row.requests, 0),
    unattributedRequests: [...bucket.routes.values()].reduce((sum, row) => sum + row.count, 0) - rows.reduce((sum, row) => sum + row.requests, 0),
    rows: rows.map(row => ({ employeeId: row.employeeId, employeeName: row.employeeName, client: row.client,
      appVersion: row.appVersion, requests: row.requests, errors: row.errors,
      requestBodyBytes: row.requestBytes, responseBodyBytes: row.responseBytes,
      requestBodyMB: mb(row.requestBytes), responseBodyMB: mb(row.responseBytes),
      averageResponseKB: Number((row.responseBytes / row.requests / 1000).toFixed(3)),
      firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt,
      topRoutes: [...row.routes].sort(([, a], [, b]) => b.responseBytes - a.responseBytes).slice(0, 5)
        .map(([route, entry]) => ({ route, requests: entry.requests, responseBodyMB: mb(entry.responseBytes) })),
    })) };
}

module.exports = { requestEmployee, recordEmployee, employeeReport, resetEmployeeVersions: () => versions.clear() };
