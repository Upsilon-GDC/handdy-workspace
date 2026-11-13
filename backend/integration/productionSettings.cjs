// Isolated loopback replica set only; never read .env or a production URI.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Revision = require('../src/models/ProductionSettingsRevision');
const Audit = require('../src/models/ProductionAuditEvent');
const Team = require('../src/models/Team');
const Employee = require('../src/models/Employee');
const Task = require('../src/models/Task');
const Client = require('../src/models/Client');
const ClientPolicy = require('../src/models/ClientAccessPolicy');
const Activity = require('../src/models/ActivityMapping');
const Project = require('../src/models/Project');
const reports = require('../src/modules/production/productionReportController');
const Log = require('../src/models/TaskTimeLog');
const { archiveDuplicateTask } = require('../src/services/archiveDuplicateTask');
const { saveSetting, saveClassificationBatch, ensureProductionSettingsIndexes } = require('../src/services/production/settingsService');
const { initializeProduction } = require('../src/services/production/initialization');
const { today } = require('../src/services/production/settingsValidation');
const controller = require('../src/modules/production/productionSettingsController');
const { productionAccess } = require('../src/services/production/access');
const actor = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
let replica, team;
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  const uri = replica.getUri(`crm_production_settings_${crypto.randomUUID().replaceAll('-', '')}`);
  assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  for (const Model of [Team, Employee, Task, Client, Activity, Project, ClientPolicy]) { await Model.createCollection(); await Model.createIndexes(); }
  await ensureProductionSettingsIndexes();
  await Employee.collection.insertOne({ _id: actor._id, role: 'admin', isActive: true });
  team = await Team.create({ teamName: 'WCPA', createdBy: actor._id });
}, { timeout: 180000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
const body = (overrides = {}) => ({ team: String(team._id), effectiveFrom: today(), billingEnabled: true, approvalRequired: true,
  currency: 'USD', expectedVersion: 0, reason: 'Integration setup', ...overrides });
async function invoke(handler, kind, query = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ params: { kind }, query, user: actor }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body)); return res.body;
}
test('initialization preview does not write and repeat apply preserves admin changes', async () => {
  const other = await Team.create({ teamName: 'Renau CPA', createdBy: actor._id });
  const options = { effectiveFrom: today(), currency: 'USD', actorId: String(actor._id) };
  const preview = await initializeProduction(options);
  assert.equal(preview.applied, false); assert.equal(await Revision.countDocuments(), 0); assert.equal(await Audit.countDocuments(), 0);
  await initializeProduction({ ...options, apply: true });
  assert.equal(await Revision.countDocuments(), 2); assert.equal(await Audit.countDocuments(), 2);
  const renau = await Revision.findOne({ team: other._id }).lean();
  assert.equal(renau.values.billingEnabled, false); assert.equal(renau.values.currency, null);
  await saveSetting('team-billing', body({ team: String(other._id), expectedVersion: 1 }), actor);
  await initializeProduction({ ...options, apply: true });
  assert.equal(await Revision.countDocuments(), 3);
  assert.equal((await Revision.findOne({ team: other._id }).sort({ version: -1 }).lean()).values.billingEnabled, true);
});
test('revision history and audit are append-only; stale edits fail without partial writes', async () => {
  const old = await Revision.findOne({ team: team._id }).lean();
  const saved = await saveSetting('team-billing', body({ expectedVersion: 1, billingEnabled: false }), actor);
  assert.equal(saved.version, 2); assert.equal(saved.values.currency, null);
  assert.deepEqual(await Revision.findById(old._id).lean(), old);
  const audit = await Audit.findOne({ revision: saved._id }).lean();
  assert.equal(String(audit.previousRevision), String(old._id)); assert.equal(String(audit.actor), String(actor._id));
  const count = await Revision.countDocuments(), auditCount = await Audit.countDocuments();
  await assert.rejects(saveSetting('team-billing', body({ expectedVersion: 1 }), actor), { statusCode: 409 });
  assert.equal(await Revision.countDocuments(), count); assert.equal(await Audit.countDocuments(), auditCount);
});
test('configuration and audit roll back together when audit insert fails', async t => {
  t.mock.method(Audit, 'create', async () => { throw new Error('Synthetic audit failure'); });
  const count = await Revision.countDocuments();
  await assert.rejects(saveSetting('team-billing', body({ expectedVersion: 2 }), actor), /Synthetic audit failure/);
  assert.equal(await Revision.countDocuments(), count);
});
test('simultaneous edits cannot overwrite one another', async () => {
  const results = await Promise.allSettled([
    saveSetting('team-billing', body({ expectedVersion: 2, reason: 'Concurrent first' }), actor),
    saveSetting('team-billing', body({ expectedVersion: 2, reason: 'Concurrent second' }), actor),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.statusCode, 409);
  assert.equal(await Revision.countDocuments({ team: team._id, version: 3 }), 1);
});
test('rates and classifications retain independent histories and reject missing references', async () => {
  const task = await Task.create({ taskCode: crypto.randomUUID(), taskName: 'Training', createdBy: actor._id });
  const classification = await saveSetting('classification', body({ targetType: 'task', target: String(task._id), category: 'training', billable: false }), actor);
  assert.equal(classification.values.category, 'training');
  const breakTask = await Task.create({ taskCode: crypto.randomUUID(), taskName: 'Pause', taskType: 'break', createdBy: actor._id });
  await assert.rejects(saveSetting('classification', body({ targetType: 'task', target: String(breakTask._id), category: 'productive', billable: true }), actor), /Break tasks must remain excluded/);
  await assert.rejects(saveSetting('classification', body({ targetType: 'task', target: String(breakTask._id), category: 'excluded', billable: false, reportOptionalBillable: true }), actor), /Break tasks cannot offer optional/);
  await saveSetting('rate', body({ enabled: true, hourlyRate: 25.15 }), actor);
  const changed = await saveSetting('rate', body({ enabled: true, hourlyRate: 30, expectedVersion: 1, effectiveFrom: '2099-01-01' }), actor);
  assert.equal(changed.values.hourlyRateHundredths, 3000);
  await assert.rejects(saveSetting('rate', body({ employee: String(new mongoose.Types.ObjectId()), enabled: true, hourlyRate: 10 }), actor), { statusCode: 404 });
  const rates = await invoke(controller.listSettings, 'rate', { team: String(team._id), asOf: today() });
  assert.equal(rates.items[0].revision.values.hourlyRateHundredths, 2515);
  assert.equal(rates.items[0].latestVersion, 2, 'As-of values still expose correct optimistic concurrency version');
  const history = await invoke(controller.history, 'rate', { key: changed.key, limit: '1' });
  assert.equal(history.total, 2); assert.equal(history.items.length, 1); assert.equal(history.items[0].version, 2);
});
test('audit pagination is bounded and invalid filters fail validation', async () => {
  const audit = await invoke(controller.listAudit, null, { team: String(team._id), limit: '2' });
  assert.equal(audit.items.length, 2); assert.ok(audit.total > 2);
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await controller.listSettings({ params: { kind: 'rate' }, query: { team: { $ne: null } } }, res);
  assert.equal(res.code, 400);
  await controller.listAudit({ query: { limit: '1000' } }, res); assert.equal(res.code, 400);
});
test('writes fail closed if the concurrency index has not been initialized', async () => {
  await Revision.collection.dropIndex('production_setting_version');
  try {
    await assert.rejects(saveSetting('team-billing', body({ expectedVersion: 3 }), actor), { statusCode: 503, publicCode: 'PRODUCTION_INITIALIZATION_REQUIRED' });
    const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await controller.save({ params: { kind: 'team-billing' }, body: body({ expectedVersion: 3 }), user: actor }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.code, 'PRODUCTION_INITIALIZATION_REQUIRED');
  } finally { await ensureProductionSettingsIndexes(); }
});
test('team access and financial visibility have independently audited revisions', async () => {
  const managerId = new mongoose.Types.ObjectId();
  await Employee.collection.insertOne({ _id: managerId, fullName: 'Synthetic Manager', employeeId: 'SYN-MANAGER', email: 'manager@example.invalid', role: 'manager', isActive: true });
  const first = await saveSetting('access', body({ employee: String(managerId), enabled: true, canViewBilling: false }), actor);
  assert.equal(first.values.canViewBilling, false);
  const revised = await saveSetting('access', body({ employee: String(managerId), enabled: true, canViewBilling: true, expectedVersion: 1 }), actor);
  assert.equal(revised.version, 2); assert.equal(revised.values.canViewBilling, true);
  const audit = await Audit.findOne({ revision: revised._id }).lean();
  assert.equal(String(audit.previousRevision), String(first._id));
  await assert.rejects(saveSetting('access', body({ employee: String(managerId), enabled: true, canViewBilling: true }), { _id: managerId, role: 'manager' }), { statusCode: 403 });
});

test('past team access dates are audited and cannot override a later effective revocation', async () => {
  const accessTeam = await Team.create({ teamName: 'Backdated access team', createdBy: actor._id });
  const manager = { _id: new mongoose.Types.ObjectId(), role: 'manager', team: accessTeam._id };
  await Employee.collection.insertOne({ ...manager, employeeId: 'SYN-BACKDATED-ACCESS', email: 'backdated-access@example.invalid', isActive: true });
  const input = body({ team: String(accessTeam._id), employee: String(manager._id), effectiveFrom: '2000-01-01',
    enabled: true, canViewBilling: true, reason: 'Record the original team access start date' });
  await assert.rejects(saveSetting('access', input, actor), { statusCode: 400 });
  await assert.rejects(saveSetting('access', { ...input, reason: 'short' }, actor, { historical: true }), { statusCode: 400 });
  const first = await saveSetting('access', input, actor, { historical: true });
  assert.equal(first.effectiveFrom, '2000-01-01'); assert.equal(first.historicalCorrection, true);
  assert.equal(await Audit.countDocuments({ revision: first._id, historicalCorrection: true }), 1);
  assert.deepEqual((await productionAccess(manager)).billingTeamIds, [String(accessTeam._id)]);
  const revoked = await saveSetting('access', { ...input, effectiveFrom: today(), expectedVersion: 1,
    enabled: false, canViewBilling: false, reason: 'Revoke the explicit financial access today' }, actor);
  await saveSetting('access', { ...input, effectiveFrom: '2000-01-02', expectedVersion: 2 }, actor, { historical: true });
  assert.deepEqual((await productionAccess(manager)).billingTeamIds, [], 'A newer effective date still takes precedence');
  assert.equal((await Revision.findById(revoked._id).lean()).values.enabled, false);
  assert.equal((await Revision.findById(first._id).lean()).effectiveFrom, '2000-01-01');
  const count = await Revision.countDocuments();
  await assert.rejects(saveSetting('access', input, manager, { historical: true }), { statusCode: 403 });
  await assert.rejects(saveSetting('access', input, actor, { historical: true }), { statusCode: 409 });
  await assert.rejects(saveSetting('access', { ...input, effectiveFrom: '2099-01-01' }, actor, { historical: true }), { statusCode: 400 });
  await Team.updateOne({ _id: accessTeam._id }, { $set: { isActive: false } });
  await assert.rejects(saveSetting('access', { ...input, expectedVersion: 3 }, actor, { historical: true }), { statusCode: 404 });
  assert.equal(await Revision.countDocuments(), count, 'Invalid changes must not append revisions');
});

test('classification catalog limits tasks to the selected team, including shared and legacy project tasks', async () => {
  const foreign = await Team.create({ teamName: 'Catalog other team', createdBy: actor._id });
  const project = await Project.create({ projectCode: 'CATALOG-P', projectName: 'Catalog project', teams: [team._id, foreign._id], createdBy: actor._id });
  const make = (name, fields = {}) => Task.create({ taskCode: `CATALOG-${name}`, taskName: `Catalog ${name}`, createdBy: actor._id, ...fields });
  const primary = await make('primary', { team: team._id });
  const shared = await make('shared', { team: foreign._id, teams: [team._id, foreign._id] });
  const legacy = await make('legacy', { project: project._id });
  const archived = await make('archived', { team: team._id, isActive: false });
  const deleted = await make('deleted', { team: team._id, isActive: true, deletedAt: new Date() });
  const other = await make('foreign', { team: foreign._id, project: project._id });
  await make('unassigned');
  const catalog = await invoke(reports.getSettingsCatalog, null, { taskTeam: String(team._id), search: 'Catalog' });
  assert.deepEqual(catalog.tasks.map(row => String(row._id)).sort(), [primary, shared, legacy].map(row => String(row._id)).sort());
  const historical = await invoke(reports.getSettingsCatalog, null, { taskTeam: String(team._id), search: 'Catalog', includeArchivedTasks: 'true' });
  assert.deepEqual(historical.tasks.map(row => String(row._id)).sort(), [primary, shared, legacy, archived, deleted].map(row => String(row._id)).sort());
  const foreignCatalog = await invoke(reports.getSettingsCatalog, null, { taskTeam: String(foreign._id), search: 'Catalog' });
  assert.deepEqual(foreignCatalog.tasks.map(row => String(row._id)).sort(), [shared, legacy, other].map(row => String(row._id)).sort());
  const search = await invoke(reports.getSettingsCatalog, null, { taskTeam: String(team._id), search: 'foreign' });
  assert.deepEqual(search.tasks, [], 'Search cannot broaden the chosen team');
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await reports.getSettingsCatalog({ query: { taskTeam: { $ne: null } } }, res);
  assert.equal(res.code, 400);
});

test('duplicate cleanup refuses different teams/projects and live timers, preserves logs, and requires a successful backup', async () => {
  const project = await Project.create({ projectCode: 'CLEANUP-P', projectName: 'Cleanup project', teams: [team._id], createdBy: actor._id });
  const client = await Client.create({ clientName: 'Cleanup client', createdBy: actor._id });
  const make = (code, overrides = {}) => Task.create({ taskCode: code, taskName: 'Same cleanup task', team: team._id, teams: [team._id], project: project._id, assignToAllEmployees: true, createdBy: actor._id, ...overrides });
  const keep = await make('CLEAN-KEEP'), retire = await make('CLEAN-RETIRE');
  const foreign = await make('CLEAN-FOREIGN', { team: new mongoose.Types.ObjectId(), teams: [] });
  const differentProject = await make('CLEAN-PROJECT', { project: new mongoose.Types.ObjectId() });
  await assert.rejects(archiveDuplicateTask({ keepId: keep._id, retireId: foreign._id }), /differ/);
  await assert.rejects(archiveDuplicateTask({ keepId: keep._id, retireId: differentProject._id }), /differ/);
  await assert.rejects(archiveDuplicateTask({ keepId: keep._id, retireId: retire._id, apply: true }), /backup/);
  const mappings = await Activity.create([keep, retire].map(task => ({ project: project._id, client: client._id, task: task._id, isActive: true })));
  const log = await Log.create({ employee: actor._id, project: project._id, task: retire._id, client: client._id, status: 'running', startedAt: new Date(), isActiveTimer: true });
  await assert.rejects(archiveDuplicateTask({ keepId: keep._id, retireId: retire._id }), /live timer/);
  await Log.updateOne({ _id: log._id }, { $set: { status: 'stopped', stoppedAt: new Date(), isActiveTimer: false, totalWorkedSeconds: 50 } });
  const originalLog = await Log.findById(log._id).lean();
  const preview = await archiveDuplicateTask({ keepId: keep._id, retireId: retire._id });
  assert.equal(preview.applied, false); assert.equal(preview.historicalLogsPreserved, 1);
  await assert.rejects(archiveDuplicateTask({ keepId: keep._id, retireId: retire._id, apply: true, backup: async () => { throw Error('Backup unavailable'); } }), /Backup unavailable/);
  assert.equal((await Task.findById(retire._id).lean()).isActive, true);
  let backedUp = false;
  const result = await archiveDuplicateTask({ keepId: keep._id, retireId: retire._id, apply: true, backup: async data => { assert.equal(data.tasks.length, 2); backedUp = true; } });
  assert.equal(backedUp, true); assert.equal(result.applied, true);
  const retired = await Task.findById(retire._id).lean(); assert.equal(retired.isActive, false); assert.ok(retired.deletedAt);
  assert.equal((await Task.findById(keep._id).lean()).isActive, true);
  assert.equal((await Activity.findById(mappings[1]._id).lean()).isActive, false);
  assert.equal((await Activity.findById(mappings[0]._id).lean()).isActive, true);
  assert.deepEqual(await Log.findById(log._id).lean(), originalLog);
});

test('rate and access catalogs scope employees to their team while rate clients keep historical choices', async () => {
  const other = await Team.create({ teamName: 'Rate other team', createdBy: actor._id });
  const own = new mongoose.Types.ObjectId(), foreign = new mongoose.Types.ObjectId();
  await Employee.collection.insertMany([
    { _id: own, fullName: 'Rate catalog own member', employeeId: 'CAT-OWN', email: 'rate-own@example.invalid', role: 'employee', team: team._id, isActive: true },
    { _id: foreign, fullName: 'Rate catalog foreign member', employeeId: 'CAT-FOREIGN', email: 'rate-foreign@example.invalid', role: 'employee', team: other._id, isActive: true },
    { _id: new mongoose.Types.ObjectId(), fullName: 'Rate catalog inactive member', employeeId: 'CAT-INACTIVE', email: 'rate-inactive@example.invalid', role: 'employee', team: team._id, isActive: false },
  ]);
  const active = await Client.create({ clientName: 'Rate catalog client', status: 'Active', createdBy: actor._id });
  const inactive = await Client.create({ clientName: 'Rate catalog client', status: 'Inactive', createdBy: actor._id });
  await Project.create({ projectCode: 'RATE-CLIENTS', projectName: 'Rate catalog project', teams: [team._id], client: active._id, clients: [active._id, inactive._id], createdBy: actor._id });
  const catalog = await invoke(reports.getSettingsCatalog, null, { rateTeam: String(team._id), search: 'Rate catalog' });
  assert.deepEqual(catalog.employees.map(row => String(row._id)), [String(own)]);
  assert.deepEqual(catalog.clients.map(row => String(row._id)), [String(active._id)]);
  assert.equal(catalog.employees[0].team.toString(), String(team._id));
  const historical = await invoke(reports.getSettingsCatalog, null, { rateTeam: String(team._id), search: 'Rate catalog', includeInactiveClients: 'true' });
  assert.deepEqual(historical.clients.map(row => String(row._id)).sort(), [active, inactive].map(row => String(row._id)).sort());
  assert.equal(historical.clients.find(row => String(row._id) === String(inactive._id)).status, 'Inactive');
  const foreignCatalog = await invoke(reports.getSettingsCatalog, null, { rateTeam: String(other._id), search: 'Rate catalog' });
  assert.deepEqual(foreignCatalog.employees.map(row => String(row._id)), [String(foreign)]);
  const access = await invoke(reports.getSettingsCatalog, null, { accessTeam: String(team._id), search: 'Rate catalog' });
  assert.deepEqual(access.employees.map(row => String(row._id)), [String(own)], 'Access selections include only active home-team members');
  const foreignAccess = await invoke(reports.getSettingsCatalog, null, { accessTeam: String(other._id), search: 'Rate catalog' });
  assert.deepEqual(foreignAccess.employees.map(row => String(row._id)), [String(foreign)]);
  const searchAccess = await invoke(reports.getSettingsCatalog, null, { accessTeam: String(team._id), search: 'foreign member' });
  assert.deepEqual(searchAccess.employees, [], 'Searching cannot broaden the access team');
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await reports.getSettingsCatalog({ query: { rateTeam: String(team._id), includeInactiveClients: { $ne: false } } }, res);
  assert.equal(res.code, 400);
  await reports.getSettingsCatalog({ query: { accessTeam: { $ne: null } } }, res);
  assert.equal(res.code, 400);
  await reports.getSettingsCatalog({ query: { accessTeam: String(team._id), rateTeam: String(other._id) } }, res);
  assert.equal(res.code, 400);
});

test('rate clients follow project/team client links, preserve shared identities and never fall back to all clients', async () => {
  const first = await Team.create({ teamName: 'Client scope A', createdBy: actor._id });
  const second = await Team.create({ teamName: 'Client scope B', createdBy: actor._id });
  const empty = await Team.create({ teamName: 'Client scope empty', createdBy: actor._id });
  const make = name => Client.create({ clientName: `Scoped client ${name}`, createdBy: actor._id });
  const a = await make('A'), b = await make('B'), shared = await make('shared'), unlinked = await make('unlinked');
  const archived = await Client.create({ clientName: 'Scoped client archived', status: 'Inactive', createdBy: actor._id });
  await Project.create([
    { projectCode: 'CLIENT-SCOPE-A', projectName: 'Scope A project', teams: [first._id], client: a._id, clients: [a._id, archived._id], createdBy: actor._id },
    { projectCode: 'CLIENT-SCOPE-B', projectName: 'Scope B project', teams: [second._id], clients: [b._id], createdBy: actor._id },
    { projectCode: 'CLIENT-SCOPE-SHARED', projectName: 'Scope shared project', teams: [first._id, second._id], clients: [shared._id], createdBy: actor._id },
  ]);
  const ids = rows => rows.map(row => String(row._id)).sort();
  const catalog = teamId => invoke(reports.getSettingsCatalog, null, { rateTeam: String(teamId), search: 'Scoped client' });
  assert.deepEqual(ids((await catalog(first._id)).clients), ids([a, shared]));
  assert.deepEqual(ids((await catalog(second._id)).clients), ids([b, shared]));
  assert.deepEqual((await catalog(empty._id)).clients, []);
  const historical = await invoke(reports.getSettingsCatalog, null, { rateTeam: String(first._id), search: 'Scoped client', includeInactiveClients: 'true' });
  assert.deepEqual(ids(historical.clients), ids([a, archived, shared]));
  const searched = await invoke(reports.getSettingsCatalog, null, { rateTeam: String(first._id), search: 'Scoped client B' });
  assert.deepEqual(searched.clients, []);
  await ClientPolicy.create({ subjectType: 'team', subjectId: first._id, enabled: true, clients: [a._id], updatedBy: actor._id });
  assert.deepEqual(ids((await catalog(first._id)).clients), ids([a]), 'Explicit team client access overrides broader project choices');
  await saveSetting('rate', { team: String(first._id), client: String(unlinked._id), employee: null, enabled: true, hourlyRate: 10,
    currency: 'USD', effectiveFrom: today(), reason: 'Preserve previous team client rate', expectedVersion: 0 }, actor);
  assert.deepEqual(ids((await catalog(first._id)).clients), ids([a]), 'Previous rates do not broaden normal choices');
  const previous = await invoke(reports.getSettingsCatalog, null, { rateTeam: String(first._id), search: 'Scoped client', includeInactiveClients: 'true' });
  assert.deepEqual(ids(previous.clients), ids([a, unlinked]));
  assert.equal(previous.clients.find(row => String(row._id) === String(unlinked._id)).historicalOnly, true);
  await ClientPolicy.updateOne({ subjectType: 'team', subjectId: first._id }, { $set: { clients: [] } });
  assert.deepEqual((await catalog(first._id)).clients, [], 'An explicit empty team selection does not reopen company access');
});

async function batchFixture() {
  const prefix = `Bulk ${crypto.randomUUID()}`;
  const tasks = await Task.create([0, 1].map(index => ({ taskName: `${prefix} ${index}`, taskCode: crypto.randomUUID(), teams: [team._id], createdBy: actor._id })));
  const input = { team: String(team._id), category: 'productive', billable: true, effectiveFrom: today(), reason: 'Apply reviewed work classifications',
    tasks: tasks.map(row => ({ task: String(row._id), expectedVersion: 0 })) };
  const keys = tasks.map(row => `${team._id}:task:${row._id}`);
  return { prefix, tasks, input, keys };
}
test('bulk classifications save one revision/audit per task, expose versions and reject a repeated stale save', async () => {
  const { prefix, input, keys } = await batchFixture();
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await controller.saveClassificationBatch({ body: input, user: actor }, res);
  assert.equal(res.code, 201); assert.equal(res.body.count, 2);
  const revisions = await Revision.find({ key: { $in: keys } }).lean();
  assert.equal(revisions.length, 2); assert.ok(revisions.every(row => row.version === 1 && row.values.category === 'productive' && row.values.billable));
  assert.equal(await Audit.countDocuments({ revision: { $in: revisions.map(row => row._id) } }), 2);
  const catalog = await invoke(reports.getSettingsCatalog, null, { taskTeam: String(team._id), search: prefix });
  assert.equal(catalog.tasks.length, 2); assert.ok(catalog.tasks.every(row => row.classificationVersion === 1));
  await assert.rejects(saveClassificationBatch(input, actor), { statusCode: 409 });
  assert.equal(await Revision.countDocuments({ key: { $in: keys } }), 2);
});
test('one stale classification prevents every other task in the batch from changing', async () => {
  const { input, keys } = await batchFixture();
  await saveSetting('classification', { ...input, targetType: 'task', target: input.tasks[0].task, expectedVersion: 0 }, actor);
  const before = await Audit.countDocuments();
  await assert.rejects(saveClassificationBatch(input, actor), { statusCode: 409 });
  assert.equal(await Revision.countDocuments({ key: keys[1] }), 0); assert.equal(await Audit.countDocuments(), before);
});
test('simultaneous bulk edits commit one complete set of revisions and reject the other writer', async () => {
  const { input, keys } = await batchFixture();
  const results = await Promise.allSettled([saveClassificationBatch(input, actor), saveClassificationBatch(input, actor)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.statusCode, 409);
  const revisions = await Revision.find({ key: { $in: keys } }).lean();
  assert.equal(revisions.length, 2);
  assert.equal(await Audit.countDocuments({ revision: { $in: revisions.map(row => row._id) } }), 2);
});
test('bulk classification audit failure rolls back all inserted revisions', async t => {
  const { input, keys } = await batchFixture();
  t.mock.method(Audit, 'insertMany', async () => { throw Error('Synthetic bulk audit failure'); });
  await assert.rejects(saveClassificationBatch(input, actor), /Synthetic bulk audit failure/);
  assert.equal(await Revision.countDocuments({ key: { $in: keys } }), 0);
});
test('bulk classifications reject foreign tasks and break-as-production without partial saves', async () => {
  const { input, tasks, keys } = await batchFixture();
  const foreign = await Task.create({ taskCode: crypto.randomUUID(), taskName: 'Bulk foreign task', teams: [new mongoose.Types.ObjectId()], createdBy: actor._id });
  await assert.rejects(saveClassificationBatch({ ...input, tasks: [input.tasks[0], { task: String(foreign._id), expectedVersion: 0 }] }, actor), { statusCode: 409 });
  await Task.updateOne({ _id: tasks[1]._id }, { $set: { taskType: 'break' } });
  await assert.rejects(saveClassificationBatch(input, actor), /Deselect break tasks/);
  assert.equal(await Revision.countDocuments({ key: { $in: keys } }), 0);
  const revisions = await saveClassificationBatch({ ...input, category: 'break-idle', billable: false }, actor);
  assert.ok(revisions.every(row => !row.values.billable));
});
test('bulk historical corrections require a detailed reason, keep audit flags and enforce role/input boundaries', async () => {
  const { input, keys } = await batchFixture();
  await assert.rejects(saveClassificationBatch(input, { ...actor, role: 'manager' }), { statusCode: 403 });
  await assert.rejects(saveClassificationBatch({ ...input, tasks: [input.tasks[0], input.tasks[0]] }, actor), { statusCode: 400 });
  await assert.rejects(saveClassificationBatch({ ...input, tasks: [] }, actor), { statusCode: 400 });
  await assert.rejects(saveClassificationBatch({ ...input, tasks: Array(1001).fill(input.tasks[0]) }, actor), { statusCode: 400 });
  await assert.rejects(saveClassificationBatch({ ...input, effectiveFrom: '2000-01-01' }, actor), { statusCode: 400 });
  await assert.rejects(saveClassificationBatch({ ...input, effectiveFrom: '2000-01-01', reason: 'short' }, actor, { historical: true }), { statusCode: 400 });
  const revisions = await saveClassificationBatch({ ...input, category: 'training', billable: false, effectiveFrom: '2000-01-01' }, actor, { historical: true });
  assert.equal(revisions.length, 2); assert.ok(revisions.every(row => row.historicalCorrection && row.values.category === 'training'));
  assert.equal(await Audit.countDocuments({ revision: { $in: revisions.map(row => row._id) }, historicalCorrection: true }), 2);
  assert.equal(await Revision.countDocuments({ key: { $in: keys } }), 2);
});

test('inline rate edits update the employee source and enforce scope, validation and stale edits', async () => {
  const project = await Project.create({ projectName: 'Inline billing', projectCode: crypto.randomUUID(), teams: [team._id], createdBy: actor._id });
  const foreign = await Team.create({ teamName: crypto.randomUUID(), createdBy: actor._id });
  const foreignProject = await Project.create({ projectName: 'Other team project', projectCode: crypto.randomUUID(), teams: [foreign._id], createdBy: actor._id });
  const employee = await Employee.create({ employeeId: crypto.randomUUID(), fullName: 'Rate Editor Test', email: `${crypto.randomUUID()}@example.invalid`, password: 'Synthetic-password-123', team: team._id, projectRates: [] });
  const request = { team: String(team._id), expectedUpdatedAt: employee.updatedAt.toISOString(), projectRates: [{ project: String(project._id), chargeRate: 32.5 }] };
  const call = async (body = request, user = actor) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
    await controller.updateEmployeeRates({ params: { employee: String(employee._id) }, body, user }, res); return res;
  };
  assert.equal((await call(request, { ...actor, role: 'manager' })).code, 403);
  assert.equal((await call({ ...request, role: 'admin' })).code, 400);
  assert.equal((await call({ ...request, projectRates: [{ project: String(foreignProject._id), chargeRate: 20 }] })).code, 400);
  assert.equal((await call({ ...request, projectRates: [{ project: String(project._id), chargeRate: 0 }] })).code, 400);
  assert.equal((await call({ ...request, team: String(foreign._id) })).code, 404);
  const saved = await call(); assert.equal(saved.code, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.employee.projectRates[0].project.projectName, project.projectName);
  const ordinary = await Employee.findById(employee._id).lean();
  assert.equal(ordinary.projectRates[0].chargeRate, 32.5); assert.equal(String(ordinary.projectRates[0].project), String(project._id)); assert.equal(ordinary.role, 'employee');
  assert.equal(saved.body.employee.password, undefined);
  assert.equal((await call({ ...request, projectRates: [{ project: String(project._id), chargeRate: 70 }] })).code, 409);
  const revisions = await invoke(reports.getSettingsCatalog, null, { rateTeam: String(team._id) });
  assert.equal(revisions.employees.find(row => String(row._id) === String(employee._id)).projectRates[0].chargeRate, 32.5);
  assert.equal(revisions.projects.some(row => String(row._id) === String(foreignProject._id)), false);
  const removed = await call({ ...request, expectedUpdatedAt: saved.body.employee.updatedAt.toISOString(), projectRates: [] });
  assert.equal(removed.code, 200); assert.equal((await Employee.findById(employee._id).lean()).projectRates.length, 0);
});
