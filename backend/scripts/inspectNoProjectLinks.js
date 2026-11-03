// Read-only focused catalog inspection. No models, index initialization or writes.
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongoose').mongo;
const id = value => String(value?._id || value || '');
async function main() {
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
  if (!process.env.MONGODB_URI) throw new Error('Missing database configuration');
  if (process.env.MONGODB_DNS_SERVERS) require('node:dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim()));
  const connection = new MongoClient(process.env.MONGODB_URI, { appName: 'CRM-NoProject-ReadOnly-Review',
    maxPoolSize: 2, serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
  try {
    await connection.connect();
    const db = connection.db();
    const projects = await db.collection('projects').find({ projectName: /^\s*no\s+project\s*$/i },
      { projection: { projectName: 1, projectCode: 1, clients: 1, client: 1, teams: 1, status: 1,
        deletedAt: 1, activityMappingEnabled: 1, activityLinksVersion: 1 }, maxTimeMS: 15000 }).toArray();
    const projectIds = projects.map(p => p._id);
    const mappings = await db.collection('activity_mappings').find({ project: { $in: projectIds } },
      { projection: { project: 1, client: 1, task: 1, isActive: 1 }, maxTimeMS: 15000 }).toArray();
    const [tasks, clients] = await Promise.all([
      db.collection('tasks').find({ $or: [{ project: { $in: projectIds } }, { project: null }, { _id: { $in: mappings.map(m => m.task) } }] },
        { projection: { taskName: 1, taskCode: 1, taskType: 1, project: 1, team: 1, teams: 1, isActive: 1, deletedAt: 1 }, maxTimeMS: 15000 }).toArray(),
      db.collection('clients').find({ _id: { $in: [...projects.flatMap(p => [...(p.clients || []), p.client].filter(Boolean)), ...mappings.map(m => m.client)] } },
        { projection: { clientName: 1, status: 1 }, maxTimeMS: 15000 }).toArray(),
    ]);
    const taskById = new Map(tasks.map(task => [id(task), task]));
    const clientById = new Map(clients.map(client => [id(client), client]));
    const report = { capturedAt: new Date().toISOString(), mode: 'Read-only; no records or indexes changed',
      consistency: 'Live reads, not a point-in-time snapshot. Viewer-specific employee/team permissions are not evaluated.',
      projects: projects.map(project => {
        const clientIds = [...new Set([...(project.clients || []), project.client].filter(Boolean).map(id))];
        const links = mappings.filter(mapping => id(mapping.project) === id(project));
        const activeTaskIds = new Set(links.filter(mapping => mapping.isActive === true).map(mapping => id(mapping.task)));
        const legacyExtras = tasks.filter(task => task.isActive === true && !task.deletedAt && (!task.project || id(task.project) === id(project)) && !activeTaskIds.has(id(task)));
        return { projectId: id(project), name: project.projectName, code: project.projectCode,
          active: project.status === 'Active' && !project.deletedAt, linkedSelectionEnabled: project.activityMappingEnabled === true,
          version: project.activityLinksVersion || 0,
          clients: clientIds.map(clientId => ({ id: clientId, name: clientById.get(clientId)?.clientName || '(missing client)', active: clientById.get(clientId)?.status === 'Active' })),
          mappings: links.map(mapping => {
            const task = taskById.get(id(mapping.task));
            const client = clientById.get(id(mapping.client));
            return { id: id(mapping), active: mapping.isActive === true, client: client?.clientName || '(missing client)', clientId: id(mapping.client),
              clientEligible: clientIds.includes(id(mapping.client)) && client?.status === 'Active',
              taskId: id(mapping.task), taskName: task?.taskName || '(missing task)', taskCode: task?.taskCode,
              taskType: task?.taskType || 'work', taskActive: task?.isActive === true && !task.deletedAt,
              taskProjectCompatible: Boolean(task) && (!task.project || id(task.project) === id(project)) };
          }),
          additionalLegacyTaskCountBeforeEmployeeScope: legacyExtras.length,
          additionalLegacyTasks: legacyExtras.map(task => ({ id: id(task), name: task.taskName, code: task.taskCode, type: task.taskType || 'work', shared: !task.project })),
        };
      }) };
    const output = path.join(__dirname, '../.local-repairs/no-project-review');
    fs.mkdirSync(output, { recursive: true });
    const file = path.join(output, `links-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, privateReport: file }, null, 2));
  } finally { await connection.close(); }
}
main().catch(error => {
  console.error(`Read-only No Project inspection failed (${error.code || error.name || 'Error'}). No database writes requested.`);
  process.exitCode = 1;
});
