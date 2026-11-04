const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard/dist');
const user = { _id: 'admin', role: 'admin', fullName: 'Admin' };
const data = { projects: ['Review', 'Preparation'].map((name, i) => ({ _id: `p${i}`, projectName: name, projectCode: `P${i}`, teams: ['tax'], activityLinksVersion: 0, clients: [] })),
  clients: [{ _id: 'c1', clientName: 'WCPA' }, { _id: 'c2', clientName: 'Renau CPA' }],
  tasks: [{ _id: 't1', taskName: 'Tax Review', taskCode: 'T1', teams: ['tax'] }, { _id: 't2', taskName: 'Tax Preparation', taskCode: 'T2', teams: ['tax'] }, { _id: 'foreign', taskName: 'Other team task', taskCode: 'T3', teams: ['other'] }], mappings: [] };
let writes = [], history = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); return;
  }
  let body = {};
  if (url.pathname === '/api/auth/me') body = { user };
  if (url.pathname === '/api/permissions/me') body = { permissions: [] };
  if (url.pathname === '/api/projects/activity-links') body = data;
  if (url.pathname === '/api/projects/activity-links/history') body = { history: history.filter(row => row.mode === url.searchParams.get('mode')), totalPages: 1 };
  if (url.pathname === '/api/projects/activity-links/batch') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); writes.push(input);
    input.projects.forEach(row => { const project = data.projects.find(project => project._id === row.project); assert.equal(project.activityLinksVersion, row.version); project.activityLinksVersion++; });
    const entry = { _id: `history-${writes.length}`, mode: input.mode || 'tasks', action: input.action, actorName: 'Admin', createdAt: new Date().toISOString(),
      projects: input.projects.map(row => ({ id: row.project, name: data.projects.find(project => project._id === row.project).projectName })),
      clients: input.clientIds.map(id => ({ id, name: data.clients.find(client => client._id === id).clientName })),
      tasks: input.taskIds.map(id => ({ id, name: data.tasks.find(task => task._id === id).taskName })),
      combinationCount: input.projects.length * input.clientIds.length * (input.mode === 'clients' ? 1 : input.taskIds.length) };
    history.unshift(entry);
    body = { success: true, message: 'Saved selected combinations.', history: entry };
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
});
let win;
const evaluate = code => win.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) { for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await delay(100); } throw new Error(`Timed out: ${code}`); }
const click = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
const fill = (selector, value) => evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { partition: `batch-links-${Date.now()}`, backgroundThrottling: false } });
    await win.loadURL(`${base}/login`); await evaluate(`localStorage.setItem('app-theme','upsilon');localStorage.setItem('token','mock');localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});`);
    await win.loadURL(`${base}/admin/task-links`); await until(`!!document.querySelector('[aria-label="Select projects"] input')`);
    assert.equal(await evaluate(`!!document.querySelector('.activity-links-page [aria-label="Select tasks"]')`), true);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Link type"]')`), false);
    assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), false);
    assert.equal(await evaluate(`!!document.querySelector('.crm-nav details[aria-label="Task linking"] a[href="/admin/task-links"].active')`), true);
    for (const group of ['Task linking', 'Entry management']) {
      const selector = `.crm-nav details[aria-label="${group}"]`;
      const wasOpen = await evaluate(`document.querySelector(${JSON.stringify(selector)}).open`);
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('summary').click()`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).open`), !wasOpen);
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('summary').click()`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).open`), wasOpen);
    }
    const sidebarPreview = path.resolve(__dirname, '../../backend/.local-repairs/task-links-sidebar.png'); fs.mkdirSync(path.dirname(sidebarPreview), { recursive: true });
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`); fs.writeFileSync(sidebarPreview, (await win.webContents.capturePage()).toPNG());
    await until(`!!document.querySelector('[aria-label="Select projects"] input')`);
    assert.equal(await evaluate(`!!document.querySelector('.activity-mode-switch')`), false);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Project settings')`), false);
    for (const group of ['projects', 'clients']) await evaluate(`document.querySelector('[aria-label="Select ${group}"]').closest('section').querySelector('button').click()`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Select tasks"] input[value="foreign"]').disabled`), true);
    await evaluate(`document.querySelector('[aria-label="Select tasks"]').closest('section').querySelector('button').click()`);
    await fill('[aria-label="Search tasks"]', 'Review');
    const taskPagePreview = path.resolve(__dirname, '../../backend/.local-repairs/task-links-ui.png');
    fs.mkdirSync(path.dirname(taskPagePreview), { recursive: true });
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(taskPagePreview, (await win.webContents.capturePage()).toPNG());
    await click('Review links');
    assert.equal(writes.length, 0);
    assert.equal(await evaluate(`document.querySelector('.activity-batch-review').textContent.includes('8 combinations')`), true);
    assert.equal(await evaluate(`document.querySelector('.activity-batch-review').textContent.includes('Tax Preparation')`), true, 'hidden selection survives search');
    const output = path.resolve(__dirname, '../../backend/.local-repairs/batch-activity-links-review.png'); fs.mkdirSync(path.dirname(output), { recursive: true });
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`); fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
    await click('Confirm links'); await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(writes.length, 1); assert.deepEqual(writes[0].taskIds, ['t1', 't2']); assert.equal(writes[0].projects.length, 2); assert.equal(writes[0].clientIds.length, 2);
    assert.equal(await evaluate(`document.querySelectorAll('.activity-batch-list input:checked').length`), 0);
    assert.equal(await evaluate(`[...document.querySelectorAll('.activity-picker-search input')].every(input => input.value === '')`), true);
    await until(`document.querySelectorAll('[aria-label="Link history"] tbody tr').length === 1`);
    for (const group of ['projects', 'clients']) await evaluate(`document.querySelector('[aria-label="Select ${group}"]').closest('section').querySelector('button').click()`);
    await fill('[aria-label="Search tasks"]', '');
    await evaluate(`document.querySelector('[aria-label="Select tasks"]').closest('section').querySelector('button').click()`);
    await click('Review unlink'); await click('Confirm unlink'); await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(writes.length, 2); assert.equal(writes[1].action, 'unlink'); assert.ok(writes[1].projects.every(row => row.version === 1));
    await win.loadURL(`${base}/admin/project-client-links`);
    await until(`!!document.querySelector('[aria-label="Select projects"] input')`);
    for (const group of ['projects', 'clients']) await evaluate(`document.querySelector('[aria-label="Select ${group}"]').closest('section').querySelector('button').click()`);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Select tasks"]')`), false);
    await click('Review links');
    assert.equal(await evaluate(`document.querySelector('.activity-batch-review').textContent.includes('4 combinations')`), true);
    const clientOnlyPreview = path.resolve(__dirname, '../../backend/.local-repairs/client-project-only-links.png');
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(clientOnlyPreview, (await win.webContents.capturePage()).toPNG());
    await click('Confirm links'); await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(writes[2].mode, 'clients'); assert.deepEqual(writes[2].taskIds, []);
    assert.equal(await evaluate(`document.querySelectorAll('.activity-batch-list input:checked').length`), 0);
    for (const group of ['projects', 'clients']) await evaluate(`document.querySelector('[aria-label="Select ${group}"]').closest('section').querySelector('button').click()`);
    await click('Review unlink');
    assert.equal(await evaluate(`document.querySelector('.activity-batch-review').textContent.includes('task mappings on those projects will also be disabled')`), true);
    await click('Confirm unlink'); await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(writes[3].mode, 'clients'); assert.equal(writes[3].action, 'unlink');
    await win.loadURL(`${base}/admin/project-client-links`);
    await until(`!!document.querySelector('.crm-nav a[href="/admin/project-client-links"].active')`);
    await until(`!!document.querySelector('[aria-label="Select projects"] input')`);
    assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), false);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Select tasks"]')`), false);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Link type"]')`), false);
    assert.equal(await evaluate(`!!document.querySelector('.activity-mode-switch')`), false);
    for (const group of ['projects', 'clients']) await evaluate(`document.querySelector('[aria-label="Select ${group}"]').closest('section').querySelector('button').click()`);
    const dedicatedPreview = path.resolve(__dirname, '../../backend/.local-repairs/project-client-links-tab.png');
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(dedicatedPreview, (await win.webContents.capturePage()).toPNG());
    await click('Review links'); await click('Confirm links'); await until(`!!document.querySelector('.activity-links-success') && !document.querySelector('.activity-links-fields').disabled`);
    assert.equal(writes[4].mode, 'clients'); assert.deepEqual(writes[4].taskIds, []);
    for (const [index, name] of ['Audit', 'Bookkeeping', 'FTC', 'No Project', 'Software'].entries()) data.projects.push({ _id: `extra-${index}`, projectName: name, projectCode: `PRJ-DEMO-${index}`, teams: ['tax'], activityLinksVersion: 0 });
    data.clients.push(...['KCPA', 'Unit 1', 'Upsilon'].map((clientName, index) => ({ _id: `extra-client-${index}`, clientName })));
    await win.loadURL(`${base}/admin/project-client-links`);
    await until(`document.querySelectorAll('[aria-label="Select projects"] input').length === 7`);
    await until(`document.querySelectorAll('[aria-label="Link history"] tbody tr').length === 3`);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.resolve(__dirname, '../../backend/.local-repairs/linking-empty-ui.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('[aria-label="Link history"]').scrollIntoView({block:'end'})`);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.resolve(__dirname, '../../backend/.local-repairs/link-history-ui.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(520, 900); await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await evaluate(`(() => { const editor=document.querySelector('.activity-links-page'); return editor.scrollWidth <= editor.clientWidth + 1; })()`), true);
    await evaluate(`document.querySelector('.activity-batch-footer').scrollIntoView({block:'end'})`);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.resolve(__dirname, '../../backend/.local-repairs/linking-mobile-ui.png'), (await win.webContents.capturePage()).toPNG());
    console.log('PASS: bulk linking; team boundaries; review and versions; selections/searches reset after save; history persists after reload; mobile layout. Local fixtures only.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); server.close(); app.exit(process.exitCode || 0); }
});
