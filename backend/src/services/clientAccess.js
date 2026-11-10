const Policy = require('../models/ClientAccessPolicy');
const Change = require('../models/ClientAccessChange');
const Team = require('../models/Team');
const id = value => String(value?._id || value || '');
// Single-instance deployment, like the permission cache. Load before serving
// requests; successful policy writes update this snapshot before responding.
let policies = new Map();
const key = (type, subject) => `${type}:${id(subject)}`;
function replacePolicies(rows) { policies = new Map(rows.map(row => [key(row.subjectType, row.subjectId), row])); }
function rememberPolicy(row) {
  const name = key(row.subjectType, row.subjectId);
  if ((policies.get(name)?.version || 0) <= (row.version || 0)) policies.set(name, row);
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
  const hasActiveTeam = employee.team ? Boolean(await Team.exists({ _id: employee.team, isActive: true })) : false;
  const extra = additionalWorkTeamIds(employee);
  const active = extra.length ? await Team.find({ _id: { $in: extra }, isActive: true }).select('_id').lean() : [];
  return { hasActiveTeam, teamIds: [...new Set([...(hasActiveTeam ? [id(employee.team)] : []), ...active.map(id)])] };
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
  additionalWorkTeamIds, workTeamIds, activeWorkTeams, workProjectIds };
