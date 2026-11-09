const test = require('node:test');
const assert = require('node:assert/strict');
const Team = require('../src/models/Team');
const Employee = require('../src/models/Employee');
const teamRoutes = require('../src/modules/teams/teamRoutes');
const attendanceRoutes = require('../src/modules/attendance/attendanceRoutes');

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const route = (router, path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;

// Authentication is covered separately; exercise every subsequent route handler.
async function invoke(router, path, method, req) {
  const res = response();
  for (const layer of route(router, path, method).stack.slice(1)) {
    let advanced = false;
    await layer.handle({ params: {}, query: {}, body: {}, ...req }, res, error => {
      if (error) throw error;
      advanced = true;
    });
    if (!advanced) break;
  }
  return res;
}

const creator = granted => ({ _id: 'creator', role: 'employee', permissionOverrides: { granted } });

test('team creation rejects lead assignment before any reads or writes without assignment permission', async t => {
  for (const Model of [Team, Employee]) {
    for (const method of ['findOne', 'findById', 'exists', 'create', 'updateOne', 'updateMany']) {
      t.mock.method(Model, method, () => assert.fail('Denied assignment must not access team/employee data'));
    }
  }
  for (const user of [
    creator(['create_teams']),
    { role: 'hr' },
    { role: 'hr', permissionOverrides: { granted: ['assign_team_leads'], revoked: ['assign_team_leads'] } },
  ]) {
    const res = await invoke(teamRoutes, '/', 'post', { user, body: { teamName: 'New team', teamLead: 'existing-lead' } });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /assign team leads/);
  }
});

test('create-only users can create an unassigned team with omitted or empty lead', async t => {
  let created = 0;
  t.mock.method(Team, 'findOne', async () => null);
  t.mock.method(Team, 'create', async values => {
    created++;
    assert.equal(values.teamLead, null);
    return { _id: 'new-team', ...values };
  });
  t.mock.method(Team, 'findById', () => ({ populate() { return this; }, then(resolve) { resolve({ _id: 'new-team' }); } }));
  t.mock.method(Employee, 'exists', () => assert.fail('No lead lookup needed'));
  for (const teamLead of [undefined, null, '']) {
    const res = await invoke(teamRoutes, '/', 'post', {
      user: creator(['create_teams']), body: { teamName: 'New team', teamLead },
    });
    assert.equal(res.statusCode, 201);
  }
  assert.equal(created, 3);
});

test('authorized creation can move an existing lead and clear the old team relationships', async t => {
  const writes = [];
  const lead = { _id: 'existing-lead', role: 'team_lead', team: 'old-team', save: async () => writes.push('lead') };
  const team = { _id: 'new-team', teamLead: null, save: async () => writes.push('team') };
  t.mock.method(Team, 'create', async () => team);
  t.mock.method(Team, 'findOne', async filter => filter._id ? team : null);
  t.mock.method(Team, 'find', filter => {
    assert.deepEqual(filter, { teamLead: lead._id, _id: { $ne: team._id } });
    return { select: async () => [{ _id: 'old-team' }] };
  });
  t.mock.method(Team, 'findById', () => ({ populate() { return this; }, then(resolve) { resolve(team); } }));
  t.mock.method(Employee, 'exists', async () => true);
  t.mock.method(Employee, 'findById', async () => lead);
  t.mock.method(Team, 'updateMany', async (filter, update) => {
    assert.deepEqual(filter, { _id: { $in: ['old-team'] } });
    assert.deepEqual(update, { $set: { teamLead: null } });
    writes.push('clear-old-team');
  });
  t.mock.method(Employee, 'updateMany', async (filter, update) => {
    writes.push({ filter, update });
  });
  const res = await invoke(teamRoutes, '/', 'post', {
    user: creator(['create_teams', 'assign_team_leads']), body: { teamName: 'New team', teamLead: lead._id },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(lead.team, team._id);
  assert.equal(team.teamLead, lead._id);
  assert.ok(writes.includes('clear-old-team'));
  assert.ok(writes.some(write => write.filter?.team?.$in?.includes('old-team') && write.update.$set.teamLead === null));
  assert.ok(writes.some(write => write.filter?.team === team._id && write.update.$set.teamLead === lead._id));
});

test('assignment permission alone cannot create a team', async () => {
  const res = await invoke(teamRoutes, '/', 'post', {
    user: creator(['assign_team_leads']), body: { teamName: 'New team', teamLead: 'existing-lead' },
  });
  assert.equal(res.statusCode, 403);
});

test('an old edit form cannot reassign a lead after an unchanged-field permission check', async t => {
  let reads = 0, saved = false;
  const team = { _id: 'team', teamLead: 'new-lead', teamName: 'Old name', save: async () => { saved = true; } };
  t.mock.method(Team, 'findById', () => {
    reads++;
    if (reads === 1) return { select() { return this; }, lean: async () => ({ teamLead: 'old-lead' }) };
    if (reads === 2) return team; // A concurrent authorized assignment won.
    return { populate() { return this; }, then(resolve) { resolve(team); } };
  });
  t.mock.method(Team, 'exists', async () => null);
  for (const method of ['exists', 'findById', 'updateMany']) {
    t.mock.method(Employee, method, () => assert.fail('A rename-only request must not assign or move employees'));
  }
  const res = await invoke(teamRoutes, '/:id', 'put', {
    user: creator(['edit_teams']), params: { id: team._id }, body: { teamName: 'Renamed', teamLead: 'old-lead' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(saved, true);
  assert.equal(team.teamName, 'Renamed');
  assert.equal(team.teamLead, 'new-lead');
});

test('attendance gates enforce revocations, default roles and delegated grants on every report route', async () => {
  const cases = [
    ['/team/today', 'view_team_timesheets', 'team_lead'],
    ['/team/history', 'view_team_timesheets', 'team_lead'],
    ['/admin/history', 'view_all_reports', 'hr'],
  ];
  for (const [path, permission, defaultRole] of cases) {
    const gate = route(attendanceRoutes, path, 'get').stack[1].handle;
    for (const [user, expected] of [
      [{ role: defaultRole }, true],
      [{ role: defaultRole, permissionOverrides: { revoked: [permission] } }, false],
      [{ role: 'employee' }, false],
      [creator([permission]), true],
      [{ role: 'admin' }, true],
      [{ role: 'alpha' }, true],
      [{ role: 'manager' }, true],
    ]) {
      let allowed = false;
      const res = response();
      gate({ user }, res, () => { allowed = true; });
      assert.equal(allowed, expected, `${path}: ${JSON.stringify(user)}`);
      if (!expected) assert.equal(res.statusCode, 403);
    }
  }
});
