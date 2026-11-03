const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard/dist');
const output = path.resolve(__dirname, '../../backend/.local-repairs/admin-overview-review');
const now = Date.now();
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = date.format(now), yesterday = date.format(now - 86400000);
const user = { _id: 'manager', fullName: 'Overview Manager', role: 'manager' };
const employees = [
  { _id: 'a', fullName: 'A Working Employee', employeeId: '1001', role: 'employee', team: 'wcpa', isActive: true },
  { _id: 'b', fullName: 'B Break Employee', employeeId: '1002', role: 'team_lead', team: 'tax', isActive: true },
  { _id: 'c', fullName: 'C No Timer', employeeId: '1003', role: 'employee', team: 'wcpa', isActive: true },
  { _id: 'alpha', fullName: 'Hidden Alpha Account', role: 'alpha', team: null, isActive: true },
];
const teams = [{ _id: 'wcpa', teamName: 'WCPA', isActive: true }, { _id: 'tax', teamName: 'Tax', isActive: true }, { _id: 'software', teamName: 'Software', isActive: true }];
const iso = offset => new Date(now + offset).toISOString();
const closed = { _id: 'closed', employee: employees[0], project: { projectName: 'Audit' }, task: { taskName: 'Preparation', taskType: 'work' }, status: 'stopped', isActiveTimer: false,
  startedAt: iso(-7200000), stoppedAt: iso(-3600000), totalWorkedSeconds: 3600, totalIdleSeconds: 0, pauses: [] };
const current = [closed,
  { ...closed, _id: 'live', status: 'running', isActiveTimer: true, startedAt: iso(-1800000), stoppedAt: null, totalWorkedSeconds: 1800, task: { taskName: 'Review', taskType: 'work' } },
  { ...closed, _id: 'lunch', employee: employees[1], status: 'running', isActiveTimer: true, startedAt: iso(-600000), stoppedAt: null, totalWorkedSeconds: 600, task: { taskName: 'Lunch', taskType: 'break' } },
  { ...closed, _id: 'alpha-log', employee: employees[3], totalWorkedSeconds: 999999 },
];
let failNext = false;
const calls = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); return;
  }
  const endpoint = url.pathname.slice(4); calls.push(endpoint); let body = { success: true };
  if (endpoint === '/auth/me') body = { user };
  if (endpoint === '/auth/login-requests/pending') body = { loginRequest: null };
  if (endpoint === '/permissions/me') body = { permissions: ['view_all_reports'] };
  if (endpoint.startsWith('/employees')) body = { employees, totalPages: 1 };
  if (endpoint === '/teams') body = { teams };
  if (endpoint === '/time-logs/admin') {
    if (failNext) { failNext = false; res.statusCode = 503; body = { message: 'Synthetic outage' }; }
    else body = { timeLogs: url.searchParams.get('startDate') === today ? current : [{ ...closed, _id: 'historical', startedAt: `${yesterday}T04:00:00Z`, stoppedAt: `${yesterday}T06:00:00Z`, totalWorkedSeconds: 7200 }], totalPages: 1 };
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
});
let win;
const evaluate = code => win.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) { for (let n = 0; n < 150; n++) { if (await evaluate(code)) return; await delay(100); } throw new Error(`Timed out: ${code}`); }
const click = text => evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`);
async function input(selector, value) {
  await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)}); node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
app.whenReady().then(async () => {
  let code = 0;
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { partition: `overview-${Date.now()}`, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token','fixture'); localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))})`);
    await win.loadURL(`${base}/admin/dashboard`);
    await until(`document.querySelectorAll('.overview-team-card').length===3 && document.querySelector('.overview-refresh')?.textContent==='Refresh'`);
    assert.equal(await evaluate(`document.querySelectorAll('.report-timeline-row').length`), 0, 'Overview is no longer a detailed timesheet');
    assert.equal(await evaluate(`document.querySelector('.crm-stat-strip article').textContent.includes('1 / 3')`), true);
    assert.equal(await evaluate(`document.body.textContent.includes('Hidden Alpha Account')`), false);
    assert.equal(await evaluate(`document.querySelector('[data-overview-team="wcpa"]').textContent.includes('1h 30m')`), true);
    await evaluate(`document.documentElement.style.scrollBehavior='auto'; window.scrollTo({top:0,behavior:'instant'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(output,'overview-home.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('[data-overview-team="wcpa"]').click()`);
    await until(`document.querySelectorAll('.overview-member-table tbody tr').length===2`);
    assert.equal(await evaluate(`document.querySelector('.overview-member-table').textContent.includes('Review')`), true);
    await input('[aria-label="Search overview members"]', 'C No');
    await until(`document.querySelectorAll('.overview-member-table tbody tr').length===1`);
    assert.equal(await evaluate(`document.querySelector('.overview-member-table').textContent.includes('No active timer')`), true);
    await input('[aria-label="Search overview members"]', '');
    await evaluate(`document.querySelector('[aria-label="Member activity status"]').value='Working'; document.querySelector('[aria-label="Member activity status"]').dispatchEvent(new Event('change',{bubbles:true}))`);
    await until(`document.querySelectorAll('.overview-member-table tbody tr').length===1`);
    assert.equal(await evaluate(`document.querySelector('.overview-member-table').textContent.includes('A Working')`), true);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(output, 'overview-desktop.png'), (await win.webContents.capturePage()).toPNG());
    await input('[aria-label="Search overview teams"]', 'Tax');
    await until(`document.querySelectorAll('.overview-team-card').length===1`);
    await evaluate(`document.querySelector('[data-overview-team="tax"]').click()`);
    await until(`document.querySelector('.overview-member-table')?.textContent.includes('Lunch')`);
    assert.equal(await evaluate(`document.querySelector('.overview-member-table').textContent.includes('On break')`), true);
    await input('[aria-label="Overview from"]', yesterday); await input('[aria-label="Overview to"]', yesterday); await click('Apply dates');
    await until(`document.querySelector('.overview-period-note').textContent.includes(${JSON.stringify(`${yesterday} – ${yesterday}`)}) && document.querySelector('.overview-refresh').textContent==='Refresh'`);
    assert.equal(await evaluate(`document.querySelectorAll('.crm-stat-strip article')[1].textContent.includes('2h 0m')`), true);
    assert.equal(await evaluate(`document.querySelector('.crm-stat-strip article').textContent.includes('1 / 3')`), true, 'Historical totals still show current status from today');
    failNext = true; await click('Refresh');
    await until(`document.querySelector('[role=alert]')?.textContent.includes('last successful update')`);
    assert.equal(await evaluate(`document.querySelectorAll('.crm-stat-strip article')[1].textContent.includes('2h 0m')`), true, 'An outage preserves previous totals instead of showing zero');
    await click('Refresh'); await until(`!document.querySelector('[role=alert]') && document.querySelector('.overview-refresh').textContent==='Refresh'`);
    win.setSize(500, 900); await delay(200);
    await input('[aria-label="Search overview teams"]', '');
    assert.equal(await evaluate(`document.querySelector('.admin-team-overview').scrollWidth <= document.querySelector('.admin-team-overview').clientWidth+2`), true, 'Overview fits mobile width');
    await evaluate(`document.documentElement.style.scrollBehavior='auto'; window.scrollTo({top:0,behavior:'instant'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(output, 'overview-mobile.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors.filter(error => !/Failed to load resource.*503/.test(error)), []);
    assert.ok(calls.includes('/time-logs/admin'));
    console.log('PASS: team hours/status overview, member drill-down, Alpha exclusion, current projects/tasks, team/member search, status filter, independent historical range/current status, refresh-outage recovery and mobile layout. Local fixture API only.');
  } catch (error) {
    code = 1; console.error(error);
    if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  } finally { win?.destroy(); server.close(); app.exit(code); }
});
