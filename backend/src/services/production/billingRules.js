const crypto = require('node:crypto');
const { fail } = require('./settingsValidation');
function canonical(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value._bsontype === 'ObjectId') return String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function operation(body) {
  if (!Number.isSafeInteger(body?.expectedVersion) || body.expectedVersion < 1) throw fail('Provide the current billing revision.');
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9-]{16,100}$/.test(body.requestId)) throw fail('Provide a valid action request ID.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) throw fail('Enter a reason of 3–500 characters.');
  return { expectedVersion: body.expectedVersion, requestId: body.requestId, reason };
}
function nextStatus(status, action, approvalRequired = true) {
  const transitions = { refresh: { Draft: 'Draft', Rejected: 'Draft' }, submit: { Draft: 'Submitted' },
    approve: { Submitted: 'Approved' }, reject: { Submitted: 'Rejected', Approved: 'Rejected' },
    finalize: { Approved: 'Finalized', ...(!approvalRequired ? { Submitted: 'Finalized' } : {}) },
    'verify-allocations': { Draft: 'Draft', Rejected: 'Rejected' }, recalculate: { Finalized: 'Finalized' } };
  const result = transitions[action]?.[status];
  if (!result) throw fail(`Cannot ${action} a ${status} billing period.`, 409);
  return result;
}
function adjustmentDeltas(before, after) {
  const previous = new Map((before || []).map(row => [row.currency, row.estimatedAmount]));
  const next = new Map((after || []).map(row => [row.currency, row.estimatedAmount]));
  return [...new Set([...previous.keys(), ...next.keys()])].sort().map(currency => {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    const factor = 10 ** digits;
    return { currency, amount: Math.round(((next.get(currency) || 0) - (previous.get(currency) || 0)) * factor) / factor };
  });
}
module.exports = { hash, canonical, operation, nextStatus, adjustmentDeltas };
