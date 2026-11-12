const Team = require('../../models/Team');
const Client = require('../../models/Client');
const Project = require('../../models/Project');
const Task = require('../../models/Task');
const Employee = require('../../models/Employee');
const Revision = require('../../models/ProductionSettingsRevision');
const { taskTeamScope, rateTeamClients } = require('../../services/production/settingsCatalog');
const { productionAccess, scopedEmployees } = require('../../services/production/access');
const { loadProductionCalculation } = require('../../services/production/calculationService');
const { objectId, fail } = require('../../services/production/settingsValidation');
const { getBillingDateRange } = require('../../utils/billingUtils');

const id = value => String(value?._id || value || '');
const kinds = { overview: 'daily', weekly: 'weekly', monthly: 'monthly', employee: 'members', team: 'teams', client: 'clientProjects', task: 'tasks', details: 'details' };
function groupedWorkDetails(details) {
  const grouped = new Map();
  for (const row of details) {
    const key = [row.date, row.employee, row.team, row.client, row.project, row.task, row.category, row.billing?.status, row.billing?.currency, row.billing?.rateRevision].join(':');
    const previous = grouped.get(key);
    if (!previous) grouped.set(key, { ...row, billing: row.billing ? { ...row.billing } : undefined, timeLogIds: [...row.timeLogIds] });
    else {
      for (const field of Object.keys(row).filter(key => key.endsWith('Seconds'))) previous[field] += row[field];
      previous.timeLogIds = [...new Set([...previous.timeLogIds, ...row.timeLogIds])];
      previous.startedAt = previous.startedAt < row.startedAt ? previous.startedAt : row.startedAt;
      previous.stoppedAt = previous.stoppedAt > row.stoppedAt ? previous.stoppedAt : row.stoppedAt;
      if (previous.billing?.billableSeconds !== undefined) previous.billing.billableSeconds += row.billing.billableSeconds || 0;
    }
  }
  return [...grouped.values()];
}
function pageNumber(value, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw fail('Invalid Production pagination.');
  return Number(value);
}
function errorResponse(res, error) {
  return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to load Production. Please try again.' });
}
async function productionReportData(user, query, { allRows = false } = {}) {
    const { startDate, endDate } = query;
    if (typeof startDate !== 'string' || typeof endDate !== 'string') throw fail('Choose a valid date range.');
    try { getBillingDateRange(startDate, endDate, process.env.APP_TIMEZONE || 'Asia/Kolkata'); } catch (error) { throw fail(error.message); }
    const view = query.view || 'overview';
    if (!Object.hasOwn(kinds, view)) throw fail('Choose a valid Production view.');
    const page = pageNumber(query.page, 1, 10000), limit = pageNumber(query.limit, 25, 100);
    const access = await productionAccess(user);
    const roster = await scopedEmployees(access);
    let selected = roster;
    if (query.employee && query.employee !== 'all') {
      const requested = objectId(query.employee, 'employee');
      selected = roster.filter(employee => id(employee) === requested);
      if (!selected.length) throw fail('Employee is outside your Production access.', 403);
    }
    const filters = {};
    for (const key of ['team', 'client', 'project', 'task']) if (query[key] !== undefined && query[key] !== 'all') filters[key] = objectId(query[key], key);
    if (filters.team && access.teamIds && !access.teamIds.includes(filters.team)) throw fail('Team is outside your Production access.', 403);
    const result = await loadProductionCalculation({ employeeIds: selected.map(id), startDate, endDate, filters,
      allowedTeamIds: access.teamIds, billingTeamIds: access.billingTeamIds, includeBilling: access.includeBilling });
    if (filters.team || filters.client || filters.project || filters.task) result.members = result.members.filter(row => row.actualSeconds > 0 || (filters.team && row.team === filters.team && !filters.client && !filters.project && !filters.task));
    let rows = result[kinds[view]];
    if (view === 'details') rows = groupedWorkDetails(rows).sort((a, b) => b.date.localeCompare(a.date) || a.client?.localeCompare(b.client || '') || a.project.localeCompare(b.project) || a.task.localeCompare(b.task));
    if (view === 'employee') rows = [...rows].sort((a, b) => a.fullName.localeCompare(b.fullName) || a.employee.localeCompare(b.employee));
    const total = rows.length;
    if (allRows && total > 5000) throw fail('Narrow the report to at most 5000 rows before exporting.', 413);
    if (!allRows) rows = rows.slice((page - 1) * limit, page * limit);
    const includeChoices = query.includeChoices !== 'false';
    const idsFor = (kind, field) => includeChoices ? result.choiceIds[kind] : [...new Set(rows.map(row => row[field]).filter(Boolean))];
    const [teams, clients, projects, tasks] = await Promise.all([
      Team.find(!includeChoices ? { _id: { $in: [...new Set(rows.map(row => row.team).filter(Boolean))] } } : access.teamIds ? { _id: { $in: access.teamIds } } : access.mode === 'personal'
        ? { _id: { $in: [...new Set([...roster.map(row => id(row.team)), ...result.teams.map(row => row.team)].filter(Boolean))] } } : {})
        .select('_id teamName').sort('teamName').lean(),
      Client.find({ _id: { $in: idsFor('clients', 'client') } }).select('_id clientName').sort('clientName').lean(),
      Project.find({ _id: { $in: idsFor('projects', 'project') } }).select('_id projectName projectCode').sort('projectName').lean(),
      Task.find({ _id: { $in: idsFor('tasks', 'task') } }).select('_id taskName taskCode').sort('taskName').lean(),
    ]);
    const labels = (records, name) => new Map(records.map(row => [id(row), row[name]]));
    const maps = { team: labels(teams, 'teamName'), client: labels(clients, 'clientName'), project: labels(projects, 'projectName'), task: labels(tasks, 'taskName'),
      employee: new Map(roster.map(row => [id(row), row.fullName])) };
    const taskCodes = new Map(tasks.map(row => [id(row), row.taskCode])), projectCodes = new Map(projects.map(row => [id(row), row.projectCode]));
    const selectionLabels = Object.fromEntries(['team', 'employee', 'client', 'project', 'task'].map(key => [key,
      !query[key] || query[key] === 'all' ? `All available ${key === 'employee' ? 'employees' : `${key}s`}` : maps[key].get(query[key]) || `Selected ${key}`]));
    rows = rows.map(row => ({ ...row, ...Object.fromEntries(Object.entries(maps).filter(([key]) => row[key] !== undefined).map(([key, map]) =>
      [`${key}Name`, map.get(row[key]) || (row[key] ? `Unavailable ${key}` : key === 'team' ? view === 'employee' ? 'No home team' : 'Needs team allocation' : `No ${key} recorded`)])),
      ...(row.task ? { taskCode: taskCodes.get(row.task) || row.task } : {}),
      ...(row.project ? { projectCode: projectCodes.get(row.project) || row.project } : {}) }));
    return { summary: { ...result.totals, employeeCount: result.members.length }, rows, total, page, limit, view,
      period: result.period, asOf: result.asOf, provisional: true,
      warnings: result.warnings.map(({ code, count }) => ({ code, count })),
      scope: { mode: access.mode, financialAccess: access.includeBilling, canConfigure: ['admin', 'alpha'].includes(user.role) },
      choices: includeChoices ? { employees: roster, teams, clients, projects, tasks } : undefined, selectionLabels, targetBasis: result.targetBasis, filterTargetBasis: result.filterTargetBasis };
}
async function getReport(req, res) {
  try { return res.json({ success: true, report: await productionReportData(req.user, req.query) }); }
  catch (error) { return errorResponse(res, error); }
}
async function getSettingsCatalog(req, res) {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = name => search ? { [name]: { $regex: escaped, $options: 'i' } } : {};
    const taskTeam = req.query.taskTeam === undefined ? null : objectId(req.query.taskTeam, 'team');
    const rateTeam = req.query.rateTeam === undefined ? null : objectId(req.query.rateTeam, 'team');
    const accessTeam = req.query.accessTeam === undefined ? null : objectId(req.query.accessTeam, 'team');
    if (rateTeam && accessTeam && rateTeam !== accessTeam) throw fail('Choose one team for employee selections.');
    const employeeTeam = accessTeam || rateTeam;
    if (req.query.includeInactiveClients !== undefined && !['true', 'false'].includes(req.query.includeInactiveClients)) throw fail('Choose whether to include inactive clients.');
    const includeInactiveClients = req.query.includeInactiveClients === 'true';
    if (req.query.includeArchivedTasks !== undefined && !['true', 'false'].includes(req.query.includeArchivedTasks)) throw fail('Choose whether to include archived tasks.');
    const includeArchivedTasks = req.query.includeArchivedTasks === 'true';
    // Unassigned legacy tasks can inherit a team from their project. Explicit
    // task assignments take precedence over a project's shared team list.
    const taskScope = taskTeam ? await taskTeamScope(taskTeam) : {};
    const clientScope = rateTeam ? await rateTeamClients(rateTeam, { historical: includeInactiveClients }) : null;
    const [teams, employees, clients, projects, tasks] = await Promise.all([
      Team.find({ isActive: true }).select('_id teamName').sort('teamName').limit(1001).lean(),
      Employee.find({ ...filter('fullName'), isActive: true, ...(employeeTeam ? { team: employeeTeam } : {}) }).select(`_id fullName employeeId role team${rateTeam ? ' projectRates updatedAt' : ''}`).populate(rateTeam ? { path: 'projectRates.project', select: 'projectName projectCode' } : []).sort('fullName').limit(1001).lean(),
      Client.find({ ...filter('clientName'), ...(clientScope ? { _id: { $in: clientScope.ids } } : {}), ...(rateTeam && !includeInactiveClients ? { status: 'Active' } : {}) }).select('_id clientName company status').sort({ clientName: 1, _id: 1 }).limit(1001).lean(),
      Project.find({ ...filter('projectName'), ...(rateTeam ? { teams: rateTeam, status: 'Active', deletedAt: null } : {}) }).select('_id projectName projectCode').sort('projectName').limit(1001).lean(),
      Task.find({ ...filter('taskName'), ...taskScope, ...(taskTeam && !includeArchivedTasks ? { isActive: true, deletedAt: null } : {}) })
        .select('_id taskName taskCode taskType project isActive deletedAt').populate('project', 'projectName projectCode').sort({ taskName: 1, _id: 1 }).limit(1001).lean(),
    ]);
    if ([teams, employees, clients, projects, tasks].some(rows => rows.length > 1000)) throw fail('Search for a more specific name to narrow the settings catalog.', 413);
    const versions = taskTeam && tasks.length ? await Revision.aggregate([
      { $match: { kind: 'classification', key: { $in: tasks.map(task => `${taskTeam}:task:${task._id}`) } } },
      { $group: { _id: '$key', version: { $max: '$version' } } },
    ]) : [];
    const latest = new Map(versions.map(row => [row._id, row.version]));
    return res.json({ success: true, teams, employees,
      clients: clients.map(client => ({ ...client, ...(clientScope && !clientScope.currentIds.includes(id(client)) ? { historicalOnly: true } : {}) })), projects,
      tasks: tasks.map(task => ({ ...task, classificationVersion: latest.get(`${taskTeam}:task:${task._id}`) || 0 })) });
  } catch (error) { return errorResponse(res, error); }
}
module.exports = { getReport, getSettingsCatalog, productionReportData };
