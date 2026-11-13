// Offline comparison of exported interval logs. No network or database access.
function analyzeEmployeeTraffic(contents) {
  const groups = new Map(), intervals = new Map();
  let duplicates = 0, malformed = 0, roundedInputs = 0, measurements = 0;
  for (const content of contents) for (const line of content.split(/\r?\n/)) {
    const marker = line.indexOf('[employee-traffic] ');
    if (marker < 0) continue;
    let row;
    try { row = JSON.parse(line.slice(marker + '[employee-traffic] '.length)); }
    catch { malformed++; continue; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) { malformed++; continue; }
    const from = Date.parse(row.from), to = Date.parse(row.to);
    const responseBytes = row.responseBodyBytes ?? row.responseBodyMB * 1_000_000;
    if (!row.employeeId || !row.client || !row.appVersion || !Number.isFinite(from) || !Number.isFinite(to) || to <= from
      || !Number.isSafeInteger(row.requests) || row.requests < 1 || !Number.isFinite(responseBytes) || responseBytes < 0) {
      malformed++; continue;
    }
    const key = JSON.stringify([String(row.employeeId), row.client, row.appVersion]);
    const periods = intervals.get(key) || [];
    const same = periods.find(period => period.from === from && period.to === to);
    if (same) {
      if (same.requests !== row.requests || same.bytes !== responseBytes) throw Error('Conflicting counters for the same employee/version interval. Export non-overlapping logs.');
      duplicates++; continue;
    }
    if (periods.some(period => from < period.to && to > period.from)) throw Error('Overlapping employee/version intervals would double-count usage. Export separate windows.');
    periods.push({ from, to, requests: row.requests, bytes: responseBytes }); intervals.set(key, periods);
    if (row.responseBodyBytes === undefined) roundedInputs++;
    const group = groups.get(key) || { employeeId: String(row.employeeId), employeeName: row.employeeName || '',
      client: row.client, appVersion: row.appVersion, windows: 0, measuredMinutes: 0, requests: 0, responseBodyBytes: 0 };
    group.windows++; group.measuredMinutes += (to - from) / 60000;
    group.requests += row.requests; group.responseBodyBytes += responseBytes;
    groups.set(key, group); measurements++;
    if (measurements > 100_000) throw Error('Export fewer than 100000 employee intervals.');
  }
  if (!measurements) throw Error('No employee measurements found. Export complete [employee-traffic] log lines after deployment; older [metrics] logs cannot identify individual employees.');
  const rows = [...groups.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.client.localeCompare(b.client) || a.appVersion.localeCompare(b.appVersion))
    .map(row => ({ ...row, responseBodyMB: row.responseBodyBytes / 1_000_000,
      requestsPerMinute: row.requests / row.measuredMinutes, responseMBPerMinute: row.responseBodyBytes / 1_000_000 / row.measuredMinutes,
      averageResponseKB: row.responseBodyBytes / row.requests / 1000 }));
  return { measurements, duplicatesSkipped: duplicates, malformedSkipped: malformed, roundedInputs, rows,
    interpretation: 'Compare the same employee, similar actions, routes, and equal-length windows. Minutes describe logging coverage, not employee work time. Response bodies exclude HTTP headers and shared database traffic. These figures alone do not prove overall Render bandwidth savings.' };
}

function renderEmployeeReport(data) {
  const escape = value => String(value).replace(/[|\r\n]/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const headers = ['Employee ID', 'Employee', 'Client', 'Version', 'Windows', 'Minutes', 'Requests', 'Response MB', 'Requests/min', 'MB/min', 'KB/request'];
  const rows = data.rows.map(row => [row.employeeId, row.employeeName, row.client, row.appVersion, row.windows,
    row.measuredMinutes.toFixed(2), row.requests, row.responseBodyMB.toFixed(4), row.requestsPerMinute.toFixed(2), row.responseMBPerMinute.toFixed(4), row.averageResponseKB.toFixed(3)]);
  return ['# Employee app-version traffic comparison', data.interpretation,
    `Intervals: ${data.measurements}; duplicates skipped: ${data.duplicatesSkipped}; malformed rows skipped: ${data.malformedSkipped}; rounded older inputs: ${data.roundedInputs}. Unknown versions remain separate.`,
    [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.map(escape).join(' | ')} |`).join('\n'),
  ].join('\n\n') + '\n';
}
module.exports = { analyzeEmployeeTraffic, renderEmployeeReport };
