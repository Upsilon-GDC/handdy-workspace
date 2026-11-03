const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
function normalizeEntrySegments(segments, taskType, now = Date.now()) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 200) throw fail('Provide 1–200 time segments.');
  const base = taskType === 'break' ? 'break' : 'work';
  const rows = segments.map(segment => {
    if (!segment || typeof segment !== 'object') throw fail('Provide valid time segments.');
    if (!['work', 'break', 'idle'].includes(segment.type) || (base === 'break' && segment.type === 'work')) throw fail('The segment type does not match the selected task.');
    const start = typeof segment.start === 'string' ? new Date(segment.start) : new Date(NaN);
    const end = typeof segment.end === 'string' ? new Date(segment.end) : new Date(NaN);
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start) throw fail('Every segment needs a valid start and later finish.');
    if (+end > +now) throw fail('Entries cannot finish in the future.');
    return { type: segment.type, start, end };
  });
  for (let i = 1; i < rows.length; i++) {
    if (+rows[i].start !== +rows[i - 1].end) throw fail('Segments must connect exactly, without gaps or overlaps.');
  }
  const startedAt = rows[0].start;
  const stoppedAt = rows.at(-1).end;
  if (+stoppedAt - +startedAt > 31 * 86400000) throw fail('An edited entry cannot exceed 31 days.');
  // Merge adjacent pauses before rounding, preserving elapsed time accounting.
  const pauses = [];
  for (const row of rows) {
    if (row.type === base) continue;
    const reason = row.type === 'idle' ? 'idle' : 'break';
    const previous = pauses.at(-1);
    if (previous?.reason === reason && +previous.resumedAt === +row.start) previous.resumedAt = row.end;
    else pauses.push({ pausedAt: row.start, resumedAt: row.end, reason });
  }
  const seconds = pause => Math.floor((pause.resumedAt - pause.pausedAt) / 1000);
  const totalPausedSeconds = pauses.reduce((sum, pause) => sum + seconds(pause), 0);
  const totalIdleSeconds = pauses.filter(pause => pause.reason === 'idle').reduce((sum, pause) => sum + seconds(pause), 0);
  return { startedAt, stoppedAt, pauses, totalPausedSeconds, totalIdleSeconds,
    totalWorkedSeconds: Math.max(0, Math.floor((stoppedAt - startedAt) / 1000) - totalPausedSeconds) };
}
const snapshotFields = ['employee', 'project', 'client', 'task', 'activityMapping', 'startedAt', 'stoppedAt', 'pauses',
  'note', 'totalWorkedSeconds', 'totalPausedSeconds', 'totalIdleSeconds', 'entrySource', 'status'];
const entrySnapshot = record => Object.fromEntries(snapshotFields.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
module.exports = { normalizeEntrySegments, entrySnapshot, fail };
