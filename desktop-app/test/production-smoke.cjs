// Website verification in a hidden browser using loopback fixtures only.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { calculateProduction } = require('../../backend/src/services/production/calculationEngine');
const root = path.resolve(__dirname, '../../dashboard/dist'), output = path.resolve(__dirname, '../../output/production-stage3');
const key = index => `64b000000000000000${String(index).padStart(6, '0')}`;
const wcpa = key(1), renau = key(2), task = key(3), project = key(4), client = key(5), training = key(6);
const teams = [{ _id: wcpa, teamName: 'WCPA' }, { _id: renau, teamName: 'Renau CPA' }];
const employees = Array.from({ length: 30 }, (_, index) => ({ _id: key(100 + index), fullName: index === 0 ? 'Ada Member' : index === 1 ? 'Ben Member' : `Team Member ${String(index).padStart(2, '0')}`,
  employeeId: `E${index + 1}`, team: index === 1 ? renau : wcpa, role: 'employee', isActive: true, projectRates: [{ project: { _id: project, projectName: 'Audit', projectCode: 'PRJ-01' }, chargeRate: 25 }] }));
const tasks = [{ _id: task, taskName: 'Audit review', teams: [wcpa, renau], taskCode: 'TSK-01' }, { _id: training, taskName: 'Training session', teams: [wcpa], taskCode: 'TSK-02' }];
const projects = [{ _id: project, projectName: 'Audit', projectCode: 'PRJ-01', teams: [wcpa, renau] }], clients = [{ _id: client, clientName: 'Acme Client' }];
tasks.push({ _id: key(7), taskName: 'Renau-only work', teams: [renau], taskCode: 'TSK-03' });
tasks.push({ _id: key(9), taskName: 'Break', teams: [wcpa], taskCode: 'BREAK-LIVE', taskType: 'break', isActive: true });
tasks.push({ _id: key(10), taskName: 'Break', teams: [wcpa], taskCode: 'BREAK-OLD', taskType: 'break', isActive: false, deletedAt: '2026-11-01' });
let role = 'admin', failReport = false, failCatalog = false, failBulk = false;
const user = () => role === 'admin' ? { _id: key(90), role, fullName: 'Admin' } : { ...employees[1], role, fullName: role === 'employee' ? 'Ben Member' : 'HR Member' };
const requests = [], writes = [], histories = new Map();
function fixtureReport(query) {
  const { startDate, endDate, view = 'overview' } = query;
  let roster = role === 'employee' ? [employees[1]] : employees;
  let selected = query.employee && query.employee !== 'all' ? roster.filter(row => row._id === query.employee) : roster;
  const filters = Object.fromEntries(['team', 'client', 'project', 'task'].filter(key => query[key] && query[key] !== 'all').map(key => [key, query[key]]));
  const revision = (kind, key, values) => ({ _id: `${kind}-${key}`, kind, key, version: 1, effectiveFrom: startDate, values });
  const settings = [revision('team-billing', wcpa, { billingEnabled: true, currency: 'USD' }),
    ...[wcpa, renau].map(team => revision('classification', `${team}:task:${task}`, { category: 'productive', billable: true })),
    revision('classification', `${wcpa}:task:${training}`, { category: 'training', billable: false }),
    revision('rate', `${wcpa}:*:*`, { enabled: true, hourlyRateHundredths: 2500, currency: 'USD' })];
  const logs = [0, 1].map(index => ({ _id: key(200 + index), employee: employees[index]._id, task, project, client,
    status: 'stopped', startedAt: `${startDate}T09:00:00Z`, stoppedAt: `${startDate}T10:15:00Z`,
    pauses: [{ pausedAt: `${startDate}T09:30:00Z`, resumedAt: `${startDate}T09:45:00Z` }] }));
  logs.push({ _id: key(202), employee: employees[0]._id, task: training, project, client, status: 'stopped',
    startedAt: `${startDate}T11:00:00Z`, stoppedAt: `${startDate}T12:00:00Z`, pauses: [] });
  const allocations = logs.map(row => ({ timeLog: row._id, team: employees.find(person => person._id === row.employee).team, version: 1 }));
  const report = calculateProduction({ employees: selected, tasks, projects, settings, logs, allocations,
    policies: selected.map(row => ({ employee: row._id, revisions: [{ effectiveFrom: startDate, requiredSeconds: 28800, halfDayPercent: 50 }] })),
    attendance: selected.map(row => ({ employee: row._id, date: startDate, status: 'Present' })),
    startDate, endDate, timezone: 'UTC', now: new Date(`${endDate}T23:59:59Z`), filters, includeBilling: role === 'admin' });
  if (filters.team) report.members = report.members.filter(row => row.team === filters.team || row.actualSeconds > 0);
  const rowKey = { overview: 'daily', employee: 'members', team: 'teams', client: 'clientProjects', task: 'tasks', details: 'details' }[view];
  let rows = report[rowKey];
  const total = rows.length, page = Number(query.page || 1), limit = Number(query.limit || 25);
  rows = rows.slice((page - 1) * limit, page * limit).map(row => ({ ...row,
    employeeName: employees.find(person => person._id === row.employee)?.fullName, teamName: teams.find(team => team._id === row.team)?.teamName || 'Needs team allocation',
    taskName: tasks.find(task => task._id === row.task)?.taskName, projectName: 'Audit', clientName: 'Acme Client' }));
  return { summary: { ...report.totals, employeeCount: report.members.length }, rows, total, page, limit, view,
    period: report.period, asOf: report.asOf, provisional: true, warnings: report.warnings,
    scope: { mode: role === 'employee' ? 'personal' : 'company', canConfigure: role === 'admin', financialAccess: role === 'admin' },
    choices: { employees: roster, teams, clients, projects, tasks } };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); return;
  }
  res.setHeader('Content-Type', 'application/json'); let body = {};
  if (url.pathname === '/api/auth/me') body = { user: user() };
  if (url.pathname === '/api/permissions/me') body = { permissions: role === 'hr' ? ['view_all_reports', 'view_billing_amounts'] : [] };
  if (url.pathname === '/api/production/report') {
    const query = Object.fromEntries(url.searchParams); requests.push(query);
    if (failReport) { res.statusCode = 500; res.end(JSON.stringify({ message: 'Synthetic report outage' })); return; }
    body = { report: fixtureReport(query) };
  }
  if (url.pathname === '/api/production/settings/catalog') {
    if (failCatalog) { res.statusCode = 500; res.end(JSON.stringify({ message: 'Synthetic catalog outage' })); return; }
    const taskTeam = url.searchParams.get('taskTeam');
    const rateTeam = url.searchParams.get('rateTeam'), accessTeam = url.searchParams.get('accessTeam'), includeInactive = url.searchParams.get('includeInactiveClients') === 'true';
    const rateClients = [...clients.map(row => ({ ...row, teamIds: [wcpa] })), { _id: key(8), clientName: 'Acme Client', status: 'Inactive', teamIds: [wcpa] },
      { _id: key(11), clientName: 'Renau client', status: 'Active', teamIds: [renau] }, { _id: key(12), clientName: 'Unlinked client', status: 'Active', teamIds: [] }];
    const includeArchived = url.searchParams.get('includeArchivedTasks') === 'true';
    body = { employees: employees.filter(row => !(rateTeam || accessTeam) || row.team === (rateTeam || accessTeam)), teams,
      clients: rateClients.filter(row => (!rateTeam || row.teamIds.includes(rateTeam)) && (!rateTeam || includeInactive || row.status !== 'Inactive')), projects,
      tasks: tasks.filter(row => (!taskTeam || row.teams.includes(taskTeam)) && (!taskTeam || includeArchived || (row.isActive !== false && !row.deletedAt))) };
  }
  if (/\/settings\/[^/]+\/history$/.test(url.pathname)) body = { items: histories.get(`${url.pathname.split('/').at(-2)}:${url.searchParams.get('key')}`) || [] };
  if (url.pathname === '/api/production/settings/audit') body = { items: [] };
  if (req.method === 'POST' && url.pathname.startsWith('/api/production/settings/classification/batch')) {
    let data = ''; for await (const chunk of req) data += chunk; const value = JSON.parse(data);
    if (failBulk) { res.statusCode = 409; res.end(JSON.stringify({ message: 'Some classifications changed. Reload before saving.' })); return; }
    writes.push({ kind: 'classification-batch', ...value }); body = { success: true, count: value.tasks.length }; res.statusCode = 201;
  } else if (req.method === 'POST' && url.pathname.startsWith('/api/production/settings/')) {
    let data = ''; for await (const chunk of req) data += chunk; const value = JSON.parse(data); writes.push({ kind: url.pathname.split('/').at(-1), ...value });
    body = { success: true }; res.statusCode = 201;
  }
  res.end(JSON.stringify(body));
});
let win;
const evaluate = code => win.webContents.executeJavaScript(code), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) { for (let attempt = 0; attempt < 120; attempt++) { if (await evaluate(code)) return; await pause(75); } throw Error(`Timed out: ${code}`); }
const click = label => evaluate(`[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)}).click()`);
const select = (label, value) => evaluate(`(()=>{const node=document.querySelector('select[aria-label="${label}"]');node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const input = (label, value) => evaluate(`(()=>{const node=document.querySelector('[aria-label="${label}"]');const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const ready = view => until(`!!document.querySelector('[data-production-view="${view}"] .prod-summary-grid') && !document.querySelector('[data-production-view="${view}"] fieldset').disabled`);
async function apply() { const before = requests.length; await click('Apply filters'); await until(`!!document.querySelector('.prod-summary-grid') && !document.querySelector('.prod-filter-form fieldset').disabled`); assert.ok(requests.length > before); }
async function capture(name) { await evaluate('window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); win.webContents.invalidate(); await pause(250); fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG()); }
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1450, height: 1100, webPreferences: { partition: `production-${Date.now()}`, backgroundThrottling: false } });
    async function loginAs(value, route = '/admin/production') {
      role = value; await win.loadURL(`${base}/login`); await evaluate(`localStorage.setItem('token','fixture');localStorage.setItem('user',${JSON.stringify(JSON.stringify(user()))});`);
      await win.loadURL(`${base}${route}`);
    }
    await loginAs('admin'); await ready('overview');
    assert.equal(await evaluate(`document.querySelectorAll('.crm-nav details[aria-label="Production"] a').length`), 8);
    assert.equal(await evaluate(`document.querySelector('.prod-money-card').textContent.includes('25.00')`), true);
    assert.equal(await evaluate(`[...document.querySelectorAll('.prod-card')].find(node=>node.firstChild.textContent==='Production hours').textContent.includes('2h 00m')`), true);
    await capture('production-overview.png');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.prod-filter-form select')].map(row=>row.getAttribute('aria-label'))`), ['Period', 'Team']);
    assert.equal(await evaluate(`document.querySelectorAll('.prod-summary-grid .prod-card').length`), 5);
    assert.equal(await evaluate(`!!document.querySelector('input[aria-label="From date"]')`), false);
    await win.loadURL(`${base}/admin/production/employee`); await ready('employee');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.prod-filter-form select')].map(row=>row.getAttribute('aria-label'))`), ['Period', 'Team', 'Employee']);
    await select('Employee', employees[0]._id);
    await select('Team', renau);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Employee"]').value`), 'all', 'Changing team clears the previous employee immediately');
    assert.deepEqual(await evaluate(`[...document.querySelector('[aria-label="Employee"]').options].map(row=>row.value)`), ['all', employees[1]._id], 'Only the selected team members are offered before applying');
    await apply();
    assert.deepEqual(await evaluate(`[...document.querySelector('[aria-label="Employee"]').options].map(row=>row.value)`), ['all', employees[1]._id], 'A report response must not restore unrelated employees');
    await select('Team', 'all');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Employee"]').options.length`), 31);
    await select('Team', renau);
    assert.equal(await evaluate(`!!document.querySelector('.prod-money-card')`), false);
    assert.equal(await evaluate(`document.querySelector('thead').textContent.includes('Estimated billing')`), false);
    await capture('hours-only-team.png');
    await win.loadURL(`${base}/admin/production/team`); await ready('team');
    assert.equal(await evaluate(`!!document.querySelector('.prod-filter-form [aria-label="Employee"]')`), false);
    assert.equal(await evaluate(`document.querySelector('.prod-summary-grid').textContent.includes('Teams compared')`), true);
    await capture('production-teams.png');
    await evaluate(`document.querySelector('.prod-table a').click()`); await ready('employee');
    assert.equal(await evaluate(`document.querySelector('select[aria-label="Team"]').value`), wcpa);
    await win.loadURL(`${base}/admin/production/employee`); await ready('employee');
    assert.equal(await evaluate(`document.querySelector('tbody').rows.length`), 25);
    await select('Period', 'week'); await apply();
    await select('Period', 'custom');
    assert.equal(await evaluate(`!!document.querySelector('input[aria-label="From date"]') && !!document.querySelector('input[aria-label="To date"]')`), true);
    await select('Period', 'week');
    const drillStart = requests.at(-1).startDate, drillEnd = requests.at(-1).endDate;
    await click('Next'); await until(`document.querySelector('.prod-pagination')?.textContent.includes('Page 2')`); assert.equal(requests.at(-1).page, '2');
    assert.equal(requests.at(-1).includeChoices, 'false');
    await select('Employee', employees[0]._id); await apply();
    await evaluate(`document.querySelector('.prod-table a').click()`); await ready('details');
    assert.equal(requests.at(-1).startDate, drillStart); assert.equal(requests.at(-1).endDate, drillEnd);
    assert.equal(await evaluate(`document.querySelector('tbody').textContent.includes('Acme Client') && document.querySelector('tbody').textContent.includes('Audit review')`), true);
    assert.equal(await evaluate(`document.querySelector('.crm-nav details[aria-label="Production"]').open`), true);
    await capture('employee-details.png');
    for (const [route, view, controls] of [['clients', 'client', ['Period', 'Client', 'Project']], ['tasks', 'task', ['Period', 'Task', 'Project']]]) {
      await win.loadURL(`${base}/admin/production/${route}`); await ready(view);
      assert.ok(await evaluate(`document.querySelector('tbody').rows.length>0`));
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.prod-filter-form select')].map(row=>row.getAttribute('aria-label'))`), controls);
      assert.equal(await evaluate(`document.querySelector('.prod-summary-grid').textContent.includes('Expected hours')`), false);
      await capture(`production-${route}.png`);
    }
    await evaluate(`document.querySelector('.prod-table a').click()`); await ready('employee');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Selected work context"]').textContent.includes('Audit review')`), true);
    await evaluate(`document.querySelector('[aria-label="Remove task filter"]').click()`); await apply();
    assert.equal(requests.at(-1).task, 'all');
    failCatalog = true; await win.loadURL(`${base}/admin/production/settings`);
    await until(`!!document.querySelector('.prod-error')`); failCatalog = false; await click('Reload');
    await until(`!!document.querySelector('[aria-label="Production settings form"]') && !document.querySelector('.prod-settings-form fieldset').disabled && !document.querySelectorAll('.prod-settings-form fieldset')[1].disabled`);
    await capture('production-settings.png');
    await click('Activity classifications');
    await until(`!document.querySelector('[aria-label="Task"]').disabled`);
    assert.deepEqual(await evaluate(`[...document.querySelector('[aria-label="Task"]').options].map(row=>row.textContent)`), ['Choose task', 'Audit review', 'Training session', 'Break']);
    await evaluate(`document.querySelector('[aria-label="Include archived tasks"]').click()`);
    await until(`!document.querySelector('[aria-label="Task"]').disabled`);
    assert.equal(await evaluate(`[...document.querySelector('[aria-label="Task"]').options].some(row=>row.textContent.includes('Break (Archived)'))`), true);
    await select('Task', key(10));
    await evaluate(`document.querySelector('[aria-label="Include archived tasks"]').click()`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Task"]').value`), '');
    await until(`!document.querySelector('[aria-label="Task"]').disabled`);
    assert.equal(await evaluate(`[...document.querySelector('[aria-label="Task"]').options].filter(row=>row.textContent==='Break').length`), 1);
    await select('Task', training);
    await select('Team', renau);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Task"]').value`), '', 'Team changes clear the selected classification task');
    await until(`!document.querySelector('[aria-label="Task"]').disabled`);
    assert.deepEqual(await evaluate(`[...document.querySelector('[aria-label="Task"]').options].map(row=>row.textContent)`), ['Choose task', 'Audit review', 'Renau-only work']);
    await select('Team', wcpa); await until(`!document.querySelector('[aria-label="Task"]').disabled`);
    await select('Task', task);
    await until(`!document.querySelectorAll('.prod-settings-form fieldset')[1].disabled`);
    await input('Reason for change', 'Classify audit work'); await click('Save setting');
    await until(`!!document.querySelector('.prod-success')`);
    assert.equal(writes.at(-1).kind, 'classification'); assert.equal(writes.at(-1).target, task); assert.equal(writes.at(-1).expectedVersion, 0);
    await evaluate(`document.querySelector('[aria-label="Select multiple tasks"]').click()`);
    await click('Select all tasks');
    assert.equal(await evaluate(`document.querySelector('.prod-task-picker-actions strong').textContent`), '3 selected');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Production settings form"] button[type="submit"]').disabled`), true, 'Select-all cannot turn break tasks into productive work');
    await click('Clear selection'); await input('Find classification tasks', 'Training'); await click('Select all shown');
    await input('Find classification tasks', 'Audit'); await click('Select all shown');
    assert.equal(await evaluate(`document.querySelector('.prod-task-picker-actions strong').textContent`), '2 selected', 'Search preserves previously selected tasks');
    await select('Activity category', 'training'); await input('Reason for change', 'Classify selected training activities');
    failBulk = true; await click('Apply to 2 selected tasks'); await until(`document.querySelector('[role="alert"]')?.textContent.includes('classifications changed')`);
    assert.equal(await evaluate(`document.querySelector('.prod-task-picker-actions strong').textContent`), '2 selected', 'Failed saves preserve the selection for review');
    failBulk = false; await click('Apply to 2 selected tasks'); await until(`document.querySelector('.prod-success')?.textContent.includes('2 tasks')`);
    assert.equal(writes.at(-1).kind, 'classification-batch'); assert.deepEqual(writes.at(-1).tasks.map(row=>row.task).sort(), [task, training].sort());
    assert.equal(writes.at(-1).category, 'training'); assert.equal(writes.at(-1).billable, false);
    await select('Team', renau); await until(`!document.querySelector('[aria-label="Select classification tasks"]').disabled`);
    assert.equal(await evaluate(`document.querySelector('.prod-task-picker-actions strong').textContent`), '0 selected');
    await select('Team', wcpa); await until(`!document.querySelector('[aria-label="Select classification tasks"]').disabled`);
    await input('Find classification tasks', ''); await click('Select all tasks'); await select('Activity category', 'excluded');
    await capture('production-multi-classification.png');
    await click('Billing rates'); await until(`!document.querySelector('[aria-label="Employee"]').disabled`);
    assert.equal(await evaluate(`[...document.querySelector('[aria-label="Employee"]').options].some(row=>row.value===${JSON.stringify(employees[1]._id)})`), false);
    await until(`document.querySelector('[aria-label="Employee project billing rates"]')?.textContent.includes('25.00')`);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Hourly rate"]')`), false);
    await select('Employee', employees[0]._id); await select('Team', renau);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Employee"]').value`), '');
    await until(`!document.querySelector('[aria-label="Employee"]').disabled`);
    assert.deepEqual(await evaluate(`[...document.querySelector('[aria-label="Employee"]').options].map(row=>row.value)`), ['', employees[1]._id]);
    await select('Team', wcpa); await until(`!document.querySelector('[aria-label="Employee"]').disabled`);
    await capture('production-rate-choices.png');
    await click('Team access'); await until(`!document.querySelector('[aria-label="Employee"]').disabled`);
    assert.equal(await evaluate(`[...document.querySelector('[aria-label="Employee"]').options].some(row=>row.value===${JSON.stringify(employees[1]._id)})`), false, 'WCPA access choices exclude other teams');
    await select('Employee', employees[0]._id); await select('Team', renau);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Employee"]').value`), '', 'Changing the access team clears the previous employee');
    await until(`!document.querySelector('[aria-label="Employee"]').disabled`);
    assert.deepEqual(await evaluate(`[...document.querySelector('[aria-label="Employee"]').options].map(row=>row.value)`), ['', employees[1]._id]);
    await select('Employee', employees[1]._id); await until(`!document.querySelectorAll('.prod-settings-form fieldset')[1].disabled`);
    await input('Reason for change', 'Grant scoped access'); await click('Save setting'); await until(`!!document.querySelector('.prod-success')`);
    assert.equal(writes.at(-1).kind, 'access'); assert.equal(writes.at(-1).canViewBilling, false); assert.equal(writes.at(-1).team, renau); assert.equal(writes.at(-1).employee, employees[1]._id);
    await loginAs('employee'); await ready('overview');
    assert.equal(await evaluate(`!!document.querySelector('.prod-money-card') || !!document.querySelector('.crm-nav a[href="/admin/production/settings"]')`), false);
    await win.loadURL(`${base}/admin/production/employee`); await ready('employee');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Employee"]').options.length`), 2);
    await win.loadURL(`${base}/admin/production/settings`); await until(`document.body.textContent.includes('Only an Admin can configure Production.')`);
    await loginAs('hr'); await ready('overview'); assert.equal(await evaluate(`!!document.querySelector('.prod-money-card')`), false);
    failReport = true; await click('Apply filters'); await until(`!!document.querySelector('[role="alert"]')`);
    assert.equal(await evaluate(`!!document.querySelector('.prod-summary-grid')`), false);
    failReport = false; await click('Try again'); await ready('overview');
    win.setSize(430, 950); await win.loadURL(`${base}/admin/production`); await ready('overview');
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), true);
    await capture('production-mobile.png');
    console.log('PASS: Production five views, employee/team drill-down, filters, pagination, hours-only and financial visibility, settings writes, personal/HR scope, errors/retry and mobile. Loopback fixtures only.');
    win.destroy(); server.close(); app.exit(0);
  } catch (error) {
    console.error(error);
    if (win && !win.isDestroyed()) console.error(await evaluate(`JSON.stringify({path:location.pathname,error:document.querySelector('[role="alert"]')?.textContent,status:document.querySelector('[role="status"]')?.textContent,buttons:[...document.querySelectorAll('button')].map(node=>[node.textContent,node.disabled])})`).catch(() => 'No DOM'));
    win?.destroy(); server.close(); app.exit(1);
  }
});
