import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { productionReportCell, reportDataHash, exportProductionExcel } from '../src/utils/productionExport.js';
test('report formatting keeps seconds, zeroes, missing rates, and currency identity explicit', () => {
  assert.equal(productionReportCell(28080, { type: 'duration' }), '7:48:00');
  assert.equal(productionReportCell(0, { type: 'money', currency: 'USD' }), 'USD 0.00');
  assert.equal(productionReportCell(null, { type: 'money', currency: 'USD' }), 'Missing Rate');
  assert.equal(productionReportCell(null, { type: 'percent' }), 'Not applicable');
  assert.equal(productionReportCell(1.235, { type: 'money', currency: 'KWD' }), 'KWD 1.235');
  assert.equal(productionReportCell(3600.125, { type: 'duration' }), '1:00:00.125');
});
test('browser export integrity hash matches the exact backend JSON snapshot', async () => {
  const data = { title: 'Production', rows: [['Employee', 28080, 238]], summary: [{ label: 'USD', value: 238 }] };
  assert.equal(await reportDataHash(data), crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'));
  assert.notEqual(await reportDataHash(data), await reportDataHash({ ...data, rows: [] }));
});

test('Excel opens with period task totals in decimal hours, preserving the underlying precision', async t => {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });
  let captured;
  t.mock.method(URL, 'createObjectURL', blob => { captured = blob; return 'blob:test'; });
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  globalThis.window = { setTimeout() {} };
  const hours = 5400125 / 3600000;
  await exportProductionExcel({ title: 'Employee production', basis: 'live', basisLabel: 'Live estimates', asOf: '2026-11-16T00:00:00Z',
    period: { startDate: '2026-11-01', endDate: '2026-11-15', timezone: 'Asia/Kolkata' }, selection: { team: 'WCPA' },
    columns: [{ key: 'employee', label: 'Employee', type: 'text' }], rows: [['Akhil']], summary: [], notes: [], warnings: [],
    taskTotalsTable: { columns: [{ label: 'Person Worked On' }, { label: 'Description' }, { label: 'Task' }, { label: 'Hrs/Qty', type: 'hours' }],
      rows: [['Akhil', 'CAMBRIDGE_26', 'Audit', hours], ['Akhil', 'NEWBERLIN_25', 'Audit', 4]] } });
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await captured.arrayBuffer());
  const first = workbook.worksheets[0];
  assert.equal(first.name, 'Employee task totals');
  assert.match(first.getCell('A2').value, /2026-11-01 to 2026-11-15/);
  assert.deepEqual(first.getRow(4).values.slice(1), ['Person Worked On', 'Description', 'Task', 'Hrs/Qty']);
  assert.equal(first.getCell('D5').value, hours);
  assert.equal(first.getCell('D5').numFmt, '0.00');
  assert.equal(first.getCell('D7').formula, 'SUM(D5:D6)');
  assert.equal(first.getCell('D7').result, hours + 4);
});
