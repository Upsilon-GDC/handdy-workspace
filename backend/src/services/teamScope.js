const Team = require("../models/Team");

// Team-level permissions (tasks, manual entries, "View team timesheets") work
// on the person's own team: the active teams a team lead leads, or for anyone
// else the active team they belong to. HR, managers and admins normally have
// no team; they act company-wide through their own permissions instead.
async function ownTeamIds(user) {
  if (!user?._id) return [];
  if (user.role === "team_lead") return Team.find({ teamLead: user._id, isActive: true }).distinct("_id");
  if (!user.team) return [];
  const team = await Team.findOne({ _id: user.team, isActive: true }).select("_id").lean();
  return team ? [team._id] : [];
}

// Employee filter for the people a person sees through their team: a team
// lead's assigned employees (as before), or the employees of their own team.
async function teamMemberFilter(user) {
  if (user.role === "team_lead") return { teamLead: user._id, isActive: true };
  return { team: { $in: await ownTeamIds(user) }, role: "employee", isActive: true };
}

const teamTaskMatch = (teamIds) => ({ $or: [{ team: { $in: teamIds } }, { teams: { $in: teamIds } }] });

module.exports = { ownTeamIds, teamMemberFilter, teamTaskMatch };
