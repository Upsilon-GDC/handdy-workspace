const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEntrySegments } = require('../src/services/timeEntryEditing');
const { editTimeEntry, getTimeEntryForEdit } = require('../src/modules/timers/timeEntryEditController');
const row = (type, start, end) => ({ type, start: `2026-01-01T${start}:00.000Z`, end: `2026-01-01T${end}:00.000Z` });
test('corrections derive all totals from contiguous work, break and idle segments', () => {
  const result = normalizeEntrySegments([row('work', '09:00', '09:30'), row('idle', '09:30', '09:40'), row('break', '09:40', '10:00'), row('work', '10:00', '10:30')], 'work');
  assert.equal(result.totalWorkedSeconds, 3600);
  assert.equal(result.totalPausedSeconds, 1800);
  assert.equal(result.totalIdleSeconds, 600);
  assert.deepEqual(result.pauses.map(pause => pause.reason), ['idle', 'break']);
});
test('break task correction preserves task classification and rejects work segments', () => {
  assert.equal(normalizeEntrySegments([row('break', '09:00', '11:00')], 'break').totalWorkedSeconds, 7200);
  assert.throws(() => normalizeEntrySegments([row('work', '09:00', '11:00')], 'break'), /task/);
});
test('corrections reject gaps, overlaps, reversed times and invalid classifications', () => {
  for (const rows of [[], [null], [row('other', '09:00', '10:00')], [row('work', '10:00', '09:00')],
    [row('work', '09:00', '10:00'), row('idle', '10:01', '10:30')],
    [row('work', '09:00', '10:00'), row('idle', '09:59', '10:30')]]) assert.throws(() => normalizeEntrySegments(rows, 'work'));
  assert.throws(() => normalizeEntrySegments([row('work', '09:00', '10:00')], 'work', new Date('2026-01-01T09:30:00Z')), /future/);
});
test('adjacent same-type pauses are merged before duration rounding', () => {
  const result = normalizeEntrySegments([
    { type: 'idle', start: '2026-01-01T09:00:00Z', end: '2026-01-01T09:00:00.500Z' },
    { type: 'idle', start: '2026-01-01T09:00:00.500Z', end: '2026-01-01T09:00:01Z' },
  ], 'work');
  assert.equal(result.totalIdleSeconds, 1);
  assert.equal(result.pauses.length, 1);
});
test('HR, TL and employees cannot access either edit API even with delegated duties', async () => {
  for (const role of ['hr', 'team_lead', 'employee', undefined]) for (const controller of [editTimeEntry, getTimeEntryForEdit]) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await controller({ user: { role, permissions: ['add_manual_entries', 'view_all_reports'] } }, res);
    assert.equal(res.code, 403);
  }
});
