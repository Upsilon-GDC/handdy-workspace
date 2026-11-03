import { APP_TIMEZONE } from './appDate.js';
import { zonedDateTimeToIso } from './manualEntry.js';
import { buildTimeLogTimeline } from './timeLogTimeline.js';
export const canEditTimeEntries = user => ['admin', 'alpha', 'manager'].includes(user?.role);
export function selectedEntrySegment(record, clicked) {
  const segments = buildTimeLogTimeline(record);
  if (clicked?.source === 'between_sessions') {
    if (!segments.length || +new Date(record.stoppedAt) !== +new Date(clicked.start) || !clicked.end || +new Date(clicked.end) <= +new Date(clicked.start)) throw new Error('This gap changed. Close the editor and reload the entries.');
    return { index: segments.length - 1, gap: true, end: clicked.end };
  }
  const index = segments.findIndex(segment => segment.type === clicked?.type
    && +new Date(segment.start) === +new Date(clicked.start) && +new Date(segment.end) === +new Date(clicked.end));
  if (index < 0) throw new Error('This segment changed. Close the editor and reload the entries.');
  return { index, gap: false };
}
export function localEntryTime(value, timezone = APP_TIMEZONE) {
  const date = new Date(value);
  if (!Number.isFinite(+date)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(date.getUTCMilliseconds()).padStart(3, '0')}`;
}
export function entryTimeIso(value, timezone = APP_TIMEZONE) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value || '');
  if (!match || Number(match[3] || 0) > 59) return null;
  const base = zonedDateTimeToIso(match[1], match[2], timezone);
  if (!base) return null;
  const date = new Date(+new Date(base) + Number(match[3] || 0) * 1000 + Number((match[4] || '').padEnd(3, '0')));
  return localEntryTime(date, timezone).slice(0, 16) === value.slice(0, 16) ? date.toISOString() : null;
}
export function editEntryPayload(form, record, now = Date.now()) {
  if (!form.project || !form.task) return { error: 'Select a project and task.' };
  if (form.reason.trim().length < 5 || form.reason.trim().length > 500) return { error: 'Enter a correction reason of 5–500 characters.' };
  const segments = form.segments.map(segment => ({ type: segment.type, start: entryTimeIso(segment.start), end: entryTimeIso(segment.end) }));
  if (!segments.length || segments.some(segment => !segment.start || !segment.end || +new Date(segment.end) <= +new Date(segment.start))) return { error: 'Every segment needs a valid start and later finish.' };
  if (segments.some(segment => +new Date(segment.end) > +now)) return { error: 'Entries cannot finish in the future.' };
  if (segments.some((segment, index) => index > 0 && segment.start !== segments[index - 1].end)) return { error: 'Segments must connect without gaps or overlaps.' };
  return { payload: { project: form.project, client: form.client || null, task: form.task, note: form.note, reason: form.reason.trim(), segments,
    expectedVersion: record.editVersion || 0, expectedUpdatedAt: record.updatedAt } };
}
