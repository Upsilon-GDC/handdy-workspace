// Real React page + isolated fixture API. Real DB transaction tests live in backend/integration.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const dashboard = path.resolve(__dirname, '../../dashboard/dist');
const output = path.resolve(__dirname, '../../backend/.local-repairs/entry-edit-review');
let actor = { _id: 'manager', fullName: 'Synthetic Manager', role: 'manager' };
const employee = { _id: 'employee', fullName: 'Synthetic Employee', employeeId: 'IT-01', role: 'employee', team: 'team', isActive: true };
const peer = { ...employee, _id: 'other-employee', fullName: 'Other Team Employee', team: { _id: 'other-team' } };
const clients = [{ _id: 'c1', clientName: 'WCPA' }, { _id: 'c2', clientName: 'UPSILON' }];
const projects = [{ _id: 'p1', projectName: 'Audit', clientIds: ['c1'], mappingEnabled: true }, { _id: 'p2', projectName: 'Tax Review', clientIds: ['c2'], mappingEnabled: true }];
const tasks = [{ _id: 't1', taskName: 'Preparation', taskType: 'work', project: 'p1', clientIds: ['c1'] }, { _id: 't2', taskName: 'Review', taskType: 'work', project: 'p2', clientIds: ['c2'] }];
let record = { _id: 'log', employee, project: projects[0], client: clients[0], task: tasks[0], startedAt: '2026-01-01T09:00:00.000Z', stoppedAt: '2026-01-01T10:00:00.000Z',
  pauses: [{ reason: 'idle', pausedAt: '2026-01-01T09:30:00.000Z', resumedAt: '2026-01-01T09:40:00.000Z' }],
  totalWorkedSeconds: 3000, totalPausedSeconds: 600, totalIdleSeconds: 600, note: 'Original note', status: 'stopped', isActiveTimer: false, editVersion: 0, updatedAt: '2026-01-01T10:00:01.000Z' };
const other = { ...record, _id: 'next', startedAt: '2026-01-01T10:10:00.000Z', stoppedAt: null, status: 'running', isActiveTimer: true, pauses: [] };
let patchCalls = 0, rejectNext = true, history = [], lastBody;
let reportRequests = 0, lastReportSearch;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const file = url.pathname.startsWith('/assets/') ? path.join(dashboard, 'assets', path.basename(url.pathname)) : path.join(dashboard, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); return;
  }
  let input = '';
  req.on('data', data => { input += data; });
  req.on('end', () => {
    const endpoint = url.pathname.slice(4); let body = { success: true };
    if (endpoint === '/auth/me') body = { user: actor };
    if (endpoint === '/auth/login-requests/pending') body = { loginRequest: null };
    if (endpoint === '/permissions/me') body = { permissions: ['view_all_reports', 'export_reports', 'add_manual_entries'] };
    if (endpoint === '/teams') body = { teams: [{ _id: 'team', teamName: 'WCPA', isActive: true }, { _id: 'other-team', teamName: 'Other Team', isActive: true }] };
    if (endpoint.startsWith('/employees')) body = { employees: [employee, peer], totalPages: 1 };
    if (endpoint === '/projects') body = { projects, totalPages: 1 };
    if (endpoint === '/tasks') body = { tasks, totalPages: 1 };
    if (endpoint === '/time-logs/admin') { reportRequests++; lastReportSearch=Object.fromEntries(url.searchParams); body = { timeLogs: [record, other, { ...record, _id: 'peer-log', employee: peer, note: 'Other team should not appear' }], totalPages: 1 }; }
    if (endpoint === '/time-logs/entries/log/edit') body = { success: true, record: { ...record, employee: employee._id, project: record.project._id, client: record.client?._id || null }, employee, options: { projects, clients, tasks }, history };
    if (endpoint === '/time-logs/entries/log' && req.method === 'PATCH') {
      patchCalls++; lastBody = JSON.parse(input);
      if (rejectNext) { rejectNext = false; res.statusCode = 500; body = { message: 'Simulated save failure. No correction was saved.' }; }
      else {
        record = { ...record, project: projects.find(p => p._id === lastBody.project), client: clients.find(c => c._id === lastBody.client), task: tasks.find(t => t._id === lastBody.task),
          startedAt: lastBody.segments[0].start, stoppedAt: lastBody.segments.at(-1).end,
          pauses: lastBody.segments.filter(s => s.type !== 'work').map(s => ({ reason: s.type, pausedAt: s.start, resumedAt: s.end })),
          note: lastBody.note, editVersion: record.editVersion + 1, updatedAt: '2026-01-02T00:00:00.000Z' };
        record.totalPausedSeconds = record.pauses.reduce((sum, pause) => sum + (new Date(pause.resumedAt) - new Date(pause.pausedAt)) / 1000, 0);
        record.totalIdleSeconds = record.pauses.filter(p => p.reason === 'idle').reduce((sum, pause) => sum + (new Date(pause.resumedAt) - new Date(pause.pausedAt)) / 1000, 0);
        record.totalWorkedSeconds = (new Date(record.stoppedAt) - new Date(record.startedAt)) / 1000 - record.totalPausedSeconds;
        history = [{ _id: `edit-${record.editVersion}`, revision: record.editVersion, editedBy: actor, reason: lastBody.reason, createdAt: '2026-01-02T00:00:00Z' }, ...history];
        body = { success: true, revision: 1 };
      }
    }
    res.setHeader('Content-Type', 'application/json');
    if (endpoint === '/time-logs/admin' && url.searchParams.get('employee') === 'other-employee') {
      setTimeout(() => res.end(JSON.stringify(body)), 250); return;
    }
    res.end(JSON.stringify(body));
  });
});
let win;
const evaluate = code => win.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) {
  for (let n = 0; n < 150; n++) { if (await evaluate(code)) return; await delay(100); }
  throw new Error(`Timed out: ${code}`);
}
const click = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim()===${JSON.stringify(text)}).click()`);
async function input(selector, value) {
  await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${JSON.stringify(value)}); node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
async function choose(index, label) {
  await evaluate(`document.querySelectorAll('[role=combobox]')[${index}].dispatchEvent(new FocusEvent('focusin',{bubbles:true}))`);
  await until(`[...document.querySelectorAll('.searchable-select')[${index}].querySelectorAll('[role=option]')].some(option => option.textContent.includes(${JSON.stringify(label)}))`);
  await evaluate(`[...document.querySelectorAll('.searchable-select')[${index}].querySelectorAll('[role=option]')].find(option => option.textContent.includes(${JSON.stringify(label)})).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
}
app.whenReady().then(async () => {
  let code = 0;
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { partition: `entry-edit-${Date.now()}`, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token','fixture'); localStorage.setItem('user',${JSON.stringify(JSON.stringify(actor))})`);
    await win.loadURL(`${base}/admin/timesheets/detailed`);
    await until(`!!document.querySelector('.crm-nav a[href="/admin/time-entry-edits"]')`);
    await evaluate(`document.querySelectorAll('.crm-nav details').forEach(group=>group.open=false)`);
    assert.equal(await evaluate(`document.querySelector('.crm-nav a[href="/admin/time-entry-edits"]').closest('details').getAttribute('aria-label')`), 'Entry management');
    await evaluate(`document.querySelector('.crm-nav details[aria-label="Entry management"] summary').click()`);
    assert.equal(await evaluate(`document.querySelector('.crm-nav details[aria-label="Entry management"]').open`), true, 'Entry management expands through its heading');
    fs.writeFileSync(path.join(output, 'edit-entries-sidebar.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('.crm-nav a[href="/admin/time-entry-edits"]').click()`);
    await until(`location.pathname==='/admin/time-entry-edits' && document.querySelector('.admin-report-filter h2')?.textContent==='Edit Entries'`);
    await until(`document.querySelectorAll('.entry-team-card').length===2`);
    const requestsBeforeSelection = reportRequests;
    assert.equal(await evaluate(`document.querySelectorAll('.entry-member-card').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('.report-timeline-row').length`), 0, 'No company-wide entries before team/employee selection');
    await evaluate(`document.querySelector('[data-team-id="other-team"]').click()`);
    await until(`!!document.querySelector('[data-employee-id="other-employee"]')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-employee-id="employee"]')`), false);
    await evaluate(`document.querySelector('[data-employee-id="other-employee"]').click()`);
    for (let n=0; n<100 && reportRequests===requestsBeforeSelection; n++) await delay(10);
    assert.equal(reportRequests, requestsBeforeSelection+1, 'Clicking a member automatically requests their entries');
    await until(`!!document.querySelector('.admin-report-controls input[type=date][min]')`);
    await input('.admin-report-controls input[type=date]', '2026-01-01');
    await input('.admin-report-controls input[type=date][min]', '2026-01-03');
    await evaluate(`document.querySelector('[data-team-id="team"]').click()`);
    await until(`!!document.querySelector('[data-employee-id="employee"]')`);
    assert.equal(await evaluate(`document.querySelectorAll('.entry-member-card[aria-pressed="true"]').length`), 0, 'Team change clears prior employee');
    await input('[aria-label="Search team members"]', 'no matching member');
    await until(`document.querySelectorAll('.entry-member-card').length===0`);
    assert.equal(await evaluate(`document.querySelector('.entry-team-members').textContent.includes('No members match')`), true);
    await input('[aria-label="Search team members"]', '');
    await until(`!!document.querySelector('[data-employee-id="employee"]')`);
    assert.equal(reportRequests, requestsBeforeSelection+1, 'Switching teams alone does not fetch company-wide entries');
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(output,'team-employee-edit.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('[data-employee-id="employee"]').click()`);
    await until(`document.querySelectorAll('.report-edit-entry-button').length >= 4`);
    await delay(300);
    assert.equal(lastReportSearch.employee, 'employee'); assert.equal(lastReportSearch.team, 'team');
    assert.equal(lastReportSearch.startDate, '2026-01-01'); assert.equal(lastReportSearch.endDate, '2026-01-03');
    assert.equal(await evaluate(`document.querySelector('.admin-report-results').textContent.includes('Other team should not appear')`), false, 'Table is restricted to selected employee even if API fixture returns extras');
    await evaluate(`document.querySelector('[data-team-id="team"]').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('.report-edit-entry-button').length>=4`), true, 'Clicking the selected team retains the current employee/results');
    assert.equal(await evaluate(`[...document.querySelectorAll('.report-edit-entry-button')].some(button=>button.disabled)`), true, 'Active entry cannot be edited');
    await click('Edit entry');
    await until(`document.querySelectorAll('.edit-entry-segments fieldset').length===1`);
    await choose(0, 'Tax Review');
    assert.equal(await evaluate(`document.querySelectorAll('[role=combobox]')[1].value`), 'UPSILON');
    await choose(2, 'Review');
    await input('[aria-label="Segment 1 finished"]', '2026-01-01T15:01:00.000');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Segment 2 started"]')`), null, 'Unselected segments are not shown');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Segment 3 finished"]')`), null);
    await input('[aria-label="Entry note"]', 'Corrected project and time');
    await input('[aria-label="Reason for correction"]', 'Correct project and missed finish time');
    assert.equal(await evaluate(`document.querySelector('.edit-entry-modal').scrollWidth <= document.querySelector('.edit-entry-modal').clientWidth+2`), true, 'Desktop editor has no horizontal overflow');
    fs.writeFileSync(path.join(output, 'editor-desktop.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(500, 900); await delay(150);
    assert.equal(await evaluate(`document.querySelector('.edit-entry-segments fieldset').scrollWidth <= document.querySelector('.edit-entry-segments fieldset').clientWidth+2`), true);
    assert.equal(await evaluate(`document.querySelector('.edit-entry-modal').scrollWidth <= document.querySelector('.edit-entry-modal').clientWidth+2`), true, 'Mobile editor has no horizontal overflow');
    fs.writeFileSync(path.join(output, 'editor-mobile.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(1440, 1100);
    await click('Review correction'); await until(`document.body.textContent.includes('Confirm and save correction')`);
    assert.equal(patchCalls, 0, 'Review never writes');
    await click('Confirm and save correction'); await until(`document.querySelector('[role=alert]')?.textContent.includes('server could not complete')`);
    assert.equal(record.note, 'Original note');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Reason for correction"]').value`), 'Correct project and missed finish time');
    await click('Review correction'); await click('Confirm and save correction');
    await until(`!document.querySelector('[role=dialog]') && document.querySelector('.admin-report-table-wrap').textContent.includes('Corrected project and time')`);
    assert.equal(lastBody.project, 'p2'); assert.equal(lastBody.client, 'c2'); assert.equal(lastBody.task, 't2');
    assert.equal(lastBody.expectedVersion, 0); assert.equal(patchCalls, 2);
    assert.equal(lastBody.segments.length, 3, 'Other segments remain in the saved entry');
    assert.equal(lastBody.segments[1].start, '2026-01-01T09:31:00.000Z', 'Only the shared adjoining boundary follows the selected end');
    assert.equal(lastBody.segments[1].end, '2026-01-01T09:40:00.000Z');
    assert.equal(lastBody.segments[2].start, '2026-01-01T09:40:00.000Z');
    assert.equal(lastBody.segments[2].end, '2026-01-01T10:00:00.000Z', 'Non-adjacent segment remains unchanged');
    await click('Edit gap'); await until(`!!document.querySelector('[aria-label="Gap started"]')`);
    assert.equal(await evaluate(`document.querySelectorAll('.edit-entry-segments fieldset').length`), 1);
    assert.equal(await evaluate(`document.querySelectorAll('[role=dialog] [role=combobox]').length`), 0, 'Gap does not expose whole-entry activity controls');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Gap finished"]').readOnly`), true);
    assert.equal(await evaluate(`document.querySelector('.edit-entry-history').textContent.includes('Correct project and missed finish time')`), true);
    await input('[aria-label="Gap started"]', '2026-01-01T15:31:00.000');
    await input('[aria-label="Reason for correction"]', 'Correct selected between-task gap');
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(output,'selected-gap.png'),(await win.webContents.capturePage()).toPNG());
    await click('Review correction'); await click('Confirm and save correction');
    await until(`!document.querySelector('[role=dialog]')`);
    assert.equal(patchCalls, 3); assert.equal(lastBody.expectedVersion, 1);
    assert.equal(lastBody.segments[2].end, '2026-01-01T10:01:00.000Z');
    assert.equal(lastBody.segments[0].end, '2026-01-01T09:31:00.000Z');
    assert.equal(lastBody.note, 'Corrected project and time', 'Gap preserves existing note and activity');
    await until(`[...document.querySelectorAll('.report-idle-row')].some(row=>row.textContent.includes('Idle 1'))`);
    await evaluate(`[...document.querySelectorAll('.report-idle-row')].find(row=>row.textContent.includes('Idle 1')).querySelector('button').click()`);
    await until(`!!document.querySelector('[aria-label="Segment 2 started"]')`);
    assert.equal(await evaluate(`document.querySelectorAll('.edit-entry-segments fieldset').length`), 1, 'Clicking Idle opens only that pause');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Segment 1 started"]')`), null);
    await evaluate(`document.querySelector('[role=dialog] [aria-label=Close]').click()`);
    actor = { ...actor, role: 'hr' };
    await evaluate(`localStorage.setItem('user',${JSON.stringify(JSON.stringify(actor))})`);
    await win.loadURL(`${base}/admin/timesheets/detailed`);
    await until(`!!document.querySelector('.admin-report-controls button')`); await click('Generate');
    await until(`document.querySelectorAll('.report-timeline-row').length>0`);
    assert.equal(await evaluate(`document.querySelectorAll('.report-edit-entry-button').length`), 0, 'HR has no edit action');
    assert.equal(await evaluate(`document.querySelector('.crm-nav a[href="/admin/time-entry-edits"]')`), null, 'HR has no Edit Entries tab');
    actor = { ...actor, role: 'manager' }; record = { ...record, client: null };
    await evaluate(`localStorage.setItem('user',${JSON.stringify(JSON.stringify(actor))})`);
    await win.loadURL(`${base}/admin/timesheets/detailed`);
    await until(`!!document.querySelector('.admin-report-controls button')`); await click('Generate');
    await until(`!!document.querySelector('.report-edit-entry-button')`); await click('Edit entry');
    await until(`document.querySelectorAll('[role=combobox]')[2]?.value==='Review'`);
    assert.equal(await evaluate(`document.querySelectorAll('[role=combobox]')[1].value`), '', 'Original missing client is not guessed');
    await input('[aria-label="Reason for correction"]', 'Preserve historical attribution');
    await click('Review correction'); await until(`document.body.textContent.includes('Confirm and save correction')`);
    assert.equal(patchCalls, 3, 'Historical review still requires explicit confirmation');
    assert.deepEqual(errors.filter(error => !/Failed to load resource.*500/.test(error)), []);
    console.log('PASS: manager edit action, project/client/task correction, connected segment boundaries, review-before-save, failed-save recovery, refreshed report, gap explanation, audit history, active-entry protection, HR exclusion and responsive layout. Mock API only.');
  } catch (error) {
    code = 1; console.error(error);
    if (win && !win.isDestroyed()) console.error(await evaluate(`(() => { const root=document.querySelector('.edit-entry-modal'); if(!root)return document.body.textContent.slice(-500); const bounds=root.getBoundingClientRect(); return {width:root.clientWidth,scroll:root.scrollWidth,overflow:[...root.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().right>bounds.right+1).map(node=>({tag:node.tagName,cls:node.className,right:node.getBoundingClientRect().right-bounds.right})).slice(0,12)}; })()`));
    if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  } finally { win?.destroy(); server.close(); app.exit(code); }
});
