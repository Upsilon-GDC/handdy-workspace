const mongoose = require('mongoose');
const { validDate } = require('../workingHours');
const { getDateKeyInTimezone } = require('../../utils/billingUtils');

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const today = () => getDateKeyInTimezone(new Date(), process.env.APP_TIMEZONE || 'Asia/Kolkata');
function objectId(value, label) {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value)) throw fail(`Choose a valid ${label}.`);
  return value.toLowerCase();
}
function currency(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!Intl.supportedValuesOf('currency').includes(code)) throw fail('Choose a supported currency code.');
  return code;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw fail(`${label} must be true or false.`);
  return value;
}
function validateSetting(kind, body, { earliestDate = today() } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Provide production settings.');
  if (!['team-billing', 'classification', 'rate', 'access'].includes(kind)) throw fail('Unknown production setting.');
  const team = objectId(body.team, 'team');
  const effectiveFrom = validDate(body.effectiveFrom);
  if (effectiveFrom < earliestDate) throw fail('Settings must start today or later. Historical recalculation is a separate audited action.');
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) throw fail('Provide the current setting version.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) throw fail('Enter a reason of 3–500 characters.');
  let key, values;
  if (kind === 'team-billing') {
    const billingEnabled = boolean(body.billingEnabled, 'Billing enabled');
    values = { billingEnabled, currency: billingEnabled ? currency(body.currency) : null,
      approvalRequired: boolean(body.approvalRequired, 'Approval required') };
    key = team;
  } else if (kind === 'classification') {
    const targetType = body.targetType;
    if (!['task', 'activity'].includes(targetType)) throw fail('Choose a task or activity classification.');
    const target = objectId(body.target, targetType);
    const category = body.category;
    if (!['productive', 'training', 'excluded', 'break-idle'].includes(category)) throw fail('Choose a valid activity category.');
    const billable = boolean(body.billable, 'Billable');
    if (category !== 'productive' && billable) throw fail('Only productive activities can be billable.');
    values = { targetType, target, category, billable };
    key = `${team}:${targetType}:${target}`;
  } else if (kind === 'access') {
    const employee = objectId(body.employee, 'employee');
    values = { employee, enabled: boolean(body.enabled, 'Access enabled'), canViewBilling: boolean(body.canViewBilling, 'View billing') };
    values.canApproveBilling = body.canApproveBilling === undefined ? false : boolean(body.canApproveBilling, 'Approve billing');
    if (values.canApproveBilling && !values.canViewBilling) throw fail('Billing reviewers also need explicit financial visibility.');
    key = `${employee}:${team}`;
  } else {
    const client = body.client == null ? null : objectId(body.client, 'client');
    const employee = body.employee == null ? null : objectId(body.employee, 'employee');
    const enabled = boolean(body.enabled, 'Rate enabled');
    const hourlyRate = body.hourlyRate;
    // Store rates in integer hundredths of a currency unit, without
    // accepting numeric strings or silently rounding administrator input.
    if (typeof hourlyRate !== 'number' || !Number.isFinite(hourlyRate) || hourlyRate <= 0 || hourlyRate > 1_000_000
      || Math.abs(hourlyRate * 100 - Math.round(hourlyRate * 100)) > 0.000001) throw fail('Enter a positive hourly rate with at most two decimal places.');
    values = { client, employee, enabled, hourlyRateHundredths: Math.round(hourlyRate * 100), currency: currency(body.currency) };
    key = `${team}:${client || '*'}:${employee || '*'}`;
  }
  return { kind, key, team, effectiveFrom, values, reason, expectedVersion: body.expectedVersion };
}

// Resolve as-of configuration without allowing a future revision to leak
// backward. Same-day corrections use the last appended version.
function effectiveRevision(revisions, date) {
  validDate(date);
  return revisions.reduce((best, row) => row.effectiveFrom <= date && (!best || row.effectiveFrom > best.effectiveFrom
    || (row.effectiveFrom === best.effectiveFrom && row.version > best.version)) ? row : best, null);
}
module.exports = { fail, today, objectId, validateSetting, effectiveRevision };
