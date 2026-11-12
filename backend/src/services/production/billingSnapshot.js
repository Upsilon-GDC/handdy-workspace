const Client = require('../../models/Client');
const Team = require('../../models/Team');
const { loadProductionCalculation } = require('./calculationService');
const { resolveWorkTeam } = require('./calculationEngine');
const { hash } = require('./billingRules');
const { fail } = require('./settingsValidation');
const { getDateKeyInTimezone } = require('../../utils/billingUtils');
const id = value => String(value?._id || value || '');
async function billingSnapshot(batch, session) {
  const report = await loadProductionCalculation({ employeeIds: [id(batch.employee)], startDate: batch.startDate,
    endDate: batch.endDate, timezone: batch.timezone, includeBilling: true, filters: { team: id(batch.team) }, includeSources: true, session });
  const source = report.sources;
  if (source.logs.length > 1000) throw fail('Use a shorter billing period (maximum 1000 source entries).', 413);
  const taskMap = new Map(source.tasks.map(row => [id(row), row])), projectMap = new Map(source.projects.map(row => [id(row), row]));
  const allocationMap = new Map(source.allocations.map(row => [id(row.timeLog), row]));
  const entries = source.logs.flatMap(log => {
    const allocation = resolveWorkTeam(log, taskMap.get(id(log.task)), projectMap.get(id(log.project)), allocationMap.get(id(log)));
    if (allocation.team && allocation.team !== id(batch.team)) return [];
    const task = taskMap.get(id(log.task)), project = projectMap.get(id(log.project));
    const taskTeams = [...new Set([...(task?.teams || []), task?.team].filter(Boolean).map(id))], projectTeams = (project?.teams || []).map(id);
    const teamLinkCompatible = Boolean(taskTeams.length || projectTeams.length)
      && (!taskTeams.length || taskTeams.includes(id(batch.team))) && (!projectTeams.length || projectTeams.includes(id(batch.team)));
    return [{ timeLog: id(log), taskName: taskMap.get(id(log.task))?.taskName || 'Unavailable task',
      projectName: projectMap.get(id(log.project))?.projectName || 'Unavailable project', startedAt: log.startedAt, stoppedAt: log.stoppedAt,
      allocationVersion: allocationMap.get(id(log))?.version || 0, verified: allocation.source === 'explicit', teamLinkCompatible }];
  });
  const blockers = new Set();
  if (batch.endDate > getDateKeyInTimezone(new Date(), batch.timezone)) blockers.add('future-period');
  const billing = report.totals.billing;
  if (!billing?.applicable) blockers.add('hours-only-team');
  if (!billing?.billableSeconds) blockers.add('no-billable-work');
  if (billing?.estimates?.some(row => !row.complete)) blockers.add('missing-or-mismatched-rate');
  if (source.logs.some(log => !log.stoppedAt || log.status !== 'stopped')) blockers.add('running-timer');
  if (entries.some(row => !row.verified)) blockers.add('unverified-team-allocation');
  for (const warning of report.warnings) if (['needs-team-allocation', 'needs-activity-classification', 'overlapping-work-needs-review', 'invalid-pause', 'invalid-or-empty-interval'].includes(warning.code)) blockers.add(warning.code);
  const billable = report.details.filter(row => row.billing?.applicable && row.billing.billableSeconds > 0);
  if (billable.length > 3000) throw fail('Use a shorter billing period (maximum 3000 billing intervals).', 413);
  const clients = await Client.find({ _id: { $in: [...new Set(billable.map(row => row.client).filter(Boolean))] } }).select('clientName').session(session).lean();
  const team = await Team.findById(batch.team).select('teamName').session(session).lean();
  const clientMap = new Map(clients.map(row => [id(row), row.clientName]));
  const snapshot = { capturedAt: new Date(), calculationVersion: report.calculationVersion,
    employeeName: report.members[0]?.fullName || 'Unavailable employee', teamName: team?.teamName || 'Unavailable team',
    summary: { actualSeconds: report.totals.actualSeconds, breakIdleSeconds: report.totals.breakIdleSeconds, trainingSeconds: report.totals.trainingSeconds,
      productionSeconds: report.totals.productionSeconds, eligibleClientWorkSeconds: report.totals.eligibleClientWorkSeconds, billing },
    approvalRequired: billable.some(row => row.billing.approvalRequired), blockers: [...blockers].sort(), entries,
    lineCount: billable.length,
    lines: billable.map(row => ({ ...row, taskName: taskMap.get(row.task)?.taskName || 'Unavailable task',
      projectName: projectMap.get(row.project)?.projectName || 'Unavailable project', clientName: row.client ? clientMap.get(row.client) || 'Unavailable client' : 'No client recorded' })) };
  const sorted = rows => [...rows].sort((a, b) => id(a).localeCompare(id(b)));
  // Do not hash capturedAt/asOf: retries must be stable while source records are
  // unchanged. Source tuples and revisions retain provenance of the estimate.
  const sourceHash = hash({ logs: sorted(source.logs), allocations: sorted(source.allocations), tasks: sorted(source.tasks),
    projects: sorted(source.projects), settings: sorted(source.settings), lines: snapshot.lines, summary: snapshot.summary, blockers: snapshot.blockers,
    labels: { employee: snapshot.employeeName, team: snapshot.teamName, clients: sorted(clients) } });
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 8_000_000) throw fail('Billing snapshot is too large. Use a shorter period.', 413);
  return { snapshot, sourceHash };
}
module.exports = { billingSnapshot };
