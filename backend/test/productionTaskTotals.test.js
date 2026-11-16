const { test } = require('node:test');
const assert = require('node:assert/strict');
const { billableTaskTotals } = require('../src/services/production/reportTables');

const work = (overrides = {}) => ({ employee: 'employee-1', employeeName: 'Akhil', project: 'audit-1', projectName: 'Audit',
  task: 'task-1', taskName: 'CAMBRIDGE_26', date: '2026-11-01', billing: { applicable: true, billableSeconds: 3600 }, ...overrides });

test('task totals combine the entire date range and retain decimal hour precision', () => {
  const table = billableTaskTotals([work(), work({ date: '2026-11-15', billing: { applicable: true, billableSeconds: 1800.125 } })]);
  assert.deepEqual(table.columns.map(col => col.label), ['Person Worked On', 'Description', 'Task', 'Hrs/Qty']);
  assert.deepEqual(table.rows, [['Akhil', 'CAMBRIDGE_26', 'Audit', 5400125 / 3600000]]);
});

test('different identities and projects never merge merely because labels match', () => {
  const table = billableTaskTotals([work(), work({ employee: 'employee-2' }), work({ project: 'audit-2' }), work({ task: 'task-2' })]);
  assert.equal(table.rows.length, 4);
  assert.equal(table.rows.reduce((sum, row) => sum + row[3], 0), 4);
});

test('breaks training excluded work and unavailable financial scope add no billable hours', () => {
  const table = billableTaskTotals([work(), work({ category: 'training', billing: { applicable: true, billableSeconds: 0 } }),
    work({ category: 'break-idle', billing: { applicable: true, billableSeconds: 0 } }),
    work({ billing: { applicable: false, billableSeconds: 7200 } }), work({ billing: undefined })]);
  assert.deepEqual(table.rows, [['Akhil', 'CAMBRIDGE_26', 'Audit', 1]]);
  assert.deepEqual(billableTaskTotals([]).rows, []);
});
