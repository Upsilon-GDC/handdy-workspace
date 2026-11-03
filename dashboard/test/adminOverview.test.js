import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminOverview, overviewHours, overviewPreset, overviewRangeError } from '../src/utils/adminOverview.js';
const asOf = Date.parse('2026-11-03T12:00:00Z');
const people = [{ _id: 'a', fullName: 'A', role: 'employee', team: 't1', isActive: true },
  { _id: 'b', fullName: 'B', role: 'team_lead', team: { _id: 't2' }, isActive: true },
  { _id: 'alpha', fullName: 'Alpha', role: 'alpha', team: null, isActive: true },
  { _id: 'inactive', fullName: 'Old staff', role: 'employee', team: 't1', isActive: false }];
const teams = [{ _id: 't1', teamName: 'WCPA', isActive: true }, { _id: 't2', teamName: 'Tax', isActive: true }, { _id: 'empty', teamName: 'Empty', isActive: true }];
const log = (overrides = {}) => ({ _id: 'work', employee: people[0], project: { projectName: 'Audit' }, task: { taskName: 'Review', taskType: 'work' },
  status: 'stopped', isActiveTimer: false, startedAt: '2026-11-03T08:00:00Z', stoppedAt: '2026-11-03T09:00:00Z', totalWorkedSeconds: 2400, totalIdleSeconds: 600,
  pauses: [{ pausedAt: '2026-11-03T08:30:00Z', resumedAt: '2026-11-03T08:40:00Z', reason: 'idle' }, { pausedAt: '2026-11-03T08:40:00Z', resumedAt: '2026-11-03T08:50:00Z', reason: 'break' }], ...overrides });
test('team hours reconcile work, break tasks, intentional breaks and same-day gaps without Alpha', () => {
  const records = [log(), log({ _id: 'lunch', task: { taskType: 'break', taskName: 'Lunch' }, startedAt: '2026-11-03T09:15:00Z', stoppedAt: '2026-11-03T09:45:00Z', pauses: [], totalWorkedSeconds: 1800, totalIdleSeconds: 0 }),
    log({ _id: 'alpha-log', employee: people[2], totalWorkedSeconds: 10000 }), log({ _id: 'deleted', manualEntry: { deletedAt: '2026-11-03' } })];
  const result = buildAdminOverview({ teams, employees: people, records, asOf });
  assert.equal(result.totals.workedSeconds, 2400);
  assert.equal(result.totals.breakSeconds, 2400);
  assert.equal(result.totals.idleSeconds, 1500);
  assert.equal(result.totals.activeMembers, 2);
  assert.equal(result.teams.some(team => team.members.some(member => member.role === 'alpha')), false);
  assert.equal(result.teams.find(team => team.key === 'empty').workedSeconds, 0);
});
test('current status comes from today, independent of the selected historical period', () => {
  const current = [log({ status: 'running', isActiveTimer: true, stoppedAt: null }),
    log({ _id: 'paused', employee: people[1], status: 'paused', isActiveTimer: true, stoppedAt: null, pauses: [{ pausedAt: '2026-11-03T11:00:00Z', resumedAt: '2026-11-03T12:00:00Z', reason: 'manual' }] })];
  const result = buildAdminOverview({ teams, employees: people, records: [], todayRecords: current, asOf });
  assert.equal(result.totals.workedSeconds, 0);
  assert.equal(result.totals.working, 1); assert.equal(result.totals.onBreak, 1);
  assert.equal(result.teams.find(team => team.key === 't1').members.find(member => member.key === 'a').currentProject, 'Audit');
  assert.equal(result.teams.find(team => team.key === 't2').members[0].state, 'On break');
});
test('running break tasks are never counted as working, and inactive accounts are not live workers', () => {
  const result = buildAdminOverview({ teams, employees: people, todayRecords: [
    log({ status: 'running', stoppedAt: null, isActiveTimer: true, task: { taskType: 'break', taskName: 'Break' } }),
    log({ _id: 'inactive-run', employee: people[3], status: 'running', stoppedAt: null, isActiveTimer: true }),
  ], asOf });
  assert.equal(result.totals.working, 0); assert.equal(result.totals.onBreak, 1);
  assert.equal(result.teams.find(team => team.key === 't1').members.find(member => member.key === 'inactive').state, 'Inactive account');
});
test('team assignments come from the current roster, duplicates do not add hours and overnight gaps do not count as idle', () => {
  const changed = [{ ...people[0], team: 't2' }];
  const first = log({ startedAt: '2026-11-02T10:00:00Z', stoppedAt: '2026-11-02T11:00:00Z', pauses: [], totalIdleSeconds: 0, totalWorkedSeconds: 3600 });
  const second = log({ _id: 'tomorrow', startedAt: '2026-11-03T10:00:00Z', stoppedAt: '2026-11-03T11:00:00Z', pauses: [], totalIdleSeconds: 0, totalWorkedSeconds: 3600 });
  const result = buildAdminOverview({ teams, employees: changed, records: [first, first, second], asOf });
  assert.equal(result.teams.find(team => team.key === 't1').workedSeconds, 0);
  assert.equal(result.teams.find(team => team.key === 't2').workedSeconds, 7200);
  assert.equal(result.totals.idleSeconds, 0);
});
test('unassigned/deleted employees retain historical hours without appearing as active staff', () => {
  const result = buildAdminOverview({ teams: [], employees: [], records: [log({ employee: null })], asOf });
  assert.equal(result.teams[0].name, 'No team assigned');
  assert.equal(result.totals.workedSeconds, 2400); assert.equal(result.totals.activeMembers, 0);
});
test('overview range presets use company date keys and invalid/future ranges are rejected', () => {
  assert.deepEqual(overviewPreset('week', '2026-11-03'), { startDate: '2026-11-02', endDate: '2026-11-03' });
  assert.deepEqual(overviewPreset('month', '2026-11-03'), { startDate: '2026-11-01', endDate: '2026-11-03' });
  assert.equal(overviewRangeError('2026-11-01', '2026-11-03', '2026-11-03'), '');
  assert.match(overviewRangeError('2026-02-30', '2026-11-03', '2026-11-03'), /valid/);
  assert.match(overviewRangeError('2026-11-01', '2026-11-04', '2026-11-03'), /today/);
  assert.equal(overviewHours(3661), '1h 1m');
});
