import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOverviewData, createSharedRead } from '../src/utils/overviewData.js';
const today = '2026-11-06';
function fixture(context = { roster: { employees: [{ _id: 'one' }], teams: [{ _id: 'team' }] } }) {
  const calls = { context: 0, employees: 0, teams: 0, reports: [] };
  return { calls, options: {
    range: { startDate: today, endDate: today }, today, force: false,
    loadContext: async () => { calls.context++; if (context instanceof Error) throw context; return context; },
    loadEmployees: async () => { calls.employees++; return [{ _id: 'fallback' }]; },
    loadTeams: async () => { calls.teams++; return [{ _id: 'fallback-team' }]; },
    loadReport: async (range, options) => { calls.reports.push({ range, options }); return { timeLogs: [{ _id: range.startDate }] }; },
  } };
}
test('today overview shares the productivity roster and one report without repeating catalog reads', async () => {
  const { calls, options } = fixture(); const result = await loadOverviewData(options);
  assert.equal(calls.context, 1); assert.equal(calls.employees, 0); assert.equal(calls.teams, 0);
  assert.equal(calls.reports.length, 1); assert.equal(result.period, result.current);
  assert.equal(result.employees[0]._id, 'one');
});
test('week/month ranges containing today reuse their activity report for live status', async () => {
  for (const startDate of ['2026-11-01', '2026-11-02']) {
    const { calls, options } = fixture();
    await loadOverviewData({ ...options, range: { startDate, endDate: today } });
    assert.equal(calls.reports.length, 1);
  }
});
test('historical-only periods keep a separate current-day report and retain force semantics', async () => {
  const { calls, options } = fixture();
  const range = { startDate: '2026-11-01', endDate: '2026-11-03' };
  const result = await loadOverviewData({ ...options, range, force: true });
  assert.equal(calls.reports.length, 2); assert.notEqual(result.period, result.current);
  assert.deepEqual(calls.reports[1].range, { startDate: today, endDate: today });
  assert.ok(calls.reports.every(row => row.options.force === true));
});
test('old server, disabled productivity and failed productivity reads fall back to authorized catalogs', async () => {
  for (const context of [undefined, {}, new Error('Synthetic outage')]) {
    const { calls, options } = fixture(context || {});
    const result = await loadOverviewData(options);
    assert.equal(calls.employees, 1); assert.equal(calls.teams, 1); assert.equal(result.employees[0]._id, 'fallback');
  }
  const { options, calls } = fixture();
  await loadOverviewData({ ...options, loadContext: undefined });
  assert.equal(calls.context, 0); assert.equal(calls.employees, 1);
});
test('valid empty rosters remain empty and report failures are not hidden', async () => {
  const { calls, options } = fixture({ roster: { employees: [], teams: [] } });
  const result = await loadOverviewData(options);
  assert.deepEqual(result.employees, []); assert.equal(calls.employees, 0);
  await assert.rejects(loadOverviewData({ ...options, loadReport: async () => { throw Error('Report unavailable'); } }), /Report unavailable/);
});
test('concurrent overview reads share one request and subsequent manual reads fetch again', async () => {
  let reads = 0, resolve;
  const shared = createSharedRead(() => { reads++; return new Promise(done => { resolve = done; }); }, () => 'session');
  const first = shared({ date: today, includeRoster: 'true' }), second = shared({ date: today, includeRoster: 'true' });
  assert.equal(first, second); await Promise.resolve(); assert.equal(reads, 1);
  resolve({ date: today }); await first;
  const manual = shared({ date: today, includeRoster: 'true' });
  await Promise.resolve(); assert.equal(reads, 2); resolve({ date: today }); await manual;
});
test('date scopes and sessions never share data; late results after sign-out are rejected', async () => {
  let session = 'first'; const pending = [];
  const shared = createSharedRead(params => new Promise(resolve => pending.push({ params, resolve })), () => session);
  const first = shared({ date: today }); const yesterday = shared({ date: '2026-11-05' });
  session = 'second'; const second = shared({ date: today });
  const results = Promise.allSettled([first, yesterday, second]);
  await Promise.resolve(); assert.equal(pending.length, 3);
  pending.forEach(row => row.resolve(row.params));
  const settled = await results;
  assert.equal(settled[0].status, 'rejected'); assert.equal(settled[1].status, 'rejected'); assert.equal(settled[2].status, 'fulfilled');
});
test('failed shared reads are evicted and can be retried', async () => {
  let fail = true, reads = 0;
  const shared = createSharedRead(async () => { reads++; if (fail) throw Error('offline'); return { date: today }; }, () => 'session');
  const first = shared({ date: today }), second = shared({ date: today });
  assert.ok((await Promise.allSettled([first, second])).every(row => row.status === 'rejected'));
  assert.equal(reads, 1); fail = false;
  assert.equal((await shared({ date: today })).date, today); assert.equal(reads, 2);
});
