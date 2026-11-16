const Policy = require('../models/ClientAccessPolicy');
const Change = require('../models/ClientAccessChange');
const Team = require('../models/Team');
const id = value => String(value?._id || value || '');
// Load before serving requests; successful policy writes update this snapshot
// before responding. Bounded refresh also picks up saves from another server.
let policies = new Map();
let refreshedAt = 0;
let generation = 0;
let refreshing;
const REFRESH_MS = 30_000;
const key = (type, subject) => `${type}:${id(subject)}`;
function replacePolicies(rows) {
  policies = new Map(rows.map(row => [key(row.subjectType, row.subjectId), row]));
  generation += 1;
  refreshedAt = Date.now();
}
function rememberPolicy(row) {
  const name = key(row.subjectType, row.subjectId);
  if ((policies.get(name)?.version || 0) <= (row.version || 0)) {
    policies.set(name, row);
    generation += 1;
  }
}
// Another server (for example local admin + hosted desktop API) can save to
// the same database. Revalidate before serving requests, not just at startup.
// A failed refresh rejects the request rather than serving stale grants.
async function refreshClientAccessIfStale() {
  if (Date.now() - refreshedAt < REFRESH_MS) return;
  if (refreshing) return refreshing;
  const promise = Promise.resolve().then(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const startedGeneration = generation;
      const rows = await Policy.find({}).lean();
      if (generation === startedGeneration) { replacePolicies(rows); return; }
      // A local save raced the refresh. Re-read before allowing this request:
      // preserving that save alone can leave another employee's grants stale.
    }
    throw new Error('Client access changed repeatedly during refresh. Retry the request.');
  }).finally(() => { if (refreshing === promise) refreshing = null; });
  refreshing = promise;
  return promise;
}
function allowedClientIds(employee, project) {
  const team = policies.get(key('team', employee.team));
  const own = policies.get(key('employee', employee._id));
  let allowed = team?.enabled ? team.clients.map(id) : null;
  if (own?.enabled) allowed = own.clients.map(id).filter(client => own.overrideTeam === true || allowed === null || allowed.includes(client));
  const restriction = project && own?.enabled
    ? own.projectClients?.find(row => id(row.project) === id(project)) : null;
  if (restriction) {
    const selected = restriction.clients.map(id);
    allowed = allowed === null ? selected : allowed.filter(client => selected.includes(client));
  }
  return allowed;
}
// Work access is separate from reporting membership and management authority.
function additionalWorkTeamIds(employee) {
  return [...new Set((policies.get(key('employee', employee._id))?.workTeams || []).map(id))]
    .filter(value => value && value !== id(employee.team));
}
function workTeamIds(employee) {
  return [...new Set([id(employee.team), ...additionalWorkTeamIds(employee)].filter(Boolean))];
}
function workProjectIds(employee) {
  return [...new Set((policies.get(key('employee', employee._id))?.workProjects || []).map(id))].filter(Boolean);
}
async function activeWorkTeams(employee) {
  const requested = workTeamIds(employee);
  if (!requested.length) return { hasActiveTeam: false, teamIds: [] };
  if (employee.team && requested.length === 1) {
    const hasActiveTeam = Boolean(await Team.exists({ _id: employee.team, isActive: true }));
    return { hasActiveTeam, teamIds: hasActiveTeam ? requested : [] };
  }
  // Check home and additional teams together, without caching access decisions.
  const active = await Team.find({ _id: { $in: requested }, isActive: true }).select('_id').lean();
  const activeIds = new Set(active.map(id));
  return {
    hasActiveTeam: Boolean(employee.team && activeIds.has(id(employee.team))),
    teamIds: requested.filter(teamId => activeIds.has(teamId)),
  };
}
function clientAccessError(employee, client, project) {
  const allowed = allowedClientIds(employee, project);
  return allowed !== null && (!client || !allowed.includes(id(client)))
    ? 'Select a client allowed for this employee.' : null;
}
async function initializeClientAccess() {
  await Policy.createCollection();
  await Policy.createIndexes();
  await Change.createCollection();
  await Change.createIndexes();
  replacePolicies(await Policy.find({}).lean());
}
module.exports = { allowedClientIds, clientAccessError, initializeClientAccess, replacePolicies, rememberPolicy,
  additionalWorkTeamIds, workTeamIds, activeWorkTeams, workProjectIds, refreshClientAccessIfStale };
