// Real task form DOM with an isolated profile and localhost fixture API.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard/dist');
const user = { _id: 'admin', role: 'admin', fullName: 'Admin' };
const projects = [{ _id: 'p1', projectName: 'Tax Review', projectCode: 'P1', teams: ['tax'], clientIds: ['c1'] },
  { _id: 'p2', projectName: 'Tax Preparation', projectCode: 'P2', teams: ['tax'], clientIds: ['c2'] }];
const options = { projects, clients: [{ _id: 'c1', clientName: 'First client' }, { _id: 'c2', clientName: 'Second client' }], teams: [{ _id: 'tax', teamName: 'Tax team' }], employees: [] };
const revision = '2026-01-01T00:00:00.000Z';
let tasks = [], writes = [], selections = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file)); return;
  }
  let body = {};
  if (url.pathname === '/api/auth/me') body = { user };
  if (url.pathname === '/api/permissions/me') body = { permissions: [] };
  if (url.pathname === '/api/teams') body = { teams: [{ _id: 'tax', teamName: 'Tax team', isActive: true }] };
  if (url.pathname === '/api/employees/options') body = { employees: [], totalPages: 1 };
  if (url.pathname === '/api/tasks/creation-options' || url.pathname === '/api/tasks/project-options') body = options;
  if (url.pathname === '/api/tasks') body = { tasks, totalPages: 1 };
  if (url.pathname.endsWith('/project-selections')) body = { projectSelections: selections, expectedUpdatedAt: revision, expectedProjectLinks: 'a'.repeat(64) };
  if (url.pathname.endsWith('/multi-project')) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); writes.push(input); selections = input.projectSelections;
    tasks = [{ _id: 'task', taskName: input.taskNames[0], taskCode: 'T1', taskType: 'work', project: projects.find(project => project._id === selections[0].project),
      team: { _id: 'tax', teamName: 'Tax team' }, teams: [{ _id: 'tax', teamName: 'Tax team' }], assignToAllEmployees: true, assignedTo: [], isActive: true, updatedAt: revision }];
    body = { success: true, tasks, task: tasks[0] };
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
});
let win;
const evaluate = code => win.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) {
  for (let n = 0; n < 100; n++) { if (await evaluate(code)) return; await delay(100); }
  throw new Error(`Timed out: ${code}`);
}
const click = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { partition: `multi-project-${Date.now()}`, backgroundThrottling: false } });
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token','mock');localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});`);
    await win.loadURL(`${base}/admin/tasks/new`);
    await until(`!!document.querySelector('[aria-label="Include project Tax Review"]')`);
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Select projects"]').length`), 1);
    assert.equal(await evaluate(`document.querySelector('#task-creation-project')`), null);
    await evaluate(`document.querySelector('[aria-label="Include project Tax Review"]').click()`);
    await evaluate(`document.querySelector('[aria-label="Include project Tax Preparation"]').click()`);
    await evaluate(`(() => { const input=document.querySelector('input[placeholder="Enter task name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Shared tax');input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Client for Tax Preparation"]').value`), 'c2');
    await click('Save task');
    await until(`location.pathname === '/admin/tasks' && !!document.querySelector('[aria-label="Edit Shared tax"]')`);
    assert.deepEqual(writes[0].projectSelections, [{ project: 'p1', client: 'c1' }, { project: 'p2', client: 'c2' }]);
    await evaluate(`document.querySelector('[aria-label="Edit Shared tax"]').click()`);
    await until(`document.body.textContent.includes('Change project selections')`);
    await evaluate(`[...document.querySelectorAll('label')].find(label=>label.textContent.trim()==='Change project selections').querySelector('input').click()`);
    await until(`document.querySelector('[aria-label="Include project Tax Preparation"]')?.checked === true`);
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Select projects"]').length`), 1);
    assert.equal(await evaluate(`document.querySelector('#task-creation-project')`), null);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const preview = path.resolve(__dirname, '../../backend/.local-repairs/unified-project-selection.png');
    fs.mkdirSync(path.dirname(preview), { recursive: true });
    fs.writeFileSync(preview, (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('[aria-label="Include project Tax Preparation"]').click()`);
    await click('Update Task');
    await until(`!document.querySelector('input[placeholder="Enter task name"]')`);
    assert.deepEqual(writes[1].projectSelections, [{ project: 'p1', client: 'c1' }]);
    assert.equal(writes[1].expectedUpdatedAt, revision);
    console.log('PASS: creation selects two projects with different clients; editing restores selections and removes one project with revision protection. Local fixtures only.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); server.close(); app.exit(process.exitCode || 0); }
});
