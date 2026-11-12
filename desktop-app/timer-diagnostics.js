const fs = require('node:fs');
const path = require('node:path');

const MAX_LOG_BYTES = 256 * 1024;
const EVENTS = new Set(['start', 'confirm', 'render', 'lock', 'unresponsive', 'responsive']);
const METRICS = ['requestMilliseconds', 'serverProcessingMilliseconds', 'confirmationMilliseconds',
  'renderMilliseconds', 'lockMilliseconds'];

// Only durations/status are accepted. Never persist console messages, request
// bodies, tokens, employee names, task names, or notes.
function safeSample(event, input = {}) {
  if (!EVENTS.has(event)) return null;
  const sample = { event };
  for (const key of METRICS) {
    const value = input?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 300000) sample[key] = Math.round(value);
  }
  if (Number.isInteger(input?.status) && input.status >= 100 && input.status <= 599) sample.status = input.status;
  return sample;
}

function createTimerDiagnostics({ filePath, version, io = fs.promises }) {
  let pending = Promise.resolve(), bytes = null;
  return function record(event, input) {
    const sample = safeSample(event, input);
    if (!sample) return Promise.resolve(false);
    const line = JSON.stringify({ at: new Date().toISOString(), version, ...sample }) + '\n';
    pending = pending.then(async () => {
      await io.mkdir(path.dirname(filePath), { recursive: true });
      if (bytes === null) {
        try { bytes = (await io.stat(filePath)).size; }
        catch (error) { if (error.code !== 'ENOENT') throw error; bytes = 0; }
      }
      if (bytes + Buffer.byteLength(line) > MAX_LOG_BYTES) {
        await io.writeFile(filePath, line, 'utf8');
        bytes = Buffer.byteLength(line);
      } else {
        await io.appendFile(filePath, line, 'utf8');
        bytes += Buffer.byteLength(line);
      }
      return true;
    }).catch(() => { bytes = null; return false; }); // Diagnostics must never fail a timer action.
    return pending;
  };
}

module.exports = { createTimerDiagnostics, safeSample, MAX_LOG_BYTES };
