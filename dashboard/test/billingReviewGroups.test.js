import test from 'node:test';
import assert from 'node:assert/strict';
import { billingReviewGroups, billingLineTotals, billingPeriodDates, billingProjectTable } from '../src/utils/billingReviewGroups.js';
const line = (overrides = {}) => ({ employee: 'a', employeeName: 'Akhil', project: 'p1', projectName: 'Audit', client: 'c1', task: 't1', taskName: 'Review', date: '2026-11-10', actualSeconds: 3600, billing: { applicable: true, currency: 'USD', status: 'estimated', rateHundredths: 1300 }, ...overrides });
test('project billing groups preserve employee and project IDs even when names match', () => {
  const lines = [line(), line({ actualSeconds: 1800 }), line({ employee: 'b' }), line({ project: 'p2' })];
  const grouped = billingReviewGroups(lines);
  assert.equal(grouped.projects.length, 2); assert.equal(grouped.projects[0].tasks.length, 2);
  assert.equal(grouped.projects[0].tasks[0].seconds, 5400);
  assert.equal(grouped.projects[0].tasks[0].amounts[0].amount, 19.5);
  assert.equal(grouped.days[0].seconds, 12600);
  assert.equal(billingProjectTable(lines).rows.length, 3);
});
test('billing subtotals keep full precision and flag missing rates without making them zero', () => {
  assert.equal(billingLineTotals([line({ actualSeconds: 28560, billing: { applicable: true, currency: 'USD', status: 'estimated', rateHundredths: 3000 } })])[0].amount, 238);
  const missing = line({ billing: { applicable: true, currency: 'USD', status: 'missing-rate' } });
  assert.equal(billingLineTotals([missing])[0].amount, null);
  assert.equal(billingLineTotals([line(), missing])[0].complete, false);
  assert.equal(billingProjectTable([line({ billing: undefined })]).columns.some(col => col.label.includes('rate')), false);
});
test('billing date presets use business date keys across month and week boundaries', () => {
  assert.deepEqual(billingPeriodDates('last-month', '2026-01-05'), ['2025-12-01','2025-12-31']);
  assert.deepEqual(billingPeriodDates('last-week', '2026-11-11'), ['2026-11-02','2026-11-08']);
});
