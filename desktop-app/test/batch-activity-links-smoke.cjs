// Hidden browser, loopback fixtures only. Never connects to the deployed CRM.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard/dist');
const output = path.resolve(__dirname, '../../output/work-setup-redesign');
const user = { _id: 'admin', role: 'admin', fullName: 'Admin' };
const data = { projects: ['Tax Filing', 'Bookkeeping'].map((projectName, i) => ({ _id: `p${i}`, projectName, projectCode: `P${i}`, teams: ['tax'], activityLinksVersion: 0, clients: [] })),
  clients: [{ _id: 'c1', clientName: 'ABC Company' }, { _id: 'c2', clientName: 'XYZ Company' }],
  tasks: [{ _id: 't1', taskName: 'Document Review', taskCode: 'T1', teams: ['tax'] }, { _id: 't2', taskName: 'Tax Preparation', taskCode: 'T2', teams: ['tax'] }, { _id: 'foreign', taskName: 'Other team task', taskCode: 'T3', teams: ['other'] }], mappings: [] };
const writes = [], history = [];
let failNext = false, conflictNext = false;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); return;
  }
  let body = {};
  if (url.pathname === '/api/auth/me') body = { user };
  if (url.pathname === '/api/permissions/me') body = { permissions: [] };
  if (url.pathname === '/api/client-access') body = { teams: [], employees: [], clients: [], projects: [], policies: [] };
  if (url.pathname === '/api/client-access/history') body = { history: [], totalPages: 1, page: 1, totalRecords: 0 };
  if (url.pathname === '/api/projects/activity-links') body = data;
  if (url.pathname === '/api/projects/activity-links/history') body = { history: history.filter(row => row.mode === url.searchParams.get('mode')), totalPages: 1 };
  if (url.pathname === '/api/projects/activity-links/batch') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    if (failNext || conflictNext) { res.statusCode = conflictNext ? 409 : 500; failNext = false; conflictNext = false; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: 'Synthetic save failure' })); return; }
    writes.push(input);
    input.projects.forEach(row => { const project = data.projects.find(project => project._id === row.project); assert.equal(project.activityLinksVersion, row.version); project.activityLinksVersion++; });
    const entry = { _id: `history-${writes.length}`, mode: input.mode, action: input.action, actorName: 'Admin', createdAt: new Date().toISOString(),
      projects: input.projects.map(row => ({ id: row.project, name: data.projects.find(project => project._id === row.project).projectName })),
      clients: input.clientIds.map(id => ({ id, name: data.clients.find(client => client._id === id).clientName })),
      tasks: input.taskIds.map(id => ({ id, name: data.tasks.find(task => task._id === id).taskName })), combinationCount: input.projects.length * input.clientIds.length * (input.mode === 'clients' ? 1 : input.taskIds.length) };
    history.unshift(entry); body = { success: true, message: 'Saved.', history: entry };
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
});
let win;
const evaluate = code => win.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) { for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await delay(100); } throw new Error(`Timed out: ${code}`); }
const click = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
const fill = (selector, value) => evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
async function capture(name) { await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`); fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG()); }
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { partition: `work-setup-${Date.now()}`, backgroundThrottling: false } });
    await win.loadURL(`${base}/login`); await evaluate(`localStorage.setItem('app-theme','upsilon');localStorage.setItem('token','mock');localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});`);
    await win.loadURL(`${base}/admin/project-client-links`); await until(`document.querySelectorAll('.activity-batch-picker').length===3`);
    assert.equal(await evaluate(`document.querySelectorAll('.crm-nav details[aria-label="Task linking"] a').length`), 1);
    assert.equal(await evaluate(`!!document.querySelector('.setup-progress') || !!document.querySelector('.work-setup-options')`), false);
    const select = async (group, value) => evaluate(`document.querySelector('[aria-label="Select ${group}"] input[value="${value}"]').click()`);
    await capture('all-selections-desktop.png');
    await select('tasks','t1'); await select('clients','c1'); await select('projects','p0');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Select tasks"] input[value="t1"]').checked`), true, 'Task-first selection is preserved');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Select tasks"] input[value="foreign"]').disabled`), true);
    await select('projects','p1'); await select('clients','c2'); await select('tasks','t2');
    await fill('[aria-label="Search tasks"]','Review');
    await click('Review links');
    assert.equal(writes.length,0);
    assert.equal(await evaluate(`document.querySelectorAll('.activity-batch-picker').length`),3,'All choices remain on screen during review');
    assert.equal(await evaluate(`document.querySelector('.activity-batch-review').textContent.includes('Tax Preparation')`),true,'Search retains hidden task selections');
    await select('clients','c2');
    assert.equal(await evaluate(`!!document.querySelector('.activity-batch-review')`),false,'Changing choices clears the old review');
    await select('clients','c2'); await click('Review links'); await capture('all-selections-review.png');
    failNext=true; await click('Confirm links'); await until(`!!document.querySelector('.activity-batch-form [role="alert"]') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(writes.length,0); assert.equal(await evaluate(`document.querySelectorAll('.activity-batch-list input:checked').length`),5);
    await click('Confirm links'); await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(writes.length,1); assert.equal(writes[0].projects.length,2); assert.equal(writes[0].clientIds.length,2); assert.deepEqual(writes[0].taskIds,['t1','t2']);
    assert.equal(await evaluate(`document.querySelectorAll('.activity-batch-list input:checked').length`),0);
    await select('projects','p0'); await select('clients','c1'); await select('tasks','t1'); await click('Review unlink'); await click('Confirm unlink');
    await until(`!document.querySelector('.activity-links-fields').disabled && !document.querySelector('.activity-batch-review')`);
    assert.equal(writes[1].action,'unlink'); assert.equal(writes[1].projects[0].version,1);
    await evaluate(`document.querySelector('[aria-label="Include tasks"]').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('.activity-batch-picker').length`),2);
    await select('projects','p1'); await select('clients','c1'); await click('Review links'); await click('Confirm links');
    await until(`!document.querySelector('.activity-links-fields').disabled && !document.querySelector('.activity-batch-review')`);
    assert.equal(writes[2].mode,'clients'); assert.deepEqual(writes[2].taskIds,[]);
    await evaluate(`document.querySelector('[aria-label="Include tasks"]').click()`);
    await select('projects','p0'); await select('clients','c1'); await select('tasks','t1'); await click('Review links'); conflictNext=true; await click('Confirm links');
    await until(`!!document.querySelector('.activity-batch-form [role="alert"]')`);
    assert.equal(await evaluate(`document.querySelector('.activity-links-fields').disabled`),true);
    await click('Reload links'); await until(`!!document.querySelector('[aria-label="Select projects"] input')`);
    assert.equal(await evaluate(`document.querySelectorAll('.activity-batch-list input:checked').length`),0);
    await select('clients','c1'); await select('projects','p0'); await select('tasks','t1');
    await click('Employee access');
    await until(`!!document.querySelector('#employee-client-access .client-access-teams button')`);
    assert.equal(await evaluate(`document.querySelector('#work-links-panel').hidden`),true,'Only the selected section is shown');
    assert.equal(await evaluate(`location.pathname`),'/admin/project-client-links','Employee access stays on the same page');
    await evaluate(`document.querySelector('#employee-client-access .client-access-teams button').click()`);
    await capture('employee-access-tab-desktop.png');
    await click('Clients, projects & tasks');
    assert.equal(await evaluate(`document.querySelector('#employee-client-access').hidden`),true);
    assert.equal(await evaluate(`document.querySelectorAll('.activity-batch-list input:checked').length`),3,'Selections survive tab switches');
    await click('Employee access');
    assert.equal(await evaluate(`document.querySelector('#employee-client-access .client-access-teams button').getAttribute('aria-pressed')`),'true','Access choices survive tab switches');
    await evaluate(`document.querySelector('#employee-access-tab').focus(); document.querySelector('#employee-access-tab').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`);
    assert.equal(await evaluate(`document.activeElement.id`),'work-links-tab');
    assert.equal(await evaluate(`document.querySelector('#employee-client-access').hidden`),true);
    await evaluate(`document.querySelector('.work-setup-tabs').scrollIntoView({block:'start'})`);
    await capture('two-sections-desktop.png');
    await win.loadURL(`${base}/admin/task-links`); await until(`document.querySelectorAll('.activity-batch-picker').length===3`);
    assert.equal(await evaluate(`!!document.querySelector('.crm-nav a[href="/admin/project-client-links"].active')`),true);
    win.setSize(430,900); await win.loadURL(`${base}/admin/project-client-links`);
    await until(`document.querySelectorAll('.activity-batch-picker').length===3 && document.querySelector('.crm-nav').getBoundingClientRect().right < 1`);
    await delay(300);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`),true);
    await capture('all-selections-mobile.png');
    await click('Employee access');
    await until(`!!document.querySelector('#employee-client-access .client-access-teams button')`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`),true);
    await capture('employee-access-tab-mobile.png');
    console.log('PASS: clients/projects/tasks together; select in any order; multiple projects; inline review; changes invalidate review; hidden selections; save retry; unlink; client-only mode; versions; conflict reload; same-page employee access; old URLs; mobile. Local fixtures only.');
  } catch(error) { console.error(error); process.exitCode=1; }
  finally { win?.destroy(); server.closeAllConnections(); server.close(); app.exit(process.exitCode || 0); }
});
