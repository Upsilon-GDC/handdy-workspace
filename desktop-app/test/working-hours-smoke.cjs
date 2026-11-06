// Real dashboard in Electron, isolated mock API; no production requests.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { buildWorkingHoursOverview, policyOnDate } = require('../../backend/src/services/workingHours');
const { getDateKeyInTimezone, dateKeyToUtc, addDateKeyDays } = require('../../backend/src/utils/billingUtils');
const root = path.resolve(__dirname, '../../dashboard/dist');
const output = path.resolve(__dirname, '../../backend/.local-repairs/working-hours-review');
const today = getDateKeyInTimezone(new Date()), yesterday = addDateKeyDays(today, -1);
let user = { _id: 'admin', fullName: 'Working Hours Admin', role: 'admin' };
const people = [
  { _id: 'a', fullName: 'Asha Rao', employeeId: 'EMP001', team: { _id: 'wcpa', teamName: 'WCPA' }, role: 'employee', isActive: true, version: 0, history: [], adjustment: null },
  { _id: 'b', fullName: 'Deepak Kumar', employeeId: 'EMP002', team: { _id: 'wcpa', teamName: 'WCPA' }, role: 'employee', isActive: true, version: 0, history: [], adjustment: null },
  { _id: 'c', fullName: 'Nisha Varma', employeeId: 'EMP003', team: { _id: 'renau', teamName: 'Renau CPA' }, role: 'employee', isActive: true, version: 0, history: [], adjustment: null },
];
const writes = [], settingsReads = [];
let failSave = false, failReport = false;
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); return;
    }
    const endpoint = url.pathname.slice(4); let body = { success: true };
    const date = url.searchParams.get('date') || today;
    if (endpoint === '/auth/me') body = { user };
    else if (endpoint === '/permissions/me') body = { permissions: ['view_all_reports'] };
    else if (endpoint === '/auth/login-requests/pending') body = { loginRequest: null };
    else if (endpoint.startsWith('/employees')) body = { employees: people, totalPages: 1 };
    else if (endpoint === '/teams') body = { teams: [...new Map(people.map(row => [row.team._id, row.team])).values()] };
    else if (endpoint === '/time-logs/admin') body = { timeLogs: [], totalPages: 1 };
    else if (endpoint === '/working-hours/settings' && req.method === 'GET') {
      settingsReads.push(date); body = { employees: people.map(row => ({ ...row, policy: policyOnDate({ revisions: row.history }, date) })) };
    } else if (endpoint === '/working-hours/settings' || endpoint === '/working-hours/adjustments') {
      if (failSave) { failSave = false; res.statusCode = 409; body = { message: 'Working hours changed in another window. Reload before saving.' }; }
      else {
        const input = JSON.parse(raw); writes.push(input);
        for (const employee of people.filter(row => input.employeeIds.includes(row._id))) {
          if (endpoint.endsWith('/adjustments')) employee.adjustment = { type: input.type, reason: input.reason };
          else { employee.version += 1; employee.history.push({ effectiveFrom: input.effectiveFrom, requiredSeconds: Math.round(Number(input.requiredHours) * 3600), halfDayPercent: input.halfDayPercent, changedAt: new Date().toISOString() }); }
        }
        body = { message: endpoint.endsWith('/adjustments') ? 'Daily exceptions saved.' : 'Working hours saved.' };
      }
    } else if (endpoint === '/working-hours/overview') {
      if (failReport) { res.statusCode = 503; body = { message: 'Synthetic productivity outage' }; }
      else {
        const start = dateKeyToUtc(date), end = dateKeyToUtc(addDateKeyDays(date, 1));
        body = buildWorkingHoursOverview({ date, start, end, now: +end,
          employees: people, policies: people.map(row => ({ employee: row._id, revisions: row.history })),
          attendance: people.map(row => ({ employee: row._id, status: 'Present', workingHoursAdjustments: row.adjustment ? [row.adjustment] : [] })),
          logs: people.map((row, index) => ({ employee: row._id, task: { taskType: 'work' }, startedAt: start, stoppedAt: new Date(+start + [6, 9, 2][index] * 3600000), status: 'stopped', pauses: [] })) });
      }
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
  });
});
let win;
const evaluate = source => win.webContents.executeJavaScript(source);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(source) { for (let n = 0; n < 150; n++) { if (await evaluate(source)) return; await delay(100); } throw new Error(`Timed out: ${source}`); }
const click = label => evaluate(`[...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(label)}).click()`);
async function fill(selector, value) {
  await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)}); node.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
const select = (selector, value) => evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); node.value=${JSON.stringify(value)}; node.dispatchEvent(new Event('change',{bubbles:true})); })()`);
const screenshot = async name => { await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`); fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG()); };
app.whenReady().then(async () => {
  let code = 0;
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1500, height: 1050, webPreferences: { partition: `working-hours-${Date.now()}`, backgroundThrottling: false } });
    const errors = []; win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    async function visit(route) {
      await win.loadURL(`${base}/login`);
      await evaluate(`localStorage.setItem('token','fixture');localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});localStorage.setItem('theme','green')`);
      await win.loadURL(`${base}${route}`);
    }
    await visit('/admin/working-hours');
    await until(`document.querySelectorAll('[data-working-hours-team]').length === 2`);
    assert.equal(await evaluate(`document.querySelectorAll('.wh-team-group tbody tr').length`), 0, 'Employees appear only after choosing a team');
    assert.equal(await evaluate(`!!document.querySelector('.wh-action-panel')`), false);
    await screenshot('settings-team-cards.png');
    await evaluate(`document.querySelector('[data-working-hours-team="wcpa"]').click()`);
    await until(`document.querySelectorAll('.wh-team-group tbody tr').length === 2`);
    assert.equal(await evaluate(`document.querySelector('.wh-action-panel').compareDocumentPosition(document.querySelector('.wh-roster')) & Node.DOCUMENT_POSITION_FOLLOWING`), 4, 'Editing controls appear before the employee list');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.wh-action-panel')).position`), 'sticky');
    assert.equal(await evaluate(`(() => { const rect=document.querySelector('[aria-label="Assign working hours"] button').getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; })()`), true, 'Save is visible on page load');
    assert.equal(await evaluate(`document.querySelectorAll('.wh-team-group').length`), 1);
    await fill('[aria-label="Search working hours employees"]', 'Asha');
    await until(`document.querySelectorAll('.wh-team-group tbody tr').length === 1`);
    await click('Whole team (2)');
    assert.equal(await evaluate(`document.querySelector('.wh-selected-count').textContent`), '2 employees selected', 'Whole team includes employees hidden by search');
    await fill('[aria-label="Search working hours employees"]', '');
    await fill('[aria-label="Required daily hours"]', '7.8'); await fill('[aria-label="Half-day requirement percent"]', '60');
    assert.equal(await evaluate(`document.querySelector('.wh-settings-forms').textContent.includes('7h 48m')`), true);
    await click('Save working hours'); await until(`!!document.querySelector('.wh-success') && !document.querySelector('.wh-settings-forms fieldset').disabled`);
    assert.deepEqual(writes[0].employeeIds, ['a', 'b']); assert.equal(writes[0].requiredHours, '7.8');
    assert.equal(await evaluate(`document.querySelectorAll('.wh-roster input:checked').length`), 0);
    await win.reload(); await until(`!!document.querySelector('[data-working-hours-team="wcpa"]')`);
    await evaluate(`document.querySelector('[data-working-hours-team="wcpa"]').click()`);
    await until(`document.querySelector('.wh-roster')?.textContent.includes('7h 48m')`);
    await screenshot('settings-desktop.png');
    await evaluate(`document.querySelector('[aria-label="Select Asha Rao"]').closest('tr').querySelector('.wh-text-button').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('.wh-roster input:checked').length`), 1, 'An individual can be edited independently');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Required daily hours"]').value`), '7.8');
    failSave = true; await fill('[aria-label="Required daily hours"]', '8'); await click('Save working hours');
    await until(`document.querySelector('[role="alert"]')?.textContent.includes('another window')`);
    assert.equal(await evaluate(`document.querySelectorAll('.wh-roster input:checked').length`), 1);
    await click('Save working hours'); await until(`!!document.querySelector('.wh-success') && !document.querySelector('.wh-settings-forms fieldset').disabled`);
    assert.deepEqual(writes.at(-1).employeeIds, ['a'], 'Individual save leaves other team members untouched');
    await evaluate(`document.querySelector('[aria-label="Select Asha Rao"]').click()`);
    await click('Daily exception');
    await fill('[aria-label="Working hours exception reason"]', 'Approved half-day attendance');
    await click('Save daily exception'); await until(`document.querySelector('.wh-success')?.textContent.includes('Daily exceptions') && !document.querySelector('.wh-settings-forms fieldset').disabled`);
    assert.equal(writes.at(-1).type, 'half_day');
    await click('Whole team (2)');
    await click('Change team'); await until(`!!document.querySelector('[data-working-hours-team="renau"]')`);
    await evaluate(`document.querySelector('[data-working-hours-team="renau"]').click()`);
    await until(`document.querySelectorAll('.wh-team-group tbody tr').length === 1`);
    assert.equal(await evaluate(`document.querySelector('.wh-roster').textContent.includes('Nisha Varma')`), true);
    assert.equal(await evaluate(`document.querySelector('.wh-selected-count').textContent`), '0 employees selected', 'Changing teams clears previous targets');
    await click('Whole team (1)'); await click('Choose employees');
    assert.equal(await evaluate(`document.querySelectorAll('.wh-roster input:checked').length`), 0);
    await click('Change team'); await evaluate(`document.querySelector('[data-working-hours-team="wcpa"]').click()`);
    const rosterSize = people.length;
    for (let index = 0; index < 30; index++) people.push({ ...people[1], _id: `extra-${index}`, fullName: `More Employee ${index}`, employeeId: `EX${index}` });
    await click('Refresh'); await until(`document.querySelectorAll('.wh-team-group tbody tr').length === 32`);
    await click('Working hours');
    win.setSize(1440, 800); await delay(150);
    await evaluate(`document.documentElement.style.scrollBehavior='auto'; window.scrollTo({top:0,behavior:'instant'}); document.querySelector('.wh-roster-list').scrollTop=10000`);
    assert.equal(await evaluate(`document.querySelector('.wh-roster-list').scrollHeight > document.querySelector('.wh-roster-list').clientHeight`), true, 'Long employee lists scroll inside the roster');
    await evaluate(`document.querySelector('[aria-label="Select More Employee 29"]').closest('tr').querySelector('.wh-text-button').click()`);
    await delay(50);
    assert.equal(await evaluate(`window.scrollY`), 0, 'Editing an employee does not jump to the bottom of the page');
    assert.equal(await evaluate(`(() => { const rect=document.querySelector('[aria-label="Assign working hours"] button').getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; })()`), true, 'Save stays visible while editing the last employee');
    await screenshot('settings-long-roster.png');
    people.splice(rosterSize); await click('Refresh'); await until(`document.querySelectorAll('.wh-team-group tbody tr').length === 2`);
    win.setSize(520, 950); await delay(150);
    assert.equal(await evaluate(`document.querySelector('.working-hours-settings').scrollWidth <= document.querySelector('.working-hours-settings').clientWidth + 2`), true);
    await screenshot('settings-mobile.png'); win.setSize(1500, 1050);
    await visit('/admin/dashboard'); await until(`document.querySelectorAll('[data-productivity-team]').length === 2`);
    assert.equal(await evaluate(`document.querySelector('.wh-warning').textContent.includes('1 present employee has')`), true);
    await evaluate(`document.querySelector('[data-productivity-team="wcpa"]').click()`);
    await until(`document.querySelectorAll('.wh-details tbody tr').length === 2`);
    assert.equal(await evaluate(`['block', 'grid'].includes(getComputedStyle(document.querySelector('[data-productivity-team]')).display)`), true, 'Team card content stacks vertically');
    assert.equal(await evaluate(`document.querySelectorAll('.overview-team-card').length`), 2, 'Each team has one combined card');
    assert.equal(await evaluate(`document.querySelector('.wh-details').textContent.includes('Half day')`), true);
    assert.equal(await evaluate(`document.querySelector('.wh-details').textContent.includes('Completed')`), true);
    await delay(150);
    await evaluate(`document.documentElement.style.scrollBehavior='auto'; document.querySelector('.wh-overview').scrollIntoView({block:'start',behavior:'instant'})`); await screenshot('productivity-desktop.png');
    await select('[aria-label="Productivity team"]', 'renau'); await until(`document.querySelectorAll('.wh-details tbody tr').length === 1`);
    assert.equal(await evaluate(`document.querySelector('.wh-details').textContent.includes('Not configured')`), true);
    await select('[aria-label="Productivity team"]', '');
    failReport = true; await click('Refresh hours'); await until(`document.querySelector('.wh-overview [role="alert"]')?.textContent.includes('last successful update')`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-productivity-team]').length`), 2);
    failReport = false; await fill('[aria-label="Productivity date"]', yesterday);
    await until(`document.querySelector('.wh-overview .crm-stat-strip')?.textContent.includes(${JSON.stringify(yesterday)})`);
    win.setSize(520, 950); await delay(150);
    assert.equal(await evaluate(`document.querySelector('.wh-overview').scrollWidth <= document.querySelector('.wh-overview').clientWidth + 2`), true);
    await evaluate(`document.querySelector('.wh-overview').scrollIntoView({block:'start'})`); await screenshot('productivity-mobile.png');
    user = { _id: 'manager', fullName: 'Authorized Manager', role: 'manager' };
    const before = settingsReads.length;
    await visit('/admin/working-hours'); await until(`document.body.textContent.includes('Admin access required')`);
    assert.equal(settingsReads.length, before, 'Manager route must not read configuration');
    assert.equal(await evaluate(`!!document.querySelector('.crm-nav a[href="/admin/working-hours"]')`), false);
    await visit('/admin/dashboard'); await until(`document.querySelectorAll('[data-productivity-team]').length === 2`);
    assert.equal(await evaluate(`!!document.querySelector('.wh-overview a[href="/admin/working-hours"]')`), false);
    assert.deepEqual(errors.filter(message => !/Failed to load resource.*(409|503)/.test(message)), []);
    console.log('PASS: grouped Admin settings, decimal/bulk/individual saves, persistence, failed-save selection, daily exception, productivity drilldown, date/team filters, outage state, mobile layout and Manager read-only access. Mock API only.');
  } catch (error) { console.error(error); code = 1; }
  finally { win?.destroy(); server.close(); app.exit(code); }
});
