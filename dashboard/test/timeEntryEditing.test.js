import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localEntryTime, entryTimeIso, editEntryPayload, canEditTimeEntries, selectedEntrySegment } from '../src/utils/timeEntryEditing.js';
test('edit timestamps retain seconds and milliseconds in the company timezone', () => {
  const iso = '2026-10-08T09:30:23.123Z';
  assert.equal(localEntryTime(iso), '2026-10-08T15:00:23.123');
  assert.equal(entryTimeIso(localEntryTime(iso)), iso);
  assert.equal(entryTimeIso('2026-02-30T10:00:00'), null);
  assert.equal(entryTimeIso('2026-10-08T10:00:99'), null);
});
test('frontend edit actions match Admin, Alpha and Manager API scope', () => {
  for (const role of ['admin', 'alpha', 'manager']) assert.equal(canEditTimeEntries({ role }), true);
  for (const role of ['hr', 'team_lead', 'employee']) assert.equal(canEditTimeEntries({ role }), false);
});
test('edit payload is tied to the loaded revision and rejects disconnected segments', () => {
  const record = { editVersion: 2, updatedAt: '2026-01-01T12:00:00Z' };
  const form = { project: 'p', client: 'c', task: 't', reason: 'Correct missed time', note: '', segments: [
    { type: 'work', start: '2026-01-01T10:00:00', end: '2026-01-01T11:00:00' },
    { type: 'idle', start: '2026-01-01T11:00:00', end: '2026-01-01T11:05:00' },
  ] };
  const result = editEntryPayload(form, record);
  assert.equal(result.payload.expectedVersion, 2);
  assert.equal(result.payload.expectedUpdatedAt, record.updatedAt);
  assert.equal(result.payload.segments[0].start, '2026-01-01T04:30:00.000Z');
  assert.match(editEntryPayload({ ...form, reason: '' }, record).error, /reason/);
  form.segments[1].start = '2026-01-01T11:00:01';
  assert.match(editEntryPayload(form, record).error, /connect/);
});

test('row selection resolves just the clicked segment and refuses stale row times', () => {
  const record = { startedAt: '2026-01-01T09:00:00Z', stoppedAt: '2026-01-01T10:00:00Z', task: { taskType: 'work' },
    pauses: [{ pausedAt: '2026-01-01T09:30:00Z', resumedAt: '2026-01-01T09:40:00Z', reason: 'idle' }] };
  assert.deepEqual(selectedEntrySegment(record, { type: 'idle', start: '2026-01-01T09:30:00Z', end: '2026-01-01T09:40:00Z' }), { index: 1, gap: false });
  assert.throws(() => selectedEntrySegment(record, { type: 'work', start: '2026-01-01T09:00:00Z', end: '2026-01-01T09:31:00Z' }), /changed/);
  assert.deepEqual(selectedEntrySegment(record, { source: 'between_sessions', start: record.stoppedAt, end: '2026-01-01T10:10:00Z' }), { index: 2, gap: true, end: '2026-01-01T10:10:00Z' });
  assert.throws(() => selectedEntrySegment(record, { source: 'between_sessions', start: '2026-01-01T10:01:00Z', end: '2026-01-01T10:10:00Z' }), /changed/);
});
