const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hash, operation, nextStatus, adjustmentDeltas } = require('../src/services/production/billingRules');

test('approval snapshots have stable fingerprints across object field order and Date serialization', () => {
  assert.equal(hash({ b: 2, a: { when: new Date('2026-11-10T00:00:00Z'), seconds: 3600 } }),
    hash({ a: { seconds: 3600, when: '2026-11-10T00:00:00.000Z' }, b: 2 }));
  assert.notEqual(hash({ rate: 25, seconds: 3600 }), hash({ rate: 40, seconds: 3600 }));
});
test('finalized billing permits only controlled recalculation, and required approval cannot be bypassed', () => {
  for (const action of ['refresh', 'submit', 'approve', 'reject', 'finalize', 'verify-allocations']) assert.throws(() => nextStatus('Finalized', action), { statusCode: 409 });
  assert.throws(() => nextStatus('Submitted', 'finalize', true), { statusCode: 409 });
  assert.equal(nextStatus('Submitted', 'finalize', false), 'Finalized');
  assert.equal(nextStatus('Rejected', 'refresh'), 'Draft');
});
test('historical correction keeps separate currency debits and credits without exchange conversion', () => {
  assert.deepEqual(adjustmentDeltas([{ currency: 'USD', estimatedAmount: 25 }], [{ currency: 'EUR', estimatedAmount: 40 }]),
    [{ currency: 'EUR', amount: 40 }, { currency: 'USD', amount: -25 }]);
  assert.deepEqual(adjustmentDeltas([{ currency: 'KWD', estimatedAmount: 1.234 }], [{ currency: 'KWD', estimatedAmount: 1.235 }]), [{ currency: 'KWD', amount: 0.001 }]);
});
test('financial mutations require a safe revision, request ID and explanatory reason', () => {
  for (const body of [{}, { expectedVersion: -1 }, { expectedVersion: 1, requestId: 'x', reason: 'Reviewed work' },
    { expectedVersion: 1, requestId: 'valid-operation-request', reason: 'x' }]) assert.throws(() => operation(body), { statusCode: 400 });
});
