import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { productionReportCell, reportDataHash } from '../src/utils/productionExport.js';
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
