const Project = require('../../models/Project');
const Policy = require('../../models/ClientAccessPolicy');
const Revision = require('../../models/ProductionSettingsRevision');
async function taskTeamScope(team, session = null) {
  const projects = await Project.find({ teams: team }).select('_id').session(session).lean();
  return { $or: [
    { team }, { teams: team },
    { $and: [{ team: null }, { $or: [{ teams: { $size: 0 } }, { teams: { $exists: false } }] }, { project: { $in: projects.map(row => row._id) } }] },
  ] };
}
async function rateTeamClients(team, { historical = false } = {}) {
  // Explicit team client access is the more specific assignment. Without it,
  // use real client IDs attached to the team's projects, never name matching
  // or a fallback to the entire company catalog.
  const policy = await Policy.findOne({ subjectType: 'team', subjectId: team, enabled: true }).select('clients').lean();
  const projects = policy ? [] : await Project.find({ teams: team, ...(historical ? {} : { deletedAt: null }) }).select('client clients').lean();
  const currentIds = [...new Set((policy ? policy.clients : projects.flatMap(row => [...(row.clients || []), row.client])).filter(Boolean).map(String))];
  const previous = historical ? await Revision.find({ kind: 'rate', team }).distinct('values.client') : [];
  return { currentIds, ids: [...new Set([...currentIds, ...previous.filter(Boolean).map(String)])] };
}
module.exports = { taskTeamScope, rateTeamClients };
