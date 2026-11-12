const mongoose = require('mongoose');
const Batch = require('../../models/ProductionBillingBatch');
const Event = require('../../models/ProductionBillingEvent');
const Claim = require('../../models/ProductionBillingClaim');
const Adjustment = require('../../models/ProductionBillingAdjustment');
const Allocation = require('../../models/ProductionWorkAllocation');
const Employee = require('../../models/Employee');
const Team = require('../../models/Team');
const { productionAccess } = require('./access');
const { billingSnapshot } = require('./billingSnapshot');
const { hash, operation, nextStatus, adjustmentDeltas } = require('./billingRules');
const { objectId, fail } = require('./settingsValidation');
const { getBillingDateRange, addDateKeyDays } = require('../../utils/billingUtils');
const id = value => String(value?._id || value || '');
const isAdmin = user => ['admin', 'alpha'].includes(user?.role);
const reviewer = (user, access, batch) => isAdmin(user) || (id(batch.employee) !== id(user) && access.reviewTeamIds?.includes(id(batch.team)));
const owner = (user, batch) => id(batch.employee) === id(user) || id(batch.createdBy) === id(user);
const monetary = (user, access, batch) => isAdmin(user) || access.billingTeamIds?.includes(id(batch.team));

async function assertReady() {
  try {
    for (const [Model, name] of [[Batch, 'production_billing_period'], [Event, 'production_billing_action_request'], [Claim, '_id_'], [Adjustment, 'production_billing_adjustment_version'], [Allocation, 'production_log_allocation_version']]) {
      if (!(await Model.collection.listIndexes().toArray()).some(row => row.name === name && (name === '_id_' || row.unique === true))) throw fail('Run Production initialization before using Billing Management.', 503);
    }
  } catch (error) { if (error.code === 26) throw fail('Run Production initialization before using Billing Management.', 503); throw error; }
}
async function assertScope(user, access, batch, session) {
  if (access.teamIds && !access.teamIds.includes(id(batch.team))) throw fail('Billing period is outside your team access.', 403);
  if (!await Employee.exists({ $and: [access.employeeFilter, { _id: batch.employee }] }).session(session)) throw fail('Billing period is outside your employee access.', 403);
}
function permissions(user, access, batch) {
  const canManage = isAdmin(user) || owner(user, batch) || reviewer(user, access, batch);
  return { refresh: canManage, submit: canManage, approve: reviewer(user, access, batch), reject: reviewer(user, access, batch),
    finalize: isAdmin(user), 'verify-allocations': reviewer(user, access, batch), recalculate: isAdmin(user) };
}
function publicBatch(batch, user, access, { list = false } = {}) {
  const result = structuredClone(JSON.parse(JSON.stringify(batch)));
  delete result.sourceHash; delete result.requestId;
  const seeMoney = monetary(user, access, batch);
  if (!isAdmin(user) && id(batch.employee) !== id(user) && result.snapshot.entries) result.snapshot.entries = result.snapshot.entries.filter(row => row.verified || row.teamLinkCompatible);
  if (!seeMoney) {
    delete result.snapshot.summary.billing;
    for (const row of result.snapshot.lines || []) delete row.billing;
    result.snapshot.blockers = result.snapshot.blockers.map(code => code === 'missing-or-mismatched-rate' ? 'billing-configuration-needs-review' : code);
  }
  result.financialAccess = Boolean(seeMoney);
  if (reviewer(user, access, batch)) result.verificationHash = batch.sourceHash;
  result.allowedActions = Object.entries(permissions(user, access, batch)).filter(([action, allowed]) => {
    if (!allowed) return false;
    try { nextStatus(batch.status, action, batch.snapshot.approvalRequired); return true; } catch { return false; }
  }).map(([action]) => action);
  result.lineCount = result.snapshot.lineCount ?? result.snapshot.lines?.length ?? 0;
  if (list) { delete result.snapshot.lines; delete result.snapshot.entries; }
  return result;
}
async function transaction(work) {
  await assertReady();
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => { result = await work(session); }); return result; }
  catch (error) { if (error.code === 11000) throw fail('This work is already claimed by another billing period, or the revision changed. Reload before retrying.', 409); throw error; }
  finally { await session.endSession(); }
}
async function createBilling(user, body, { session: sharedSession = null, access: sharedAccess = null } = {}) {
  const access = sharedAccess || await productionAccess(user);
  const employee = objectId(body.employee, 'employee'), team = objectId(body.team, 'team');
  const { reason, requestId } = operation({ ...body, expectedVersion: 1 });
  const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
  if (typeof body.startDate !== 'string' || typeof body.endDate !== 'string') throw fail('Choose a valid billing date range.');
  try { getBillingDateRange(body.startDate, body.endDate, timezone); } catch (error) { throw fail(error.message); }
  const definition = { employee, team, startDate: body.startDate, endDate: body.endDate, timezone };
  await assertScope(user, access, definition, sharedSession);
  if (!isAdmin(user) && employee !== id(user) && !reviewer(user, access, definition)) throw fail('Only the employee or an authorized billing reviewer can create this draft.', 403);
  if (!await Team.exists({ _id: team })) throw fail('Team not found.', 404);
  const prepare = async session => {
    const priorRequest = await Batch.findOne({ createdBy: user._id, requestId }).session(session).lean();
    if (priorRequest) {
      if (hash({ employee: id(priorRequest.employee), team: id(priorRequest.team), startDate: priorRequest.startDate, endDate: priorRequest.endDate, timezone: priorRequest.timezone }) !== hash(definition)) throw fail('Request ID was already used for another period.', 409);
      return priorRequest;
    }
    const existing = await Batch.findOne(definition).session(session).lean();
    if (existing) return existing;
    const calculated = await billingSnapshot(definition, session);
    const [batch] = await Batch.create([{ ...definition, ...calculated, createdBy: user._id, requestId, version: 1, status: 'Draft' }], { session });
    await Event.create([{ batch: batch._id, actor: user._id, action: 'create', from: 'None', to: 'Draft', version: 1,
      reason, requestId, requestHash: hash({ actor: id(user), definition, reason }), sourceHash: calculated.sourceHash }], { session });
    return batch.toObject();
  };
  const result = sharedSession ? await prepare(sharedSession) : await transaction(prepare);
  return publicBatch(result, user, access);
}
function assertComplete(snapshot, recalculation = false) {
  const blockers = recalculation ? snapshot.blockers.filter(code => !['no-billable-work', 'hours-only-team'].includes(code)) : snapshot.blockers;
  if (blockers.length) throw fail(`Resolve the billing review items first: ${blockers.join(', ')}.`, 409);
}
async function actOnBilling(user, batchId, body) {
  const access = await productionAccess(user), batchKey = objectId(batchId, 'billing period');
  const input = operation(body), action = body.action;
  if (typeof action !== 'string' || !['refresh', 'submit', 'approve', 'reject', 'finalize', 'verify-allocations', 'recalculate'].includes(action)) throw fail('Choose a valid billing action.');
  const requestHash = hash({ actor: id(user), ...input, action, allocations: body.allocations || null, previewHash: body.previewHash || null, verificationHash: body.verificationHash || null });
  const result = await transaction(async session => {
    let batch = await Batch.findById(batchKey).session(session).lean();
    if (!batch) throw fail('Billing period not found.', 404);
    await assertScope(user, access, batch, session);
    if (!permissions(user, access, batch)[action]) throw fail('You cannot perform this billing action.', 403);
    const previousRequest = await Event.findOne({ batch: batchKey, requestId: input.requestId }).session(session).lean();
    if (previousRequest) {
      if (previousRequest.requestHash !== requestHash) throw fail('Action request ID was already used for a different action.', 409);
      return batch;
    }
    if (batch.version !== input.expectedVersion) throw fail('Billing changed in another window. Reload before continuing.', 409);
    const status = nextStatus(batch.status, action, batch.snapshot.approvalRequired);
    const changes = { status, version: batch.version + 1 };
    let eventSourceHash = batch.sourceHash;
    if (action === 'verify-allocations') {
      const requested = body.allocations;
      if (!Array.isArray(requested) || !requested.length || requested.length > 1000) throw fail('Choose up to 1000 time entries to verify.');
      const fresh = await billingSnapshot(batch, session);
      if (body.verificationHash !== fresh.sourceHash) throw fail('Work changed since the team assignment review. Refresh the draft before verifying.', 409);
      const candidates = new Map(fresh.snapshot.entries.map(row => [row.timeLog, row]));
      const seen = new Set();
      for (const entry of requested) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw fail('Provide valid time-entry allocation revisions.');
        const log = objectId(entry.timeLog, 'time entry'), candidate = candidates.get(log);
        if (!candidate || seen.has(log)) throw fail('Time entry is unavailable for this billing team.', 403);
        if (!candidate.verified && !candidate.teamLinkCompatible && !isAdmin(user)) throw fail('An Admin must review entries that conflict with current team links.', 403);
        seen.add(log);
        if (!Number.isSafeInteger(entry.expectedVersion) || entry.expectedVersion !== candidate.allocationVersion) throw fail('Team allocation changed. Reload before verifying.', 409);
        if (candidate.verified) continue;
        if (await Batch.exists({ status: 'Finalized', 'snapshot.lines.timeLogIds': log }).session(session)) throw fail('A finalized billing snapshot already includes this time entry.', 409);
        await Allocation.create([{ timeLog: log, team: batch.team, version: entry.expectedVersion + 1, changedBy: user._id, reason: input.reason }], { session });
      }
      Object.assign(changes, await billingSnapshot(batch, session));
    } else if (['refresh', 'submit', 'approve', 'finalize', 'recalculate'].includes(action)) {
      const calculated = await billingSnapshot(batch, session);
      if (action === 'refresh') Object.assign(changes, calculated);
      else if (action === 'recalculate') {
        assertComplete(calculated.snapshot, true);
        if (body.previewHash !== calculated.sourceHash) throw fail('Preview the historical adjustment again; the work or configuration changed.', 409);
        const last = batch.lastAdjustment ? await Adjustment.findById(batch.lastAdjustment).session(session).lean() : null;
        if (calculated.sourceHash === (last?.sourceHash || batch.sourceHash)) throw fail('The finalized source has not changed.', 409);
        const [adjustment] = await Adjustment.create([{ batch: batch._id, actor: user._id, reason: input.reason, version: changes.version,
          deltas: adjustmentDeltas((last?.resultSnapshot || batch.snapshot).summary.billing?.estimates, calculated.snapshot.summary.billing?.estimates),
          resultSnapshot: calculated.snapshot, sourceHash: calculated.sourceHash }], { session });
        changes.lastAdjustment = adjustment._id;
        eventSourceHash = calculated.sourceHash;
        // Original snapshot/sourceHash deliberately remain unchanged.
      } else {
        assertComplete(calculated.snapshot);
        if (calculated.sourceHash !== batch.sourceHash) throw fail('Work or billing configuration changed. Reject or refresh the draft before continuing.', 409);
      }
    }
    if (action === 'submit') {
      const claims = [];
      for (let date = batch.startDate; date <= batch.endDate; date = addDateKeyDays(date, 1)) claims.push({ _id: `${batch.employee}:${batch.team}:${date}`, batch: batch._id });
      await Claim.create(claims, { session, ordered: true });
    }
    if (action === 'reject') await Claim.deleteMany({ batch: batch._id }).session(session);
    const changed = await Batch.updateOne({ _id: batch._id, version: input.expectedVersion }, { $set: changes }, { session, runValidators: true });
    if (changed.modifiedCount !== 1) throw fail('Billing revision changed. Reload before continuing.', 409);
    await Event.create([{ batch: batch._id, actor: user._id, action, from: batch.status, to: status, version: changes.version,
      reason: input.reason, requestId: input.requestId, requestHash, sourceHash: changes.sourceHash || eventSourceHash }], { session });
    batch = await Batch.findById(batch._id).session(session).lean();
    return batch;
  });
  return publicBatch(result, user, access);
}
async function getBilling(user, batchId) {
  const access = await productionAccess(user), batch = await Batch.findById(objectId(batchId, 'billing period')).lean();
  if (!batch) throw fail('Billing period not found.', 404);
  await assertScope(user, access, batch);
  const [events, adjustments] = await Promise.all([
    Event.find({ batch: batch._id }).select('actor action from to version reason createdAt').populate('actor', 'fullName employeeId').sort({ version: -1 }).limit(100).lean(),
    Adjustment.find({ batch: batch._id }).select('actor reason version deltas createdAt').populate('actor', 'fullName employeeId').sort({ version: -1 }).limit(100).lean(),
  ]);
  let adjustedTotals;
  if (!monetary(user, access, batch)) for (const row of adjustments) delete row.deltas;
  else if (batch.lastAdjustment) {
    const last = await Adjustment.findById(batch.lastAdjustment).select('resultSnapshot.summary').lean();
    const original = batch.snapshot.summary.billing?.estimates || [], current = last?.resultSnapshot.summary.billing?.estimates || [];
    adjustedTotals = adjustmentDeltas(original, current).map(row => ({ currency: row.currency,
      amount: current.find(value => value.currency === row.currency)?.estimatedAmount || 0 }));
  }
  return { batch: publicBatch(batch, user, access), events, adjustments, adjustedTotals };
}
async function previewRecalculation(user, batchId) {
  if (!isAdmin(user)) throw fail('Only an Admin can recalculate finalized billing.', 403);
  const access = await productionAccess(user), batchKey = objectId(batchId, 'billing period');
  return transaction(async session => {
    const batch = await Batch.findById(batchKey).session(session).lean();
    if (!batch) throw fail('Billing period not found.', 404);
    await assertScope(user, access, batch, session);
    if (batch.status !== 'Finalized') throw fail('Historical adjustments require a finalized period.', 409);
    const calculated = await billingSnapshot(batch, session);
    assertComplete(calculated.snapshot, true);
    const previous = batch.lastAdjustment ? await Adjustment.findById(batch.lastAdjustment).session(session).lean() : null;
    if (calculated.sourceHash === (previous?.sourceHash || batch.sourceHash)) throw fail('The finalized source has not changed.', 409);
    return { version: batch.version, previewHash: calculated.sourceHash, summary: calculated.snapshot.summary,
      deltas: adjustmentDeltas((previous?.resultSnapshot || batch.snapshot).summary.billing?.estimates, calculated.snapshot.summary.billing?.estimates) };
  });
}
module.exports = { transaction, createBilling, actOnBilling, getBilling, previewRecalculation, publicBatch, assertScope, monetary };
