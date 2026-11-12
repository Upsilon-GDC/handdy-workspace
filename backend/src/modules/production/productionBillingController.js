const Batch = require('../../models/ProductionBillingBatch');
const { productionAccess, scopedEmployees } = require('../../services/production/access');
const { createBilling, actOnBilling, getBilling, publicBatch, previewRecalculation } = require('../../services/production/billingWorkflow');
const { fail, objectId } = require('../../services/production/settingsValidation');
const { prepareReview, reviewReport } = require('../../services/production/billingReview');

function errorResponse(res, error) {
  return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to process billing. Please try again.' });
}
async function list(req, res) {
  try {
    const access = await productionAccess(req.user);
    const employees = await scopedEmployees(access, req.query.employee);
    const number = (value, fallback, max) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw fail('Invalid billing pagination.');
      return Number(value);
    };
    const page = number(req.query.page, 1, 10000), limit = number(req.query.limit, 25, 100);
    const filter = { employee: { $in: employees.map(row => row._id) }, ...(access.teamIds ? { team: { $in: access.teamIds } } : {}) };
    if (req.query.team && req.query.team !== 'all') {
      const team = objectId(req.query.team, 'team');
      if (access.teamIds && !access.teamIds.includes(team)) throw fail('Team is outside your billing access.', 403);
      filter.team = team;
    }
    if (req.query.status && req.query.status !== 'all') {
      if (!['Draft', 'Submitted', 'Approved', 'Rejected', 'Finalized'].includes(req.query.status)) throw fail('Choose a valid billing status.');
      filter.status = req.query.status;
    }
    const [items, total] = await Promise.all([
      Batch.find(filter).select('-snapshot.lines -snapshot.entries').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), Batch.countDocuments(filter),
    ]);
    return res.json({ success: true, items: items.map(row => publicBatch(row, req.user, access, { list: true })), total, page, limit,
      access: { self: String(req.user._id), admin: ['admin', 'alpha'].includes(req.user.role), reviewTeamIds: access.reviewTeamIds || [] } });
  } catch (error) { return errorResponse(res, error); }
}
async function create(req, res) {
  try { return res.status(201).json({ success: true, batch: await createBilling(req.user, req.body) }); }
  catch (error) { return errorResponse(res, error); }
}
async function read(req, res) {
  try { return res.json({ success: true, ...await getBilling(req.user, req.params.id) }); }
  catch (error) { return errorResponse(res, error); }
}
async function action(req, res) {
  try { return res.json({ success: true, batch: await actOnBilling(req.user, req.params.id, req.body) }); }
  catch (error) { return errorResponse(res, error); }
}
async function preview(req, res) {
  try { return res.json({ success: true, preview: await previewRecalculation(req.user, req.params.id) }); }
  catch (error) { return errorResponse(res, error); }
}
async function prepare(req, res) {
  try { return res.status(201).json({ success: true, ...await prepareReview(req.user, req.body) }); }
  catch (error) { return errorResponse(res, error); }
}
async function report(req, res) {
  try { return res.json({ success: true, ...await reviewReport(req.user, req.body.ids) }); }
  catch (error) { return errorResponse(res, error); }
}
module.exports = { list, create, read, action, preview, prepare, report };
