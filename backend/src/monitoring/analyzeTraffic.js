// Offline analysis only. No database, environment-file or network access.
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
const total = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0);
const rank = (rows, field) => rows.sort((a, b) => b[field] - a[field]);

function readMeasurements(contents) {
  const measurements = [], seen = new Set(), warnings = [];
  let duplicates = 0, malformed = 0, informational = 0;
  const add = (data, source) => {
    const snapshot = data?.metrics || (data?.total ? data : null);
    const bucket = snapshot ? snapshot.total : data;
    if (!bucket || !Array.isArray(bucket.routes) || !Array.isArray(bucket.db)
      || typeof bucket.startedAt !== 'string' || !Number.isFinite(Date.parse(bucket.startedAt))) {
      malformed += 1; warnings.push(`Unrecognized metrics structure at ${source}.`); return;
    }
    const kind = snapshot ? 'snapshot' : 'window';
    const measurement = { kind, ...bucket, destinations: snapshot?.destinations || data.destinations || {},
      periodStart: snapshot?.since || bucket.startedAt };
    const signature = JSON.stringify(measurement);
    if (seen.has(signature)) { duplicates += 1; return; }
    seen.add(signature); measurements.push(measurement);
  };
  contents.forEach((content, index) => {
    let parsed;
    try { parsed = JSON.parse(content); } catch { /* Ordinary exported log text. */ }
    if (parsed?.metrics || parsed?.total) { add(parsed, `file ${index + 1}`); return; }
    content.split(/\r?\n/).forEach((line, lineIndex) => {
      const marker = line.indexOf('[metrics]');
      if (marker < 0) return;
      const body = line.slice(marker + '[metrics]'.length).trim();
      if (!body.startsWith('{')) { informational += 1; return; }
      try { add(JSON.parse(body), `file ${index + 1}, line ${lineIndex + 1}`); }
      catch { malformed += 1; warnings.push(`Incomplete or invalid metrics JSON at file ${index + 1}, line ${lineIndex + 1}.`); }
    });
  });
  if (!measurements.length) throw new Error('No usable measurements found. Export full [metrics] JSON log entries or the admin /api/metrics response; screenshots and startup messages do not contain the counters.');
  if (measurements.some(row => row.kind === 'snapshot') && measurements.length > 1) {
    throw new Error('Analyse one cumulative /api/metrics snapshot on its own. Combining snapshots or mixing snapshots with log windows can double-count traffic.');
  }
  const starts = new Set();
  for (const row of measurements) {
    if (starts.has(row.periodStart)) throw new Error('Different measurements have the same start time. Remove overlapping exports before analysis.');
    starts.add(row.periodStart);
  }
  return { measurements, warnings, duplicates, malformed, informational };
}

function analyzeTraffic(contents, { employeeHours } = {}) {
  if (employeeHours !== undefined && (!(employeeHours > 0) || !Number.isFinite(employeeHours))) throw new Error('Employee-hours must be a positive number.');
  const parsed = readMeasurements(contents), routes = new Map(), db = new Map(), destinations = new Map(), events = new Map();
  const entry = (map, key, initial) => { if (!map.has(key)) map.set(key, { key, ...initial }); return map.get(key); };
  for (const measurement of parsed.measurements) {
    for (const source of measurement.routes) {
      if (!source || typeof source.key !== 'string') continue;
      const row = entry(routes, source.key, { count: 0, responseBytes: 0, requestBytes: 0, failures: 0, notModified: 0, durationMs: 0 });
      row.count += number(source.count); row.responseBytes += number(source.responseBytes); row.requestBytes += number(source.requestBytes);
      row.failures += number(source.status?.['5xx']); row.notModified += number(source.status?.['304']);
      row.durationMs += number(source.avgMs) * number(source.count);
    }
    for (const source of measurement.db) {
      if (!source || typeof source.key !== 'string') continue;
      const row = entry(db, source.key, { count: 0, sentBytes: 0, replyBytes: 0, failed: 0 });
      for (const field of ['count', 'sentBytes', 'replyBytes', 'failed']) row[field] += number(source[field]);
    }
    for (const [key, source] of Object.entries(measurement.destinations)) {
      const row = entry(destinations, key, { connections: 0, sentBytes: 0, receivedBytes: 0 });
      for (const field of ['connections', 'sentBytes', 'receivedBytes']) row[field] += number(source?.[field]);
    }
    for (const [key, value] of Object.entries(measurement.events || {})) events.set(key, (events.get(key) || 0) + number(value));
  }
  const destinationRows = [...destinations.values()];
  const external = destinationRows.filter(row => row.key !== 'http-clients');
  return {
    kind: parsed.measurements[0].kind, measurements: parsed.measurements.length,
    firstStart: parsed.measurements.map(row => row.periodStart).sort()[0],
    lastStart: parsed.measurements.map(row => row.periodStart).sort().at(-1),
    duplicatesSkipped: parsed.duplicates, malformedSkipped: parsed.malformed, informationalSkipped: parsed.informational,
    warnings: parsed.warnings,
    routesByBytes: rank([...routes.values()].map(row => ({ ...row, avgMs: row.count ? Math.round(row.durationMs / row.count) : 0 })), 'responseBytes'),
    routesByRequests: rank([...routes.values()], 'count'), dbByCommands: rank([...db.values()], 'count'),
    dbBySentBytes: rank([...db.values()], 'sentBytes'), destinations: rank(destinationRows, 'sentBytes'), events: Object.fromEntries(events),
    totals: { observedRequests: total([...routes.values()], 'count'), observedResponseBytes: total([...routes.values()], 'responseBytes'),
      observed5xx: total([...routes.values()], 'failures'), externalSentBytes: total(external, 'sentBytes'), externalReceivedBytes: total(external, 'receivedBytes') },
    employeeHours: employeeHours || null,
    externalSentMBPerEmployeeHour: employeeHours ? total(external, 'sentBytes') / 1_000_000 / employeeHours : null,
  };
}

const escape = value => String(value).replace(/[|\n\r]/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mb = value => (value / 1_000_000).toFixed(3);
function renderReport(data) {
  const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.map(escape).join(' | ')} |`).join('\n');
  return [
    '# CRM traffic baseline',
    `Source: ${data.measurements} ${data.kind} measurement(s). First start: ${data.firstStart}; last start: ${data.lastStart}. These are measurement start times, not a claim of complete daily coverage.`,
    `Skipped: ${data.duplicatesSkipped} duplicate measurements, ${data.malformedSkipped} malformed records, ${data.informationalSkipped} informational lines.`,
    '## Coverage and interpretation',
    '- Log entries contain only the top 15 routes by response bytes and top 15 database commands by count per window. Snapshot exports also have a limit. Route/command totals below are observed lower bounds; omitted rows are not zero.',
    '- Route bytes are response bodies after HTTP compression, excluding headers. Database command sizes are approximate uncompressed BSON. Destination counters measure application socket traffic and exclude some transport overhead.',
    '- Sent and received traffic are separate. Incoming database replies are not added to outbound totals. The http-clients destination is excluded from the external-service subtotal to avoid mixing HTTP responses with service-initiated traffic.',
    '- External destination totals can include local or internal destinations; verify which are public before comparing with Render billing. A 5xx response or reconnect is a diagnostic signal, not proof of the largest bandwidth cause.',
    `Observed route requests: ${data.totals.observedRequests}; observed response bodies: ${mb(data.totals.observedResponseBytes)} MB; observed 5xx responses: ${data.totals.observed5xx}.`,
    ...(data.employeeHours ? [`Provided employee-hours: ${data.employeeHours}. External-service sent traffic: ${data.externalSentMBPerEmployeeHour.toFixed(4)} MB per employee-hour (socket estimate; verify destinations).`] : ['No employee-hour rate calculated: provide actual combined signed-in employee-hours for the exported period.']),
    '## API routes by response bytes',
    table(['Route', 'Requests', 'Response MB', '304 responses', '5xx', 'Average ms'], data.routesByBytes.slice(0, 20).map(row => [row.key, row.count, mb(row.responseBytes), row.notModified, row.failures, row.avgMs])),
    '## API routes by request count',
    table(['Route', 'Observed requests'], data.routesByRequests.slice(0, 20).map(row => [row.key, row.count])),
    '## Database commands by sent bytes',
    table(['Command / collection', 'Commands', 'Sent MB (BSON estimate)', 'Reply MB (inbound)', 'Failed'], data.dbBySentBytes.slice(0, 20).map(row => [row.key, row.count, mb(row.sentBytes), mb(row.replyBytes), row.failed])),
    '## Database commands by count',
    table(['Command / collection', 'Observed commands'], data.dbByCommands.slice(0, 20).map(row => [row.key, row.count])),
    '## Destinations',
    table(['Destination', 'Connections opened', 'Sent MB', 'Received MB'], data.destinations.map(row => [row.key, row.connections, mb(row.sentBytes), mb(row.receivedBytes)])),
    '## Diagnostic counters',
    table(['Event', 'Count'], Object.entries(data.events).sort((a, b) => b[1] - a[1])),
    ...(data.warnings.length ? ['## Import warnings', ...data.warnings.map(value => `- ${value}`)] : []),
    '## Next comparison',
    'Compare normal working periods with the same employee-hours, deployed versions and usage patterns. Match Render HTTP and service-initiated figures to exactly that period; a monthly total cannot be compared directly with a two-day request count. These measurements rank candidates but do not prove savings from a change that has not been measured.',
  ].join('\n\n') + '\n';
}
module.exports = { analyzeTraffic, readMeasurements, renderReport };
