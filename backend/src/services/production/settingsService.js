const mongoose = require('mongoose');
const Revision = require('../../models/ProductionSettingsRevision');
const Audit = require('../../models/ProductionAuditEvent');
const Team = require('../../models/Team');
const Employee = require('../../models/Employee');
const Client = require('../../models/Client');
const Task = require('../../models/Task');
const ActivityMapping = require('../../models/ActivityMapping');
const Allocation = require('../../models/ProductionWorkAllocation');
const Batch = require('../../models/ProductionBillingBatch');
const Event = require('../../models/ProductionBillingEvent');
const Claim = require('../../models/ProductionBillingClaim');
const Adjustment = require('../../models/ProductionBillingAdjustment');
const TaskTimeLog = require('../../models/TaskTimeLog');
const { fail, objectId, validateSetting, today } = require('./settingsValidation');
const { taskTeamScope } = require('./settingsCatalog');
const storageModels = [Revision, Audit, Allocation, Batch, Event, Claim, Adjustment];
const intervalIndex = { keys: { employee: 1, stoppedAt: 1, startedAt: 1 }, name: 'production_employee_interval' };
const productionStoragePlan = () => [...storageModels.map(Model => ({ collection: Model.collection.collectionName,
  indexes: Model.schema.indexes().map(([keys, options]) => ({ keys, name: options.name, unique: options.unique === true })) })),
  { collection: TaskTimeLog.collection.collectionName, existingCollection: true, indexes: [intervalIndex] }];

async function ensureProductionSettingsIndexes() {
  for (const Model of storageModels) {
    await Model.createCollection();
    await Model.createIndexes();
  }
  if (await mongoose.connection.db.listCollections({ name: TaskTimeLog.collection.collectionName }).hasNext()) {
    await TaskTimeLog.collection.createIndex(intervalIndex.keys, { name: intervalIndex.name });
  }
}
async function assertInitialized() {
  const setupRequired = () => Object.assign(fail('Production setup is incomplete. Initialize Production before saving settings.', 503), { publicCode: 'PRODUCTION_INITIALIZATION_REQUIRED' });
  try {
    for (const [Model, indexName] of [[Revision, 'production_setting_version'], [Audit, 'production_revision_audit']]) {
      const indexes = await Model.collection.listIndexes().toArray();
      if (!indexes.some(index => index.name === indexName && index.unique)) throw setupRequired();
    }
  } catch (error) {
    if (error.code === 26) throw setupRequired();
    throw error;
  }
}
async function assertReferences(setting, session) {
  if (!await Team.exists({ _id: setting.team, ...(setting.historicalCorrection ? {} : { isActive: true }) }).session(session)) throw fail('Team not found or unavailable for this change.', 404);
  const { values } = setting;
  if (setting.kind === 'access' && !await Employee.exists({ _id: values.employee, isActive: true }).session(session)) throw fail('Active employee not found.', 404);
  if (setting.kind === 'classification') {
    const Model = values.targetType === 'task' ? Task : ActivityMapping;
    const target = await Model.findById(values.target).select('task taskType').session(session).lean();
    if (!target) throw fail('Classification target not found.', 404);
    const task = values.targetType === 'task' ? target : await Task.findById(target.task).select('taskType').session(session).lean();
    if (!task) throw fail('Classification task not found.', 404);
    if (task.taskType === 'break' && !['break-idle', 'excluded'].includes(values.category)) throw fail('Break tasks must remain excluded from production and billing.');
  }
  if (setting.kind === 'rate') {
    for (const [field, Model] of [['client', Client], ['employee', Employee]]) {
      if (values[field] && !await Model.exists({ _id: values[field] }).session(session)) throw fail(`Rate ${field} not found.`, 404);
    }
  }
}
async function appendSetting(setting, actorId, session) {
  const previous = await Revision.findOne({ kind: setting.kind, key: setting.key }).sort({ version: -1 }).session(session).lean();
  if ((previous?.version || 0) !== setting.expectedVersion) throw fail('Settings changed in another window. Reload before saving.', 409);
  const [revision] = await Revision.create([{
    kind: setting.kind, key: setting.key, team: setting.team,
    effectiveFrom: setting.effectiveFrom, values: setting.values,
    version: setting.expectedVersion + 1, changedBy: actorId, reason: setting.reason,
    historicalCorrection: setting.historicalCorrection === true,
  }], { session });
  await Audit.create([{
    action: previous ? 'setting-revised' : 'setting-created', revision: revision._id,
    previousRevision: previous?._id || null, team: setting.team, actor: actorId, reason: setting.reason,
    historicalCorrection: setting.historicalCorrection === true,
  }], { session });
  return revision.toObject();
}
async function saveSetting(kind, body, actor, { historical = false } = {}) {
  // Do not use isAdminRole: managers inherit admin elsewhere in the CRM, but
  // Production configuration is restricted to actual admin/alpha accounts.
  if (!['admin', 'alpha'].includes(actor?.role)) throw fail('Only an Admin can configure Production.', 403);
  const actorId = objectId(String(actor._id || ''), 'administrator');
  if (historical && !['team-billing', 'classification', 'rate'].includes(kind)) throw fail('Historical correction does not apply to access grants.');
  const setting = validateSetting(kind, body, historical ? { earliestDate: '1900-01-01' } : undefined);
  if (historical && setting.effectiveFrom > today()) throw fail('Use normal settings for future effective dates.');
  if (historical && setting.reason.length < 10) throw fail('Explain the historical correction in at least 10 characters.');
  setting.historicalCorrection = historical;
  await assertInitialized();
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await assertReferences(setting, session);
      result = await appendSetting(setting, actorId, session);
    });
    return result;
  } catch (error) {
    if (error.code === 11000) throw fail('Settings changed in another window. Reload before saving.', 409);
    throw error;
  } finally { await session.endSession(); }
}
async function saveClassificationBatch(body, actor, { historical = false } = {}) {
  if (!['admin', 'alpha'].includes(actor?.role)) throw fail('Only an Admin can configure Production.', 403);
  const actorId = objectId(String(actor._id || ''), 'administrator');
  if (!Array.isArray(body?.tasks) || !body.tasks.length || body.tasks.length > 1000) throw fail('Select between 1 and 1000 tasks.');
  const settings = body.tasks.map(row => {
    const setting = validateSetting('classification', { ...body, targetType: 'task', target: row?.task, expectedVersion: row?.expectedVersion }, historical ? { earliestDate: '1900-01-01' } : undefined);
    if (historical && setting.effectiveFrom > today()) throw fail('Use normal settings for future effective dates.');
    if (historical && setting.reason.length < 10) throw fail('Explain the historical correction in at least 10 characters.');
    return { ...setting, historicalCorrection: historical };
  });
  if (new Set(settings.map(row => row.key)).size !== settings.length) throw fail('Each task may be selected only once.');
  await assertInitialized();
  const session = await mongoose.startSession();
  let revisions;
  try {
    await session.withTransaction(async () => {
      const first = settings[0];
      if (!await Team.exists({ _id: first.team, ...(historical ? {} : { isActive: true }) }).session(session)) throw fail('Team not found or unavailable for this change.', 404);
      const tasks = await Task.find({ _id: { $in: settings.map(row => row.values.target) }, ...await taskTeamScope(first.team, session) }).select('taskType').session(session).lean();
      if (tasks.length !== settings.length) throw fail('Some tasks are missing or no longer linked to the selected team. Reload before saving.', 409);
      if (tasks.some(task => task.taskType === 'break') && !['break-idle', 'excluded'].includes(first.values.category)) throw fail('Deselect break tasks or classify the selection as Break / Idle or excluded.');
      const previous = await Revision.aggregate([
        { $match: { kind: 'classification', key: { $in: settings.map(row => row.key) } } },
        { $sort: { version: -1 } }, { $group: { _id: '$key', revision: { $first: '$$ROOT' } } },
      ]).session(session);
      const byKey = new Map(previous.map(row => [row._id, row.revision]));
      if (settings.some(row => (byKey.get(row.key)?.version || 0) !== row.expectedVersion)) throw fail('Some classifications changed in another window. Reload the task list before saving.', 409);
      revisions = await Revision.insertMany(settings.map(row => ({ kind: row.kind, key: row.key, team: row.team, values: row.values,
        effectiveFrom: row.effectiveFrom, version: row.expectedVersion + 1, reason: row.reason, changedBy: actorId, historicalCorrection: historical })), { session });
      await Audit.insertMany(revisions.map(row => ({ action: byKey.has(row.key) ? 'setting-revised' : 'setting-created',
        revision: row._id, previousRevision: byKey.get(row.key)?._id || null, team: row.team, actor: actorId, reason: row.reason, historicalCorrection: historical })), { session });
    });
    return revisions.map(row => row.toObject());
  } catch (error) {
    if (error.code === 11000) throw fail('Some classifications changed in another window. Reload the task list before saving.', 409);
    throw error;
  } finally { await session.endSession(); }
}
module.exports = { ensureProductionSettingsIndexes, saveSetting, saveClassificationBatch, appendSetting, productionStoragePlan };
