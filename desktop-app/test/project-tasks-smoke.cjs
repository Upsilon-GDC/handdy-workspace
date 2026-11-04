// Built React project forms, isolated profile, localhost fixture API only.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard/dist');
const user = { _id: 'admin', role: 'admin', fullName: 'Test Admin' };
const tasks = ['Tax Review', 'Tax Preparation'].map((taskName, i) => ({ _id: `task-${i}`, taskName, taskCode: `T${i}`, teams: ['tax'], project: { _id: 'original', projectName: 'Original project' } }));
let projects = [], writes = [];
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
  if (url.pathname === '/api/projects/task-options') body = { tasks };
  if (url.pathname === '/api/projects' && req.method === 'GET') body = { projects, totalPages: 1 };
  if (url.pathname.startsWith('/api/projects') && ['POST', 'PUT'].includes(req.method)) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); writes.push(input);
    if (req.method === 'POST') projects.push({ ...input, _id: `project-${projects.length}`, projectCode: 'NEW', status: 'Active' });
    else projects[0] = { ...projects[0], ...input };
    body = { success: true };
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
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { partition: `project-tasks-${Date.now()}`, backgroundThrottling: false } });
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token','mock'); localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});`);
    await win.loadURL(`${base}/admin/projects`);
    await until(`document.body.textContent.includes('Add New Project')`);
    await click('+ Add New Project');
    await until(`!!document.querySelector('input[name="projectName"]')`);
    await evaluate(`(() => { const input = document.querySelector('input[name="projectName"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Second project'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate(`document.querySelector('[aria-label="Select teams"] button').click()`);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Select existing tasks"]')`), false);
    await click('Save Project');
    await until(`!document.querySelector('input[name="projectName"]') && document.body.textContent.includes('Second project')`);
    assert.equal(Object.hasOwn(writes[0], 'linkedTasks'), false);
    projects[0].linkedTasks = ['existing-task'];
    await click('Edit');
    await until(`!!document.querySelector('input[name="projectName"]')`);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Select existing tasks"]')`), false);
    const preview = path.resolve(__dirname, '../../backend/.local-repairs/project-edit-without-tasks.png');
    fs.mkdirSync(path.dirname(preview), { recursive: true });
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(preview, (await win.webContents.capturePage()).toPNG());
    await click('Update Project');
    await until(`!document.querySelector('input[name="projectName"]')`);
    assert.equal(Object.hasOwn(writes[1], 'linkedTasks'), false);
    assert.deepEqual(projects[0].linkedTasks, ['existing-task']);
    console.log('PASS: project create/edit omit task pickers and task payloads; saving preserves existing task links. Local fixtures only.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); server.close(); app.exit(process.exitCode || 0); }
});
