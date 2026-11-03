// Phase 1 only: native-driver reads, no Mongoose models, writes or index creation.
// Run from any directory: node backend/scripts/auditActivityMappings.js
// Private output is stored in the git-ignored backend/.local-repairs directory.
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongoose').mongo;

const id = (value) => String(value?._id || value || '');
const ids = (values) => [...new Set((values || []).filter(Boolean).map(id))];
const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const activeProject = (p) => p.status === 'Active' && !p.deletedAt;

function analyzeActivityMappings({ projects, clients, tasks, teams, employees, history }) {
  const projectById = new Map(projects.map(p => [id(p), p]));
  const clientById = new Map(clients.map(c => [id(c), c]));
  const teamById = new Map(teams.map(t => [id(t), t]));
  const employeeById = new Map(employees.map(e => [id(e), e]));
  const taskById = new Map(tasks.map(t => [id(t), t]));
  const projectInventory = projects.map(p => {
    const clientIds = ids([...(p.clients || []), p.client]);
    const issues = [];
    if (!clientIds.length) issues.push('no-explicit-client');
    if (p.client && p.clients?.length && !p.clients.map(id).includes(id(p.client))) issues.push('primary-client-not-in-clients');
    if (clientIds.some(c => !clientById.has(c))) issues.push('missing-client-reference');
    if (clientIds.some(c => clientById.has(c) && clientById.get(c).status !== 'Active')) issues.push('inactive-client-reference');
    if ((p.teams || []).some(t => !teamById.has(id(t)) || !teamById.get(id(t)).isActive)) issues.push('missing-or-inactive-team');
    return { project: id(p), name: p.projectName, active: activeProject(p), clientIds, legacyClientName: p.clientName || '', issues };
  });
  const projectInfo = new Map(projectInventory.map(p => [p.project, p]));
  const taskInventory = tasks.map(t => {
    const issues = [];
    const p = projectById.get(id(t.project));
    const info = projectInfo.get(id(t.project));
    const teamIds = ids([...(t.teams || []), t.team]);
    const relevantHistory = history.filter(h => id(h._id.task) === id(t));
    if (!t.project) issues.push('projectless-shared-task-requires-explicit-mapping');
    else if (!p) issues.push('missing-project-reference');
    else if (!activeProject(p)) issues.push('inactive-or-deleted-project');
    if (info?.issues.length) issues.push(...info.issues);
    if (info?.clientIds.length > 1) issues.push('multiple-project-clients-task-client-unconfirmed');
    if (teamIds.some(team => !teamById.has(team) || !teamById.get(team).isActive)) issues.push('missing-or-inactive-task-team');
    if ((t.assignedTo || []).some(e => !employeeById.has(id(e)) || !employeeById.get(id(e)).isActive)) issues.push('missing-or-inactive-assignee');
    if (!teamIds.length && !(t.assignedTo || []).length) issues.push('no-explicit-team-or-assignee');
    if (p?.teams?.length && teamIds.some(team => !p.teams.map(id).includes(team))) issues.push('task-team-outside-project');
    const observed = relevantHistory.map(h => ({ project: id(h._id.project), client: id(h._id.client) || null, count: h.count }));
    if (observed.some(h => h.project !== id(t.project) || (h.client && !info?.clientIds.includes(h.client)))) issues.push('historical-combinations-differ-from-current-mapping');
    const enabled = t.isActive === true && !t.deletedAt;
    const candidate = enabled && issues.length === 0 && info?.clientIds.length === 1;
    const possibleProjects = p ? [id(p)] : projects.filter(project => activeProject(project)
      && (!(project.teams || []).length || teamIds.some(team => project.teams.map(id).includes(team)))) .map(id);
    return { task: id(t), name: t.taskName, taskType: t.taskType || 'work', project: id(t.project) || null,
      candidateProjectIdsForReview: possibleProjects,
      teamIds, assignedEmployeeIds: ids(t.assignedTo), assignToAllEmployees: t.assignToAllEmployees === true,
      enabled, disposition: !enabled ? 'retain-inactive-history' : candidate ? 'automatic-link-candidate' : 'review-required',
      proposedMapping: candidate ? { project: id(p), client: info.clientIds[0], task: id(t) } : null,
      issues: [...new Set(issues)], observed };
  });
  const historicalIssues = history.flatMap(h => {
    const reasons = [];
    if (!taskById.has(id(h._id.task))) reasons.push('missing-task');
    if (!projectById.has(id(h._id.project))) reasons.push('missing-project');
    if (!h._id.client) reasons.push('no-recorded-client-do-not-infer');
    else if (!clientById.has(id(h._id.client))) reasons.push('missing-client');
    return reasons.length ? [{ ...h, reasons }] : [];
  });
  const duplicateNames = [];
  for (const [kind, records, name] of [['client', clients, 'clientName'], ['project', projects, 'projectName'], ['task', tasks, 'taskName']]) {
    const groups = new Map();
    for (const record of records) { const key = normalize(record[name]); groups.set(key, [...(groups.get(key) || []), id(record)]); }
    for (const [name, recordIds] of groups) if (recordIds.length > 1) duplicateNames.push({ kind, name, ids: recordIds });
  }
  return { summary: { projects: projects.length, clients: clients.length, tasks: tasks.length, teams: teams.length,
    employees: employees.length, timeEntries: history.reduce((n, h) => n + h.count, 0), historicalCombinations: history.length,
    automaticLinkCandidates: taskInventory.filter(t => t.disposition === 'automatic-link-candidate').length,
    tasksNeedingReview: taskInventory.filter(t => t.disposition === 'review-required').length,
    inactiveTasksRetained: taskInventory.filter(t => !t.enabled).length,
    historicalCombinationsNeedingReview: historicalIssues.length, duplicateNameGroups: duplicateNames.length },
    assignmentSummary: {
      employeesWithMissingOrInactiveTeam: employees.filter(e => e.team && (!teamById.has(id(e.team)) || !teamById.get(id(e.team)).isActive)).length,
      employeesWithMissingLead: employees.filter(e => e.teamLead && !employeeById.has(id(e.teamLead))).length,
      enabledTasksWithExplicitAssignees: taskInventory.filter(t => t.enabled && t.assignedEmployeeIds.length).length,
      enabledTeamWideTasks: taskInventory.filter(t => t.enabled && t.assignToAllEmployees).length,
    },
    defaultRecordCandidates: {
      projects: projects.filter(p => normalize(p.projectName) === 'no project').map(p => ({ id: id(p), active: activeProject(p) })),
      clients: clients.filter(c => normalize(c.clientName) === 'upsilon').map(c => ({ id: id(c), active: c.status === 'Active' })),
      tasks: tasks.filter(t => normalize(t.taskName) === 'idle break').map(t => ({ id: id(t), active: t.isActive === true && !t.deletedAt, taskType: t.taskType || 'work' })),
    }, projects: projectInventory, tasks: taskInventory, historicalIssues, duplicateNames };
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  if (process.env.MONGODB_DNS_SERVERS) require('node:dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim()));
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000, maxPoolSize: 2, appName: 'CRM-Phase1-ReadOnly-Audit' });
  try {
    await client.connect();
    const db = client.db();
    const read = (name, projection) => db.collection(name).find({}, { projection, maxTimeMS: 30000 }).toArray();
    const [projects, clients, tasks, teams, employees, history] = await Promise.all([
      read('projects', { projectName: 1, projectCode: 1, client: 1, clients: 1, clientName: 1, teams: 1, status: 1, deletedAt: 1 }),
      read('clients', { clientName: 1, status: 1 }),
      read('tasks', { taskName: 1, taskCode: 1, taskType: 1, project: 1, team: 1, teams: 1, assignedTo: 1, assignToAllEmployees: 1, isActive: 1, deletedAt: 1 }),
      read('teams', { isActive: 1 }), read('employees', { role: 1, team: 1, teamLead: 1, isActive: 1 }),
      db.collection('task_time_logs').aggregate([{ $group: { _id: { project: '$project', client: '$client', task: '$task' }, count: { $sum: 1 } } }], { maxTimeMS: 30000 }).toArray(),
    ]);
    const report = analyzeActivityMappings({ projects, clients, tasks, teams, employees, history });
    report.capturedAt = new Date().toISOString();
    report.database = db.databaseName;
    report.mode = 'read-only; no mappings applied; historical counts include retained deleted manual entries';
    report.consistency = 'Live sequential/parallel reads, not a point-in-time snapshot. Rerun before migration.';
    report.indexes = {};
    for (const name of ['projects', 'clients', 'tasks', 'task_time_logs']) {
      report.indexes[name] = await db.collection(name).listIndexes().toArray().catch(error => { if (error.code === 26) return []; throw error; });
    }
    const output = path.join(__dirname, '../.local-repairs/activity-phase1');
    fs.mkdirSync(output, { recursive: true });
    const file = path.join(output, `inventory-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    // JSON worksheet avoids spreadsheet formula interpretation of user-entered names.
    const reviewFile = file.replace('inventory-', 'review-worksheet-');
    fs.writeFileSync(reviewFile, JSON.stringify({ inventoryFile: path.basename(file), instructions:
      'Review only. Candidate projects and observed usage do not authorize mappings. Use one approvedMappings entry per valid combination; keep IDs, not names. No importer/apply command exists in Phase 1.',
      availableClients: clients.filter(c => c.status === 'Active').map(c => ({ clientId: id(c), clientName: c.clientName })),
      projects: report.projects.filter(p => p.active).map(p => ({ projectId: p.project, projectName: p.name,
        existingClientIds: p.clientIds, approvedClientIds: [], decision: 'pending' })),
      tasks: report.tasks.filter(t => t.enabled).map(t => ({ taskId: t.task, taskName: t.name, taskType: t.taskType,
        teamIds: t.teamIds, candidateProjectIdsForReview: t.candidateProjectIdsForReview,
        observedHistory: t.observed, issues: t.issues, approvedMappings: [], decision: 'pending' })) }, null, 2));
    console.log(JSON.stringify({ summary: report.summary, assignmentSummary: report.assignmentSummary, privateReport: file, privateWorksheet: reviewFile }, null, 2));
  } finally { await client.close(); }
}

if (require.main === module) main().catch(error => {
  // Do not print connection strings, driver topology or credential-bearing errors.
  console.error(`Read-only inventory failed (${error.code || error.name || 'Error'}). No database writes were requested.`);
  process.exitCode = 1;
});
module.exports = { analyzeActivityMappings };
