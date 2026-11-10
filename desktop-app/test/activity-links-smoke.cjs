// Real dashboard DOM with a private mock API; never connects to MongoDB.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard/dist');
const user = { _id: 'test-admin', role: 'admin', fullName: 'Test Admin' };
const project = { _id: 'p1', projectName: 'Audit', projectCode: 'P1', teams: ['team'], clients: ['inactive-client'], activityLinksVersion: 0 };
const other = { _id: 'p2', projectName: 'Other project', projectCode: 'P2', teams: ['other-team'], clients: ['c2'] };
const clients = [{ _id: 'c1', clientName: 'Client One' }, { _id: 'c2', clientName: 'Client Two' }];
const tasks = Array.from({ length: 125 }, (_, index) => ({ _id: `t${index + 1}`, taskName: `Task ${index + 1}`, taskCode: `CODE-${index + 1}`, taskType: 'work', teams: [{ _id: 'team', teamName: 'Audit team' }] }));
tasks.push({ _id: 'excluded', taskName: 'Wrong project task', project: 'p2', teams: [{ _id: 'other-team' }] });
let mappings = [], requests = [], forceConflict = false;
let permissionGrants = ['create_tasks', 'reassign_tasks'];
let creationRejected = false;
const creationRequests = [];
let createdTasks = [], editedTaskBody = null;
const creationProjects = () => [{ ...project, clientIds: ['c1'] }, ...(['admin', 'manager'].includes(user.role) ? [
  { ...other, teams: ['team', 'second-team'], clientIds: ['c1', 'c2'] },
  { _id: 'p3', projectName: 'Not configured', clientIds: [], teams: ['team'] },
] : [])];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file)); return;
  }
  res.setHeader('Content-Type', 'application/json');
  let body = {};
  if (url.pathname === '/api/auth/me') body = { user };
  if (url.pathname === '/api/permissions/me') body = { permissions: permissionGrants };
  if (url.pathname === '/api/tasks') body = { tasks: createdTasks, totalPages: 1 };
  if (url.pathname === '/api/employees/options' || url.pathname === '/api/employees/my-team') body = { employees: [], totalPages: 1 };
  if (url.pathname === '/api/tasks/creation-options') body = {
    projects: creationProjects(),
    clients, teams: [{ _id: 'team', teamName: 'Audit team' }, ...(['admin', 'manager'].includes(user.role) ? [{ _id: 'second-team', teamName: 'Second accounting team' }, { _id: 'software', teamName: 'Software' }] : [])],
  };
  if (url.pathname === '/api/tasks/linked') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); creationRequests.push(input);
    if (creationRejected) { res.statusCode = 409; res.end(JSON.stringify({ message: 'A task already exists for this client.' })); return; }
    const assignedTeams = input.teamAssignment === 'project' ? creationProjects().find(item => item._id === input.project).teams : input.teamAssignment === 'own' ? ['team'] : input.teams;
    createdTasks = input.taskNames.map((taskName, index) => ({ _id: `created-${index}`, taskName, taskCode: `CREATED-${index}`, taskType: input.taskType,
      project: input.project, team: { _id: assignedTeams[0], teamName: 'Audit team' }, teams: assignedTeams.map(_id => ({ _id, teamName: _id === 'team' ? 'Audit team' : 'Second accounting team' })), assignToAllEmployees: true, assignedTo: [], isActive: true }));
    body = { success: true, tasks: createdTasks };
  }
  if (url.pathname === '/api/tasks/created-0' && req.method === 'PUT') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    editedTaskBody = JSON.parse(raw);
    body = { success: true, task: createdTasks[0] };
  }
  if (url.pathname === '/api/teams') body = { teams: [{ _id: 'team', teamName: 'Audit team', isActive: true }] };
  if (url.pathname === '/api/projects/activity-links/batch') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); requests.push(input);
    if (forceConflict) { res.statusCode = 409; res.end(JSON.stringify({ message: 'Links changed. Close and reopen before saving.' })); return; }
    assert.equal(input.projects[0].version, project.activityLinksVersion); project.activityLinksVersion++;
    if (input.action === 'link') mappings = input.taskIds.map(task => ({ project: input.projects[0].project, client: input.clientIds[0], task }));
    if (input.action === 'unlink') mappings = [];
    body = { success: true, message: 'Changes saved.' };
  }
  if (url.pathname === '/api/projects/activity-links') {
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw); requests.push(input);
      if (forceConflict) { res.statusCode = 409; res.end(JSON.stringify({ message: 'Links changed. Close and reopen before saving.' })); return; }
      assert.equal(input.version, project.activityLinksVersion);
      project.activityLinksVersion++;
      if (input.action === 'clients') project.clients = input.clientIds;
      if (input.action === 'link') mappings = input.taskIds.map(task => ({ project: input.project, client: input.client, task }));
      if (input.action === 'unlink') mappings = mappings.filter(item => !input.taskIds.includes(item.task));
      if (input.action === 'policy') project.activityMappingEnabled = input.enabled;
      body = { success: true, message: 'Changes saved.', version: project.activityLinksVersion };
    } else body = { projects: [project, other], clients, tasks, mappings };
  }
  res.end(JSON.stringify(body));
});
let win;
const evaluate = code => win.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) {
  for (let n = 0; n < 100; n++) { if (await evaluate(code)) return; await delay(100); }
  throw new Error(`Timed out: ${code}`);
}
const choose = (selector, value) => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const chooseProject = async value => {
  await evaluate(`[...document.querySelectorAll('input[name="taskProjects"]:checked')].forEach(input => input.click())`);
  await evaluate(`document.querySelector('input[name="taskProjects"][value="' + ${JSON.stringify(value)} + '"]').click()`);
};
const clickText = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
const fill = (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { partition: `links-${Date.now()}`, backgroundThrottling: false } });
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token', 'mock'); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))})`);
    await win.loadURL(`${base}/admin/tasks`);
    await until(`document.body.textContent.includes('Link multiple tasks')`);
    await clickText('Link multiple tasks');
    await until(`!!document.querySelector('[aria-label="Select projects"] input[value="p1"]')`);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Project settings')`), false);
    await evaluate(`document.querySelector('[aria-label="Select projects"] input[value="p1"]').click()`);
    await evaluate(`document.querySelector('[aria-label="Select clients"] input[value="c1"]').click()`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Select tasks"] input[value="excluded"]').disabled`), true);
    await evaluate(`document.querySelector('[aria-label="Select tasks"]').closest('section').querySelector('button').click()`);
    const screenshot = path.resolve(__dirname, '../../backend/.local-repairs/activity-phase2/activity-links.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await delay(300); // Allow Chromium to paint the selected-state layout.
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const geometry = await evaluate(`(() => { const modal = document.querySelector('.activity-links-modal'); return { width: modal.clientWidth, scroll: modal.scrollWidth, overflowing: [...modal.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > modal.getBoundingClientRect().right).map(element => ({ tag: element.tagName, name: element.className, width: element.getBoundingClientRect().width })) }; })()`);
    assert.equal(geometry.scroll <= geometry.width + 1, true, `linking modal fits without horizontal scrolling: ${JSON.stringify(geometry)}`);
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
    await clickText('Review links'); await clickText('Confirm links');
    await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(requests.at(-1).taskIds.length, 125);
    assert.equal(requests.at(-1).action, 'link');
    await evaluate(`document.querySelector('[aria-label="Select projects"] input[value="p1"]').click()`);
    await evaluate(`document.querySelector('[aria-label="Select clients"] input[value="c1"]').click()`);
    await evaluate(`document.querySelector('[aria-label="Select tasks"]').closest('section').querySelector('button').click()`);
    await clickText('Review unlink'); await clickText('Confirm unlink');
    await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(requests.at(-1).action, 'unlink');
    await evaluate(`document.querySelector('[aria-label="Select projects"] input[value="p1"]').click()`);
    await evaluate(`document.querySelector('[aria-label="Select clients"] input[value="c1"]').click()`);
    await evaluate(`document.querySelector('[aria-label="Select tasks"]').closest('section').querySelector('button').click()`);
    forceConflict = true;
    await clickText('Review links'); await clickText('Confirm links');
    await until(`document.querySelector('[role="alert"]')?.textContent.includes('Close and reopen')`);
    await clickText('Reload links');
    await until(`!!document.querySelector('[aria-label="Select projects"] input') && !document.querySelector('[role="alert"]')`);
    assert.equal(mappings.length, 0);
    await win.loadURL(`${base}/admin/tasks/new`);
    await until(`!!document.querySelector('input[name="taskProjects"][value="p1"]')`);
    await chooseProject('p1');
    assert.equal(await evaluate(`document.querySelector('.admin-task-extra-project select').value`), 'c1');
    assert.equal(await evaluate(`document.querySelector('.admin-task-extra-project select').disabled`), true);
    await chooseProject('p3');
    assert.equal(await evaluate(`document.querySelector('.admin-add-task-save').disabled`), true);
    assert.ok(await evaluate(`document.querySelector('.admin-task-project-selection').textContent.includes('no active linked clients')`));
    await chooseProject('p2');
    assert.equal(await evaluate(`document.querySelector('.admin-task-extra-project select').value`), '', 'changing project clears the previous client');
    assert.equal(await evaluate(`document.querySelector('.admin-task-team-grid')`), null, 'team picker is hidden by default');
    assert.equal(await evaluate(`document.querySelector('.admin-task-auto-access').textContent.includes('Second accounting team')`), true);
    assert.equal(await evaluate(`document.querySelector('.admin-task-auto-access').textContent.includes('Software')`), false);
    await clickText('Change team access');
    assert.equal(await evaluate(`document.querySelectorAll('.admin-task-team-option').length`), 2);
    await evaluate(`document.querySelectorAll('.admin-task-team-option')[1].click()`);
    await choose('.admin-task-extra-project select', 'c2');
    await fill('.admin-task-name-list > label input', 'Audit review');
    await clickText('+ Add another task name');
    await fill('.admin-task-name-row input', 'Audit preparation');
    creationRejected = true;
    await evaluate(`document.querySelector('.admin-add-task-save').click()`);
    await until(`document.querySelector('[role="alert"]')?.textContent.includes('already exists')`);
    assert.equal(await evaluate(`document.querySelector('.admin-task-name-list > label input').value`), 'Audit review', 'a failed batch preserves form values');
    creationRejected = false;
    await evaluate(`document.querySelector('.admin-add-task-save').click()`);
    await until(`location.pathname === '/admin/tasks'`);
    assert.deepEqual(creationRequests.at(-1).taskNames, ['Audit review', 'Audit preparation']);
    assert.equal(creationRequests.at(-1).project, 'p2');
    assert.equal(creationRequests.at(-1).client, 'c2');
    assert.deepEqual(creationRequests.at(-1).teams, ['team']);
    assert.equal(creationRequests.at(-1).teamAssignment, 'selected');
    assert.equal(Object.hasOwn(creationRequests.at(-1), 'autoProjects'), false);
    await until(`!!document.querySelector('button[aria-label="Edit Audit review"]')`);
    await evaluate(`document.querySelector('button[aria-label="Edit Audit review"]').click()`);
    await until(`!!document.querySelector('form.embedded')`);
    await evaluate(`document.querySelector('form.embedded .admin-add-task-save').click()`);
    await until(`!document.querySelector('form.embedded')`);
    assert.ok(editedTaskBody);
    assert.equal(Object.hasOwn(editedTaskBody, 'project'), false, 'editing must not reset an existing project to null');
    user.role = 'manager';
    await evaluate(`localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))})`);
    await win.loadURL(`${base}/admin/tasks/new`);
    await until(`!!document.querySelector('input[name="taskProjects"][value="p2"]')`);
    await chooseProject('p2');
    await choose('.admin-task-extra-project select', 'c1');
    await fill('.admin-task-name-list > label input', 'Manager shared work');
    await evaluate(`document.querySelector('.admin-add-task-save').click()`);
    await until(`location.pathname === '/admin/tasks'`);
    assert.equal(creationRequests.at(-1).teamAssignment, 'project');
    assert.equal(Object.hasOwn(creationRequests.at(-1), 'teams'), false, 'backend resolves the current project teams');
    assert.equal(createdTasks[0].teams.length, 2);
    user.role = 'team_lead'; user.team = 'team';
    await evaluate(`localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))})`);
    await win.loadURL(`${base}/team-lead/tasks/add`);
    await until(`!!document.querySelector('input[name="taskProjects"][value="p1"]')`);
    assert.equal(await evaluate(`!!document.querySelector('input[name="taskProjects"][value="p2"]')`), false);
    await chooseProject('p1');
    assert.equal(await evaluate(`document.querySelector('.admin-task-extra-project select').value`), 'c1');
    await fill('.admin-task-name-list > label input', 'Lead review');
    const creationScreenshot = path.resolve(__dirname, '../../backend/.local-repairs/activity-phase2/task-creation.png');
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    fs.writeFileSync(creationScreenshot, (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('.admin-add-task-save').click()`);
    await until(`location.pathname === '/team-lead/tasks'`);
    assert.deepEqual(creationRequests.at(-1).taskNames, ['Lead review']);
    assert.equal(creationRequests.at(-1).teamAssignment, 'own');
    assert.equal(Object.hasOwn(creationRequests.at(-1), 'teams'), false, 'TL does not need to submit a team');
    assert.equal(creationRequests.at(-1).client, 'c1');
    assert.deepEqual(createdTasks[0].teams.map(team => team._id), ['team']);
    user.role = 'manager';
    await evaluate(`localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))})`);
    await win.loadURL(`${base}/admin/tasks`);
    await until(`!!document.querySelector('button[aria-label="Edit Lead review"]')`);
    user.role = 'employee';
    permissionGrants = ['manage_activity_links'];
    forceConflict = false;
    await evaluate(`localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))})`);
    await win.loadURL(`${base}/admin/task-links`);
    await until(`!!document.querySelector('.crm-nav a[href="/admin/project-client-links"]') && document.body.textContent.includes('Select what you want to connect')`);
    assert.equal(await evaluate(`!!document.querySelector('a[href="/admin/projects"]')`), false, 'linking does not grant project management');
    await until(`!!document.querySelector('[aria-label="Select projects"] input[value="p1"]')`);
    await evaluate(`document.querySelector('[aria-label="Select projects"] input[value="p1"]').click()`);
    await evaluate(`document.querySelector('[aria-label="Select clients"] input[value="c1"]').click()`);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>/Enable linked selection|Restore legacy selection/.test(b.textContent))`), false);
    await evaluate(`document.querySelector('[aria-label="Select tasks"]').closest('section').querySelector('button').click()`);
    await clickText('Review links'); await clickText('Confirm links');
    await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(requests.at(-1).action, 'link');
    const delegatedScreenshot = path.join(__dirname, '../../backend/.local-repairs/activity-phase2/delegated-task-links.png');
    fs.writeFileSync(delegatedScreenshot, (await win.webContents.capturePage()).toPNG());
    permissionGrants = [];
    await win.loadURL(`${base}/admin/task-links`);
    await until(`location.pathname === '/employee/dashboard'`);
    assert.equal(await evaluate(`!!document.querySelector('.crm-nav a[href="/admin/project-client-links"]')`), false);
    console.log('PASS: bulk links, automatic manager/project and TL/own-team assignment, admin override excluding Software, manager visibility, linked creation and edit preservation. Delegated employee link-only access and revocation. Mock API only.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); server.close(); app.exit(process.exitCode || 0); }
});
