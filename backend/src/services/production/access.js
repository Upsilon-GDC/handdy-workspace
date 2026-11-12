const Employee = require('../../models/Employee');
const Team = require('../../models/Team');
const Revision = require('../../models/ProductionSettingsRevision');
const { userHasPermission } = require('../permissionService');
const { effectiveRevision, today, fail, objectId } = require('./settingsValidation');

async function productionAccess(user) {
  if (!user?._id) throw fail('Authentication is required.', 401);
  const self = objectId(String(user._id), 'employee');
  if (['admin', 'alpha'].includes(user.role)) return { mode: 'company', employeeFilter: { role: { $ne: 'alpha' } }, teamIds: null, billingTeamIds: null, reviewTeamIds: null, includeBilling: true };
  const rows = await Revision.find({ kind: 'access', 'values.employee': self, effectiveFrom: { $lte: today() } }).lean();
  const byKey = new Map();
  for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) || []), row]);
  const grants = [...byKey.values()].map(items => effectiveRevision(items, today())).filter(row => row?.values.enabled);
  const grantedTeams = grants.map(row => String(row.team));
  const billingTeamIds = grants.filter(row => row.values.canViewBilling).map(row => String(row.team));
  const reviewTeamIds = ['manager', 'team_lead'].includes(user.role) ? grants.filter(row => row.values.canViewBilling && row.values.canApproveBilling).map(row => String(row.team)) : [];
  if (user.role === 'employee') return { mode: 'personal', employeeFilter: { _id: self }, teamIds: null, billingTeamIds, reviewTeamIds, includeBilling: billingTeamIds.length > 0 };
  if (user.role === 'hr' && userHasPermission(user, 'view_all_reports')) return { mode: 'company', employeeFilter: { role: { $ne: 'alpha' } }, teamIds: null, billingTeamIds, reviewTeamIds, includeBilling: billingTeamIds.length > 0 };
  const useAssignments = user.role === 'manager' || (user.role === 'team_lead' && userHasPermission(user, 'view_team_timesheets'));
  const ledTeams = useAssignments ? await Team.find({ teamLead: user._id, isActive: true }).distinct('_id') : [];
  const teamIds = [...new Set([...grantedTeams, ...ledTeams.map(String), ...(user.role === 'manager' && user.team ? [String(user.team)] : [])])];
  const clauses = [{ _id: self }];
  if (grantedTeams.length) clauses.push({ team: { $in: grantedTeams } });
  if (user.role === 'manager' && teamIds.length) clauses.push({ team: { $in: teamIds } });
  else if (ledTeams.length) clauses.push({ team: { $in: ledTeams }, teamLead: user._id });
  return { mode: teamIds.length ? 'assigned' : 'personal', employeeFilter: { $or: clauses },
    teamIds: teamIds.length ? teamIds : null, billingTeamIds, reviewTeamIds, includeBilling: billingTeamIds.length > 0 };
}
async function scopedEmployees(access, requested) {
  const filter = { ...access.employeeFilter };
  if (requested !== undefined && requested !== 'all') {
    const employee = objectId(requested, 'employee');
    const row = await Employee.findOne({ $and: [filter, { _id: employee }] }).select('_id employeeId fullName team role isActive').lean();
    if (!row) throw fail('Employee is outside your Production access.', 403);
    return [row];
  }
  const rows = await Employee.find(filter).select('_id employeeId fullName team role isActive').sort('fullName').limit(1001).lean();
  if (rows.length > 1000) throw fail('Narrow the Production employee selection.', 413);
  return rows;
}
module.exports = { productionAccess, scopedEmployees };
