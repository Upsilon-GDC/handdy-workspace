import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionClientChoices, productionTaskChoices } from '../src/utils/production.js';

test('client choices remove repeated IDs but preserve distinct records and distinguish inactive/same-name records', () => {
  const active = { _id: '000001', clientName: 'Acme', status: 'Active' };
  const old = { _id: '000002', clientName: 'Acme', status: 'Inactive' };
  const other = { _id: '000003', clientName: ' acme ', status: 'Active', company: 'Another company' };
  const options = productionClientChoices([active, old, active, other]);
  assert.equal(options.length, 3);
  assert.deepEqual(options.map(row => row._id), ['000001', '000002', '000003']);
  assert.equal(options[1].optionLabel, 'Acme (Inactive)');
  assert.ok(options[0].optionLabel.includes('000001'));
  assert.ok(options[2].optionLabel.includes('Another company'));
  assert.equal(new Set(options.map(row => row.optionLabel)).size, 3);
  assert.deepEqual(productionClientChoices([active]), [{ ...active, optionLabel: 'Acme' }]);
});

test('same-name task choices retain different project identities and mark historical tasks', () => {
  const a = { _id: '1', taskName: 'Review', taskCode: 'T1', project: { projectName: 'Audit' }, isActive: true };
  const b = { _id: '2', taskName: 'Review', taskCode: 'T2', project: { projectName: 'Bookkeeping' }, isActive: true };
  const old = { _id: '3', taskName: 'Review', taskCode: 'T3', project: null, isActive: false, deletedAt: '2026-11-01' };
  const choices = productionTaskChoices([a, b, old, a]);
  assert.equal(choices.length, 3);
  assert.ok(choices[0].optionLabel.includes('Audit'));
  assert.ok(choices[1].optionLabel.includes('Bookkeeping'));
  assert.ok(choices[2].optionLabel.includes('(Archived)'));
  assert.deepEqual(choices.map(row => row._id), ['1', '2', '3']);
});
