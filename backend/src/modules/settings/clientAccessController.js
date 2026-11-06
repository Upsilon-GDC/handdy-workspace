const mongoose = require('mongoose');
const Team = require('../../models/Team');
const Employee = require('../../models/Employee');
const Client = require('../../models/Client');
const Project = require('../../models/Project');
const Policy = require('../../models/ClientAccessPolicy');
const Change = require('../../models/ClientAccessChange');
const { rememberPolicy } = require('../../services/clientAccess');
const sendError = require('../../utils/sendErrorResponse');
const { getPagination } = require('../../utils/requestUtils');
const id = value => String(value?._id || value || '');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function validateSave(req, bulk) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw fail('Provide valid client-access settings.');
  }
  const { enabled, clients } = req.body;
  const type = bulk ? 'employee' : req.params.type;
  const overrideTeam = req.body.overrideTeam ?? false;
  const workTeams = req.body.workTeams;
  const workProjects = req.body.workProjects;
  if (workProjects !== undefined && (!Array.isArray(workProjects) || workProjects.length > 500
    || workProjects.some(value => !mongoose.isObjectIdOrHexString(value)) || (type !== 'employee' && workProjects.length))) {
    throw fail('Select valid additional projects for employees only.');
  }
  if (workTeams !== undefined && (!Array.isArray(workTeams) || workTeams.length > 500
    || workTeams.some(value => !mongoose.isObjectIdOrHexString(value)) || (type !== 'employee' && workTeams.length))) {
    throw fail('Select valid additional work teams for employees only.');
  }
  if (typeof overrideTeam !== 'boolean' || (overrideTeam && (type !== 'employee' || enabled !== true))) {
    throw fail('Cross-team clients require an enabled employee selection.');
  }
  const targets = bulk ? req.body.employees : [{ id: req.params.id, version: req.body.version }];
  if (!['team', 'employee'].includes(type) || typeof enabled !== 'boolean'
    || !Array.isArray(clients) || clients.length > 500 || clients.some(value => !mongoose.isObjectIdOrHexString(value))
    || !Array.isArray(targets) || !targets.length || targets.length > 500
    || targets.some(row => !row || !mongoose.isObjectIdOrHexString(row.id) || !Number.isSafeInteger(row.version) || row.version < 0)) {
    throw fail('Select 1–500 valid members and clients, then refresh before saving.');
  }
  const rows = targets.map(row => ({ id: row.id.toLowerCase(), version: row.version }));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw fail('Select each member once.');
  if (bulk && req.body.team !== 'unassigned' && !mongoose.isObjectIdOrHexString(req.body.team)) throw fail('Choose a valid team.');
  return { type, targets: rows.sort((a, b) => a.id.localeCompare(b.id)), enabled, overrideTeam,
    workTeams: workTeams === undefined ? undefined : [...new Set(workTeams.map(value => value.toLowerCase()))],
    workProjects: workProjects === undefined ? undefined : [...new Set(workProjects.map(value => value.toLowerCase()))],
    clients: enabled ? [...new Set(clients.map(value => value.toLowerCase()))] : [], team: bulk ? req.body.team : undefined };
}

async function save(req, res, bulk = false) {
  let session;
  try {
    const input = validateSave(req, bulk);
    session = await mongoose.startSession();
    let policies, history;
    await session.withTransaction(async () => {
      const Model = input.type === 'team' ? Team : Employee;
      const filter = { _id: { $in: input.targets.map(row => row.id) }, isActive: true,
        ...(input.type === 'employee' ? { role: { $ne: 'alpha' } } : {}),
        ...(bulk ? { team: input.team === 'unassigned' ? null : input.team } : {}) };
      const subjects = await Model.find(filter).select('teamName fullName team').session(session).lean();
      if (subjects.length !== input.targets.length) throw fail('Some selected members are inactive or no longer in this team. Refresh before saving.', bulk ? 409 : 404);
      const selectedClients = await Client.find({ _id: { $in: input.clients }, status: 'Active' }).select('clientName').session(session).lean();
      if (selectedClients.length !== input.clients.length) throw fail('Some selected clients are inactive or missing.');
      const previous = await Policy.find({ subjectType: input.type, subjectId: { $in: input.targets.map(row => row.id) } }).session(session).lean();
      for (const target of input.targets) {
        if ((previous.find(row => id(row.subjectId) === target.id)?.version || 0) !== target.version) throw fail('Client access changed in another window. Refresh before saving.', 409);
      }
      const oldClients = await Client.find({ _id: { $in: previous.flatMap(row => row.clients) } }).select('clientName').session(session).lean();
      const workTeamCatalog = await Team.find({ _id: { $in: [...new Set([
        ...(input.workTeams || []), ...previous.flatMap(row => (row.workTeams || []).map(id)),
      ])] } }).select('teamName isActive').session(session).lean();
      if (input.workTeams?.some(value => !workTeamCatalog.some(team => id(team) === value && team.isActive))) {
        throw fail('Some additional work teams are inactive or missing.');
      }
      const teamSnapshot = values => (values || []).map(value => ({ id: value,
        name: workTeamCatalog.find(team => id(team) === id(value))?.teamName || 'Removed team' }));
      const projectReferences = [...new Set([...(input.workProjects || []), ...previous.flatMap(row => (row.workProjects || []).map(id))])];
      const projectCatalog = projectReferences.length ? await Project.find({ _id: { $in: projectReferences } })
        .select('projectName status deletedAt').session(session).lean() : [];
      if (input.workProjects?.some(value => !projectCatalog.some(project => id(project) === value && project.status === 'Active' && !project.deletedAt))) {
        throw fail('Some additional projects are inactive or missing.');
      }
      const projectSnapshot = values => (values || []).map(value => ({ id: value,
        name: projectCatalog.find(project => id(project) === id(value))?.projectName || 'Removed project' }));
      const snapshot = (values, catalog) => values.map(value => ({ id: value, name: catalog.find(client => id(client) === id(value))?.clientName || 'Removed client' }));
      const teamId = input.type === 'team' ? input.targets[0].id : bulk ? (input.team === 'unassigned' ? null : input.team) : subjects[0].team;
      const team = teamId ? await Team.findById(teamId).select('teamName').session(session).lean() : null;
      if (bulk && input.team !== 'unassigned' && !team) throw fail('The selected team no longer exists.', 409);
      policies = [];
      for (const target of input.targets) {
        const row = await Policy.findOneAndUpdate({ subjectType: input.type, subjectId: target.id, version: target.version },
          { $set: { enabled: input.enabled, overrideTeam: input.overrideTeam, clients: input.clients,
            ...(input.workTeams === undefined ? {} : { workTeams: input.workTeams }),
            ...(input.workProjects === undefined ? {} : { workProjects: input.workProjects }), updatedBy: req.user._id }, $inc: { version: 1 } },
          { upsert: target.version === 0, returnDocument: 'after', runValidators: true, session }).lean();
        if (!row) throw fail('Client access changed in another window. Refresh before saving.', 409);
        policies.push(row);
      }
      [history] = await Change.create([{
        actor: req.user._id, actorName: req.user.fullName || req.user.employeeId || 'Administrator',
        team: teamId || null, teamName: team?.teamName || 'No team assigned',
        targets: input.targets.map(target => {
          const before = previous.find(row => id(row.subjectId) === target.id);
          const subject = subjects.find(row => id(row) === target.id);
          return { subjectType: input.type, subjectId: target.id, name: subject.teamName || subject.fullName,
            beforeEnabled: before?.enabled === true, afterEnabled: input.enabled,
            beforeOverrideTeam: before?.overrideTeam === true, afterOverrideTeam: input.overrideTeam,
            beforeWorkTeams: teamSnapshot(before?.workTeams),
            afterWorkTeams: teamSnapshot(policies.find(row => id(row.subjectId) === target.id)?.workTeams),
            beforeWorkProjects: projectSnapshot(before?.workProjects),
            afterWorkProjects: projectSnapshot(policies.find(row => id(row.subjectId) === target.id)?.workProjects),
            beforeClients: snapshot(before?.clients || [], oldClients), afterClients: snapshot(input.clients, selectedClients), version: target.version + 1 };
        }),
      }], { session });
    });
    // Never publish an uncommitted or partly saved batch to the timer picker.
    policies.forEach(rememberPolicy);
    return res.json({ success: true, policy: bulk ? undefined : policies[0], policies, history });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Client access changed in another window. Refresh before saving.' });
    return sendError(res, error, 'Unable to save client access. No partial changes were saved.');
  } finally { if (session) await session.endSession(); }
}
async function getHistory(req, res) {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const [history, totalRecords] = await Promise.all([
      Change.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(), Change.countDocuments({}),
    ]);
    return res.json({ success: true, history, page, totalRecords, totalPages: Math.max(1, Math.ceil(totalRecords / limit)) });
  } catch (error) { return sendError(res, error, 'Unable to load client-access history.'); }
}
module.exports = { validateSave, saveSingle: (req, res) => save(req, res), saveBatch: (req, res) => save(req, res, true), getHistory };
