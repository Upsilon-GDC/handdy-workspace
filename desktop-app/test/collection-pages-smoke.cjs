// Five built management pages, synthetic records and loopback APIs only.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard/dist');
const output = path.resolve(__dirname, '../../backend/.local-repairs/collection-review');
const user = { _id: 'review-admin', role: 'admin', fullName: 'Review Admin' };
const team = { _id: 'team', teamName: 'WCPA', isActive: true, teamLead: { _id: 'lead', fullName: 'Team Lead' } };
const taxTeam = { ...team, _id: 'tax', teamName: 'RENAU CPA & KCPA & Unit 1' };
const softwareTeam = { ...team, _id: 'software', teamName: 'Software' };
const project = { _id: 'project', projectName: 'Audit', projectCode: 'PRJ-AUDIT', teams: [team, null], status: 'Active' };
const employee = { _id: 'employee', fullName: 'Alex Morgan', employeeId: 'E100', email: 'alex@example.invalid', role: 'employee', team, isActive: true, projectRates: [] };
const task = { _id: 'task', taskName: 'Tax preparation', taskCode: 'TSK-100', project, team, teams: [team], taskType: 'work', assignToAllEmployees: true, isActive: true };
const records = { success: true, teams: [team, taxTeam, softwareTeam], projects: [project], employees: [employee], tasks: [task],
  clients: [{ _id: 'client', clientName: 'Upsilon', status: 'Active' }], totalPages: 1, totalEmployees: 1, totalProjects: 1, totalTasks: 1 };
const writes = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') writes.push(url.pathname);
    const body = url.pathname === '/api/auth/me' ? { user }
      : url.pathname === '/api/permissions/me' ? { permissions: [] }
        : url.pathname === '/api/auth/login-requests/pending' ? { loginRequest: null } : records;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return;
  }
  const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(file));
});
let win;
const evaluate = source => win.webContents.executeJavaScript(source);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(source) {
  for (let index = 0; index < 100; index++) { if (await evaluate(source)) return; await wait(100); }
  throw Error(`Timed out: ${source}`);
}
app.whenReady().then(async () => {
  let code = 0; const errors = [];
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1500, height: 1050, webPreferences: { partition: `collection-review-${Date.now()}`, backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error' || event.level >= 3) errors.push(event.message); });
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token','fixture');localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});`);
    for (const [route, name, add] of [['clients', 'Upsilon', 'Add Client'], ['projects', 'Audit', 'Add New Project'],
      ['tasks', 'Tax preparation', 'Add New Task'], ['team', 'WCPA', 'Add New Team'], ['employees', 'Alex Morgan', 'Add employee']]) {
      win.setSize(1500, 1050);
      await win.loadURL(`${base}/admin/${route}`);
      await until(`!!document.querySelector('.collection-heading') && document.querySelector('tbody')?.textContent.includes(${JSON.stringify(name)})`);
      assert.equal(await evaluate(`document.querySelectorAll('.collection-heading').length`), 1);
      assert.equal(await evaluate(`!!document.querySelector('.collection-art[aria-hidden=true] svg')`), true);
      assert.equal(await evaluate(`document.querySelector('.collection-count').textContent.includes('${route === 'team' ? 3 : 1}')`), true);
      if (route === 'team') {
        for (const service of ['audit', 'tax', 'software']) assert.equal(await evaluate(`!!document.querySelector('tbody [data-team-service="${service}"]')`), true, `${service} has its own team logo`);
      } else if (route !== 'clients') assert.equal(await evaluate(`!!document.querySelector('tbody [data-team-service="audit"]')`), true, 'WCPA logo is consistent across pages');
      await evaluate(`document.documentElement.style.scrollBehavior='auto'; document.querySelector('.collection-heading').scrollIntoView({block:'start'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
      fs.writeFileSync(path.join(output, `${route}-desktop.png`), (await win.webContents.capturePage()).toPNG());
      await evaluate(`[...document.querySelectorAll('.collection-heading button')].find(node=>node.textContent.trim()===${JSON.stringify(add)}).click()`);
      if (route === 'tasks') await until(`location.pathname==='/admin/tasks/new'`);
      else {
        await until(`!!document.querySelector('[role=dialog]')`);
        await evaluate(`document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
        await until(`!document.querySelector('[role=dialog]')`);
      }
      win.setSize(430, 900);
      await win.loadURL(`${base}/admin/${route}`);
      await until(`!!document.querySelector('.collection-heading') && parseFloat(getComputedStyle(document.querySelector('.crm-stage')).marginLeft)<1`);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 2`), true, `${route} fits mobile width`);
      await evaluate(`document.querySelector('.collection-heading').scrollIntoView({block:'start'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
      fs.writeFileSync(path.join(output, `${route}-mobile.png`), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    console.log('PASS: five illustrated collection headers, real counts and rows, Add actions/dialogs, task navigation and mobile widths. Mock API only.');
  } catch (error) { code = 1; console.error(error); }
  finally { win?.destroy(); server.closeAllConnections(); server.close(); app.exit(code); }
});
