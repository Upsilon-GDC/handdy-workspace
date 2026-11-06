// Real built dashboard, disposable browser profile and loopback fixtures only.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard/dist');
const output = path.resolve(__dirname, '../../tmp/client-access-review');
const user = { _id: 'admin', role: 'admin', fullName: 'Synthetic Admin' };
const data = { teams: [{ _id: 'software', teamName: 'Software' }, { _id: 'wcpa', teamName: 'WCPA' }],
  employees: [{ _id: 'one', fullName: 'First Software Employee', employeeId: 'E1', team: 'software' }, { _id: 'two', fullName: 'Second Software Employee', employeeId: 'E2', team: 'software' }, { _id: 'three', fullName: 'Other Team Employee', employeeId: 'E3', team: 'wcpa' }],
  projects: [{ _id: 'audit', projectName: 'Audit', projectCode: 'AUDIT' }, { _id: 'books', projectName: 'Bookkeeping', projectCode: 'BOOKS' }, { _id: 'other-project', projectName: 'Another project' }],
  clients: [{ _id: 'upsilon', clientName: 'Upsilon' }, { _id: 'wcpa', clientName: 'WCPA' }], policies: [] };
const writes = [], history = []; let fail = false;
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      const file = url.pathname.startsWith('/assets/') ? path.join(root, 'assets', path.basename(url.pathname)) : path.join(root, 'index.html');
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); return;
    }
    let body = { success: true };
    if (url.pathname === '/api/auth/me') body = { user };
    if (url.pathname === '/api/permissions/me') body = { permissions: ['manage_activity_links'] };
    if (url.pathname === '/api/auth/login-requests/pending') body = { loginRequest: null };
    if (url.pathname === '/api/client-access' && req.method === 'GET') body = { ...data, success: true };
    if (url.pathname === '/api/client-access/history') body = { history, page: 1, totalPages: 1, totalRecords: history.length };
    if (url.pathname.startsWith('/api/client-access/') && ['PUT', 'POST'].includes(req.method)) {
      const [, , , routeType, routeId] = url.pathname.split('/'); const input = JSON.parse(raw);
      const bulk = req.method === 'POST', subjectType = bulk ? 'employee' : routeType;
      const subjects = bulk ? input.employees : [{ id: routeId, version: input.version }];
      if (fail) { res.statusCode = 409; body = { message: 'Synthetic concurrent change' }; fail = false; }
      else {
        writes.push({ subjectType, subjectId: subjects[0].id, ...input });
        const policies = subjects.map(row => ({ subjectType, subjectId: row.id, enabled: input.enabled, overrideTeam: input.overrideTeam === true, workTeams: input.workTeams || [], workProjects: input.workProjects || [], clients: input.clients, version: row.version + 1 }));
        const changes = subjects.map(row => { const before = data.policies.find(policy => policy.subjectType === subjectType && policy.subjectId === row.id);
          return { subjectType, subjectId: row.id, name: (subjectType === 'team' ? data.teams.find(team => team._id === row.id)?.teamName : data.employees.find(employee => employee._id === row.id)?.fullName),
            beforeEnabled: before?.enabled === true, afterEnabled: input.enabled,
            beforeOverrideTeam: before?.overrideTeam === true, afterOverrideTeam: input.overrideTeam === true,
            beforeWorkTeams: (before?.workTeams || []).map(value => ({ id: value, name: data.teams.find(team => team._id === value).teamName })),
            afterWorkTeams: (input.workTeams || []).map(value => ({ id: value, name: data.teams.find(team => team._id === value).teamName })),
            beforeWorkProjects: (before?.workProjects || []).map(value => ({ id: value, name: data.projects.find(project => project._id === value).projectName })),
            afterWorkProjects: (input.workProjects || []).map(value => ({ id: value, name: data.projects.find(project => project._id === value).projectName })),
            beforeClients: (before?.clients || []).map(value => ({ id: value, name: data.clients.find(client => client._id === value).clientName })),
            afterClients: input.clients.map(value => ({ id: value, name: data.clients.find(client => client._id === value).clientName })) }; });
        const savedHistory = { _id: `history-${history.length}`, createdAt: new Date().toISOString(), actorName: 'Synthetic Admin', teamName: 'Software', targets: changes };
        history.unshift(savedHistory);
        data.policies = [...data.policies.filter(row => !policies.some(policy => row.subjectType === policy.subjectType && row.subjectId === policy.subjectId)), ...policies];
        body = { policy: policies[0], policies, history: savedHistory };
      }
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
  });
});
let win;
const evaluate = script => win.webContents.executeJavaScript(script);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(script) { for (let n = 0; n < 100; n++) { if (await evaluate(script)) return; await pause(100); } throw Error(`Timed out: ${script}`); }
const click = label => evaluate(`[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)}).click()`);
const mode = type => evaluate(`(()=>{const node=document.querySelector('[aria-label="${type} client selection"]');node.value='selected';node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
app.whenReady().then(async () => {
  let code = 0;
  try {
    fs.mkdirSync(output, { recursive: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1450, height: 1050, webPreferences: { partition: `client-access-${Date.now()}`, backgroundThrottling: false } });
    await win.loadURL(`${base}/login`);
    await evaluate(`localStorage.setItem('token','fixture');localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))})`);
    await win.loadURL(`${base}/admin/client-access`);
    await until(`document.querySelectorAll('.client-access-teams button').length===3`);
    assert.equal(await evaluate(`document.querySelectorAll('.client-access-editor').length`), 0);
    await click('Software'); await until(`document.querySelectorAll('.client-access-member-list input').length===2`);
    assert.equal(await evaluate(`document.querySelector('.client-access-members').textContent.includes('Other Team Employee')`), false);
    await mode('team'); await until(`!!document.querySelector('.client-access-choices')`);
    await evaluate(`document.querySelector('.client-access-editor input[type=checkbox]').click()`);
    await click('Save team clients'); await until(`!!document.querySelector('[role=status]') && !document.querySelector('.client-access-editor button').disabled`);
    assert.equal(writes.length, 1); assert.deepEqual(writes[0].clients, ['upsilon']);
    await evaluate(`document.querySelector('.client-access-member-list input').click()`);
    await until(`document.querySelectorAll('.client-access-editor').length===2`);
    await mode('employee'); await until(`document.querySelectorAll('.client-access-editor fieldset:not(.client-access-work-teams):not(.client-access-work-projects)').length===2`);
    assert.equal(await evaluate(`document.querySelectorAll('.client-access-editor')[1].querySelectorAll('input[type=checkbox]')[1].disabled`), true, 'Cannot add a client outside team limits');
    await evaluate(`document.querySelectorAll('.client-access-editor')[1].querySelector('input[type=checkbox]').click()`);
    fail = true; await click('Save clients for 1 selected members'); await until(`!!document.querySelector('[role=alert]')`);
    assert.equal(await evaluate(`document.querySelectorAll('.client-access-editor')[1].querySelector('input[type=checkbox]').checked`), true, 'Failed save retains choices');
    await click('Save clients for 1 selected members'); await until(`document.querySelector('.client-access-member-list').textContent.includes('Individual restriction')`);
    assert.equal(writes.length, 2); assert.equal(writes[1].subjectId, 'one');
    assert.equal(await evaluate(`document.querySelectorAll('.client-access-member-list input:checked').length`), 0, 'Successful batch resets member selection');
    await evaluate(`(()=>{const node=document.querySelector('[aria-label="Search team employees"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'First');node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(`document.querySelectorAll('.client-access-member-list input').length===1`);
    await click('Select whole team (2)');
    await until(`document.querySelectorAll('.client-access-editor').length===2`);
    assert.equal(await evaluate(`document.querySelector('.client-access-selection').textContent.includes('2 members selected')`), true, 'Whole-team selection includes hidden members');
    assert.equal(await evaluate(`document.querySelector('[aria-label="employee client selection"]').value`), '', 'Mixed settings require an explicit choice');
    await evaluate(`(()=>{const node=document.querySelector('[aria-label="employee client selection"]');node.value='override';node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.querySelectorAll('.client-access-editor fieldset:not(.client-access-work-teams):not(.client-access-work-projects)').length===2`);
    assert.equal(await evaluate(`document.querySelectorAll('.client-access-editor')[1].querySelectorAll('input[type=checkbox]')[1].disabled`), false, 'Cross-team selection allows another team client');
    await evaluate(`document.querySelectorAll('.client-access-editor')[1].querySelectorAll('input[type=checkbox]')[1].click(); document.querySelector('[aria-label="Work with WCPA"]').click(); document.querySelector('[aria-label="Work on Audit"]').click(); document.querySelector('[aria-label="Work on Bookkeeping"]').click()`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
    await click('Save clients for 2 selected members');
    await until(`document.querySelectorAll('.client-access-member-list input:checked').length===0 && document.querySelectorAll('.client-access-history tbody tr').length===3`);
    assert.equal(writes.length, 3); assert.deepEqual(writes[2].employees.map(row => row.id), ['one', 'two']);
    assert.deepEqual(writes[2].employees.map(row => row.version), [1, 0]);
    assert.equal(writes[2].overrideTeam, true);
    assert.deepEqual(writes[2].workTeams, ['wcpa']);
    assert.deepEqual(writes[2].workProjects, ['audit', 'books']);
    assert.ok(writes[2].clients.includes('wcpa'));
    assert.equal(history.length, 3);
    await win.reload(); await until(`document.querySelectorAll('.client-access-history tbody tr').length===3`);
    assert.equal(await evaluate(`document.querySelector('.client-access-history').textContent.includes('2 employees')`), true, 'History survives a page reload');
    assert.equal(await evaluate(`document.querySelector('.client-access-history').textContent.includes('Selected clients across teams')`), true, 'History distinguishes cross-team access');
    assert.equal(await evaluate(`document.querySelector('.client-access-history').textContent.includes('Additional work teams: WCPA')`), true, 'History records additional work teams');
    await click('Software');
    await until(`document.querySelectorAll('.client-access-member-list input').length===2`);
    await evaluate(`document.querySelector('.client-access-member-list input').click()`);
    await until(`!!document.querySelector('[aria-label="Work with WCPA"]')`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Work with WCPA"]').checked`), true, 'Work teams survive reload');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Work on Audit"]').checked && document.querySelector('[aria-label="Work on Bookkeeping"]').checked && !document.querySelector('[aria-label="Work on Another project"]').checked`), true, 'Only selected projects survive reload');
    await evaluate(`document.querySelector('[aria-label="Work with WCPA"]').click()`);
    await click('Save clients for 1 selected members');
    await until(`document.querySelectorAll('.client-access-member-list input:checked').length===0 && document.querySelectorAll('.client-access-history tbody tr').length===4`);
    assert.deepEqual(writes[3].workTeams, []);
    assert.deepEqual(writes[3].workProjects, ['audit', 'books']);
    assert.equal(await evaluate(`document.querySelector('.client-access-history').textContent.includes('Additional projects: Audit, Bookkeeping')`), true);
    await evaluate(`document.querySelector('.client-access-history summary').click(); document.querySelector('.client-access-history').scrollIntoView({block:'start'})`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output, 'history.png'), (await win.webContents.capturePage()).toPNG());
    await click('WCPA'); await until(`document.querySelector('.client-access-member-list').textContent.includes('Other Team Employee')`);
    assert.equal(await evaluate(`document.querySelector('.client-access-members').textContent.includes('First Software Employee')`), false);
    win.setSize(430, 900);
    await until(`parseFloat(getComputedStyle(document.querySelector('.crm-stage')).marginLeft) < 1 && document.querySelector('.crm-nav').getBoundingClientRect().right < 1`);
    await evaluate('window.scrollTo(0,0); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), true);
    fs.writeFileSync(path.join(output, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
    console.log('PASS: team scope, whole-team selection including hidden members, mixed-settings choice, atomic batch payloads, failed-save retention, selection reset, history reload and mobile layout.');
  } catch (error) { code = 1; console.error(error); }
  finally { win?.destroy(); server.closeAllConnections(); server.close(); app.exit(code); }
});
