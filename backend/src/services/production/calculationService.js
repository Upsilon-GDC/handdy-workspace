const mongoose = require('mongoose');
const Employee = require('../../models/Employee');
const TaskTimeLog = require('../../models/TaskTimeLog');
const Task = require('../../models/Task');
const Project = require('../../models/Project');
const Attendance = require('../../models/Attendance');
const Policy = require('../../models/WorkingHoursPolicy');
const Revision = require('../../models/ProductionSettingsRevision');
const Allocation = require('../../models/ProductionWorkAllocation');
const { calculateProduction } = require('./calculationEngine');
const { objectId, fail } = require('./settingsValidation');
const { getBillingDateRange } = require('../../utils/billingUtils');

// Internal service: the Production API supplies the authorized employee/team
// scope and financial team grants before calling this service. Never infer
// authorization from query-string flags. No company-wide default.
async function loadProductionCalculation({ employeeIds, startDate, endDate, timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata',
  includeBilling = false, filters = {}, now = Date.now(), allowedTeamIds = null, billingTeamIds = null, session = null, includeSources = false }) {
  if (!Array.isArray(employeeIds) || employeeIds.length > 1000) throw fail('Provide an authorized employee selection of at most 1000 people.');
  const read = async queries => {
    if (!session) return Promise.all(queries);
    const results = [];
    for (const query of queries) results.push(await query);
    return results;
  };
  const ids = [...new Set(employeeIds.map(value => objectId(value, 'employee')))];
  const selectedFilters = {};
  for (const field of ['team', 'client', 'project', 'task']) if (filters[field] !== undefined) selectedFilters[field] = objectId(filters[field], field);
  let range;
  try { range = getBillingDateRange(startDate, endDate, timezone); } catch (error) { throw fail(error.message); }
  const employeeMatch = { $in: ids.map(value => new mongoose.Types.ObjectId(value)) };
  // Query one bounded set of intervals. Filtering work tuples happens after
  // overlap resolution: filtering first could re-credit a simultaneous break.
  const [employees, logs, policies, attendance] = await read([
    Employee.find({ _id: employeeMatch }).select(`_id employeeId fullName team role isActive${includeBilling ? ' projectRates' : ''}`).session(session).lean(),
    TaskTimeLog.aggregate([
      { $match: { employee: employeeMatch, 'manualEntry.deletedAt': null, startedAt: { $lt: range.endExclusive },
        $or: [{ stoppedAt: { $gt: range.start } }, { stoppedAt: null, status: { $in: ['running', 'paused'] } }] } },
      { $project: { employee: 1, project: 1, task: 1, client: 1, activityMapping: 1, startedAt: 1, stoppedAt: 1,
        status: 1, editVersion: 1, pauses: 1, desktopHeartbeatAt: 1 } },
      { $limit: 50001 },
    ]).session(session).option({ maxTimeMS: 30000 }),
    Policy.find({ employee: employeeMatch }).select('employee revisions').session(session).lean(),
    Attendance.find({ employee: employeeMatch, date: { $gte: startDate, $lte: endDate } })
      .select('employee date status workingHoursAdjustments').session(session).lean(),
  ]);
  if (logs.length > 50000) throw fail('Narrow the Production report date range or employee selection.', 413);
  const unique = values => [...new Set(values.filter(Boolean).map(String))];
  const [tasks, projects, allocations] = await read([
    Task.find({ _id: { $in: unique(logs.map(log => log.task)) } }).select('_id taskName taskType team teams').session(session).lean(),
    Project.find({ _id: { $in: unique(logs.map(log => log.project)) } }).select('_id projectName teams').session(session).lean(),
    Allocation.aggregate([
      { $match: { timeLog: { $in: logs.map(log => log._id) } } },
      { $sort: { timeLog: 1, version: -1 } },
      { $group: { _id: '$timeLog', allocation: { $first: '$$ROOT' } } },
      { $replaceWith: '$allocation' },
    ]).session(session).option({ maxTimeMS: 30000 }),
  ]);
  const teamIds = unique([...employees.map(employee => employee.team), ...tasks.flatMap(task => [task.team, ...(task.teams || [])]),
    ...projects.flatMap(project => project.teams || []), ...allocations.map(row => row.team)]);
  const settings = await Revision.find({ team: { $in: teamIds }, effectiveFrom: { $lte: endDate },
    kind: { $in: includeBilling ? ['classification', 'team-billing'] : ['classification'] } }).limit(50001).session(session).lean();
  if (settings.length > 50000) throw fail('Production settings history is too large for this selection. Narrow the report.', 413);
  const result = calculateProduction({ employees, logs, policies, attendance, tasks, projects, allocations, settings,
    startDate, endDate, timezone, includeBilling, filters: selectedFilters, now, allowedTeamIds, billingTeamIds });
  if (includeSources) result.sources = { logs, tasks, projects, allocations, settings };
  return result;
}
module.exports = { loadProductionCalculation };
