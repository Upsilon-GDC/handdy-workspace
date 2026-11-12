const mongoose = require('mongoose');
const Team = require('../../models/Team');
const Employee = require('../../models/Employee');
const Revision = require('../../models/ProductionSettingsRevision');
const { appendSetting, ensureProductionSettingsIndexes, productionStoragePlan } = require('./settingsService');
const { fail, objectId, validateSetting } = require('./settingsValidation');

function initializationPlan(teams, existing, { billingTeamId, effectiveFrom, currency }) {
  const selected = billingTeamId ? teams.filter(team => String(team._id) === objectId(billingTeamId, 'billing team'))
    : teams.filter(team => team.teamName.trim().toUpperCase() === 'WCPA');
  if (selected.length !== 1) throw fail('Select exactly one active WCPA team using --team-id.');
  const selectedId = String(selected[0]._id);
  const existingKeys = new Set(existing.map(row => row.key));
  return teams.map(team => {
    const teamId = String(team._id);
    const billingEnabled = teamId === selectedId;
    const setting = validateSetting('team-billing', { team: teamId, effectiveFrom, billingEnabled,
      currency: billingEnabled ? currency : null, approvalRequired: true, expectedVersion: 0,
      reason: 'Initial Production team billing configuration' });
    return { teamName: team.teamName, disposition: existingKeys.has(teamId) ? 'preserve-existing' : 'create', setting };
  });
}
async function initializeProduction(options) {
  const [teams, existing] = await Promise.all([
    Team.find({ isActive: true }).select('_id teamName').sort('teamName').lean(),
    Revision.find({ kind: 'team-billing' }).select('key').lean(),
  ]);
  const plan = initializationPlan(teams, existing, options);
  if (!options.apply) return { applied: false, storage: productionStoragePlan(), plan };
  const actorId = objectId(options.actorId, 'administrator');
  if (!await Employee.exists({ _id: actorId, isActive: true, role: { $in: ['admin', 'alpha'] } })) throw fail('An active Admin is required to initialize Production.', 403);
  await ensureProductionSettingsIndexes();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const row of plan.filter(row => row.disposition === 'create')) {
        // A concurrent administrator/migration wins; never replace existing settings.
        if (await Revision.exists({ kind: 'team-billing', key: row.setting.key }).session(session)) continue;
        if (!await Team.exists({ _id: row.setting.team, isActive: true }).session(session)) throw fail('A team changed during initialization. Run the preview again.', 409);
        await appendSetting(row.setting, actorId, session);
      }
    });
    return { applied: true, storage: productionStoragePlan(), plan };
  } finally { await session.endSession(); }
}
module.exports = { initializationPlan, initializeProduction };
