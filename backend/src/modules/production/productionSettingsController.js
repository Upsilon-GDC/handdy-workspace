const Revision = require('../../models/ProductionSettingsRevision');
const Audit = require('../../models/ProductionAuditEvent');
const { saveSetting, saveClassificationBatch } = require('../../services/production/settingsService');
const { objectId, fail } = require('../../services/production/settingsValidation');
const { validDate } = require('../../services/workingHours');
const Employee = require('../../models/Employee');
const Project = require('../../models/Project');
const { validateProjectRates } = require('../../services/projectRateService');

function settingsAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Authentication is required.' });
  if (!['admin', 'alpha'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only an Admin can configure Production.' });
  next();
}
function sendError(res, error) {
  return res.status(error.statusCode || 500).json({ success: false,
    ...(error.publicCode === 'PRODUCTION_INITIALIZATION_REQUIRED' ? { code: error.publicCode } : {}),
    message: error.statusCode ? error.message : 'Unable to process Production settings.' });
}
function kindOf(value) {
  if (!['team-billing', 'classification', 'rate', 'access'].includes(value)) throw fail('Unknown production setting.');
  return value;
}
function pagination(query) {
  const parse = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw fail('Invalid pagination.');
    return Number(value);
  };
  return { page: parse(query.page, 1, 10000), limit: parse(query.limit, 25, 100) };
}
async function listSettings(req, res) {
  try {
    const kind = kindOf(req.params.kind);
    const { page, limit } = pagination(req.query);
    const filter = { kind };
    if (req.query.team !== undefined) filter.team = objectId(req.query.team, 'team');
    if (req.query.asOf !== undefined) filter.effectiveFrom = { $lte: validDate(req.query.asOf) };
    // Return latest effective revision per key plus the latest saved version
    // for optimistic edits, including when future revisions already exist.
    const rows = await Revision.aggregate([
      { $match: { kind, ...(filter.team ? { team: Revision.base.Types.ObjectId.createFromHexString(filter.team) } : {}) } },
      ...(filter.effectiveFrom ? [{ $set: { eligible: { $cond: [{ $lte: ['$effectiveFrom', req.query.asOf] }, 1, 0] } } }] : []),
      { $sort: { ...(filter.effectiveFrom ? { eligible: -1 } : {}), effectiveFrom: -1, version: -1 } },
      { $group: { _id: '$key', latestVersion: { $max: '$version' }, revision: { $first: '$$ROOT' } } },
      ...(filter.effectiveFrom ? [{ $match: { 'revision.effectiveFrom': filter.effectiveFrom } }] : []),
      { $sort: { _id: 1 } },
      { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'count' }] } },
    ]);
    return res.json({ success: true, items: rows[0]?.items || [], total: rows[0]?.total[0]?.count || 0, page, limit });
  } catch (error) { return sendError(res, error); }
}
async function history(req, res) {
  try {
    const { page, limit } = pagination(req.query);
    const kind = kindOf(req.params.kind);
    if (typeof req.query.key !== 'string' || req.query.key.length > 160 || !req.query.key) throw fail('Choose a setting key.');
    const filter = { kind, key: req.query.key };
    const [items, total] = await Promise.all([
      Revision.find(filter).sort({ version: -1 }).skip((page - 1) * limit).limit(limit).lean(), Revision.countDocuments(filter),
    ]);
    return res.json({ success: true, items, total, page, limit });
  } catch (error) { return sendError(res, error); }
}
async function listAudit(req, res) {
  try {
    const { page, limit } = pagination(req.query);
    const filter = req.query.team === undefined ? {} : { team: objectId(req.query.team, 'team') };
    const [items, total] = await Promise.all([
      Audit.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Audit.countDocuments(filter),
    ]);
    return res.json({ success: true, items, total, page, limit });
  } catch (error) { return sendError(res, error); }
}
async function save(req, res) {
  try {
    if (req.params.kind === 'rate') throw fail('Production uses employee project rates. Update Projects and charge rates in the employee form.', 409);
    const revision = await saveSetting(kindOf(req.params.kind), req.body, req.user);
    return res.status(201).json({ success: true, revision });
  } catch (error) { return sendError(res, error); }
}
async function historicalSave(req, res) {
  try {
    if (req.params.kind === 'rate') throw fail('Production uses current employee project rates. Update the employee, then preview a billing adjustment for finalized periods.', 409);
    const revision = await saveSetting(kindOf(req.params.kind), req.body, req.user, { historical: true });
    return res.status(201).json({ success: true, revision });
  } catch (error) { return sendError(res, error); }
}
const saveBatch = historical => async (req, res) => {
  try {
    const revisions = await saveClassificationBatch(req.body, req.user, { historical });
    return res.status(201).json({ success: true, count: revisions.length });
  } catch (error) { return sendError(res, error); }
};
async function updateEmployeeRates(req, res) {
  try {
    if (!['admin', 'alpha'].includes(req.user?.role)) throw fail('Only an Admin can edit Production billing rates.', 403);
    const employeeId = objectId(req.params.employee, 'employee'), team = objectId(req.body.team, 'team');
    if (Object.keys(req.body).some(key => !['team', 'projectRates', 'expectedUpdatedAt'].includes(key))) throw fail('Only employee project rates can be changed here.');
    if (!Object.hasOwn(req.body, 'expectedUpdatedAt') || (req.body.expectedUpdatedAt !== null &&
      (typeof req.body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(req.body.expectedUpdatedAt))))) throw fail('Reload the employee rates before saving.');
    if (!Array.isArray(req.body.projectRates) || req.body.projectRates.length > 1000) throw fail('Provide at most 1000 project rates.');
    const employee = await Employee.findOne({ _id: employeeId, team, isActive: true }).select('role projectRates updatedAt').lean();
    if (!employee) throw fail('Active employee not found in this team. Reload the rate list.', 404);
    if (employee.role === 'alpha') throw fail('Alpha account changes are terminal-only.', 403);
    const expected = req.body.expectedUpdatedAt === null ? null : new Date(req.body.expectedUpdatedAt);
    if ((employee.updatedAt ? +new Date(employee.updatedAt) : null) !== (expected ? +expected : null)) throw fail('Employee details changed in another window. Reload before editing rates.', 409);
    const existingProjectIds = (employee.projectRates || []).map(row => String(row.project));
    const projectRates = await validateProjectRates(req.body.projectRates, { existingProjectIds, required: false });
    const added = projectRates.filter(row => !existingProjectIds.includes(row.project)).map(row => row.project);
    if (added.length !== await Project.countDocuments({ _id: { $in: added }, teams: team, deletedAt: null })) throw fail('New projects must belong to the selected team.');
    const updated = await Employee.findOneAndUpdate({ _id: employeeId, team, isActive: true, role: { $ne: 'alpha' }, updatedAt: expected,
      projectRates: employee.projectRates === undefined ? { $exists: false } : employee.projectRates },
      { $set: { projectRates } }, { returnDocument: 'after', runValidators: true }).select('_id fullName employeeId role team projectRates updatedAt')
      .populate('projectRates.project', 'projectName projectCode').lean();
    if (!updated) throw fail('Employee details changed in another window. Reload before editing rates.', 409);
    return res.json({ success: true, employee: updated });
  } catch (error) { return sendError(res, error); }
}
module.exports = { settingsAdmin, listSettings, history, listAudit, save, historicalSave,
  updateEmployeeRates, saveClassificationBatch: saveBatch(false), historicalClassificationBatch: saveBatch(true) };
