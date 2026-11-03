// Real packaged page/preload flow with an isolated mock API and profile.
// Does not register Windows startup, contact production, or start a real timer.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const user = { _id: 'employee', fullName: 'Startup Employee', role: 'employee', team: 'team' };
let active = null, starts = 0, quickLogins = 0;
const calls = [];
const mockApi = async req => {
  const headers = { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const url = new URL(req.url, 'http://localhost');
  calls.push(url.pathname);
  let body = {};
  if (url.pathname.endsWith('/activity-options')) {
    const project = url.pathname.includes('/none/') ? 'none' : 'audit';
    const client = project === 'none' ? { _id: 'internal', clientName: 'UPSiLON', status: 'Active' } : { _id: 'external', clientName: 'WCPA', status: 'Active' };
    body = project === 'none' ? { clients: [client], tasks: [{ _id: 'task', taskName: 'Review', taskType: 'work', project }], mappingEnabled: false }
      : { clients: [client, { _id: 'second', clientName: 'Second client', status: 'Active' }], tasks: [
        { _id: 'task', taskName: 'Review', taskType: 'work', project, clientIds: ['external'] },
        { _id: 'other-task', taskName: 'Review', taskType: 'work', project, clientIds: ['second'] },
      ], mappingEnabled: true };
  }
  if (url.pathname === '/api/auth/quick-login') {
    const input = await req.json();
    assert.equal(input.rememberedSessionToken, 'remembered'); assert.equal(Object.hasOwn(input, 'password'), false);
    quickLogins++;
    body = { token: 'access', rememberedSessionToken: 'rotated', user };
  }
  if (url.pathname === '/api/auth/me') body = { user };
  if (url.pathname === '/api/settings/idle-policy') body = { idlePolicy: { idleThresholdMinutes: 5, autoLogoutMinutes: 50 } };
  if (url.pathname === '/api/clients') body = { clients: [{ _id: 'internal', clientName: 'UPSiLON', status: 'Active' }, { _id: 'external', clientName: 'WCPA', status: 'Active' }] };
  if (url.pathname === '/api/projects') body = { projects: [
    { _id: 'none', projectName: 'No Project', clients: [{ _id: 'internal' }] },
    { _id: 'audit', projectName: 'Audit', clients: [{ _id: 'external' }, { _id: 'second' }], activityMappingEnabled: true },
  ], totalPages: 1 };
  if (url.pathname === '/api/tasks') body = { tasks: url.searchParams.get('taskType') === 'break' ? [] : [{ _id: 'task', taskName: 'Review', taskType: 'work', project: url.searchParams.get('project') }], totalPages: 1 };
  if (url.pathname === '/api/time-logs/active') body = { timeLog: active };
  if (url.pathname === '/api/time-logs/my') body = { timeLogs: [], totalPages: 1 };
  if (url.pathname === '/api/time-logs/start') starts++;
  return new Response(JSON.stringify(body), { headers });
};
let win;
const evaluate = code => win.webContents.executeJavaScript(code);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function openLogin() {
  try { await win.loadFile(path.join(root, 'index.html')); }
  catch (error) { if (error.errno !== -3) throw error; } // Expected renderer redirect; assert destination below.
}
async function until(code) {
  for (let n = 0; n < 100; n++) { if (await evaluate(code)) return; await delay(100); }
  throw new Error(`Timed out: ${code}`);
}
app.whenReady().then(async () => {
  try {
    const api = 'https://crm-startup.invalid/api';
    ipcMain.on('config:get-api-base-url', event => { event.returnValue = api; });
    ipcMain.on('config:get-device-info', event => { event.returnValue = { deviceId: 'startup-test-device', clientType: 'desktop' }; });
    ipcMain.handle('system:get-idle-time', () => 0);
    ipcMain.handle('system:idle-defaults', () => require('../idle-policy-defaults.json'));
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: `startup-${Date.now()}` } });
    // Intercept HTTPS inside this isolated session. The real page CSP stays
    // enabled; no request can reach a production service or an occupied port.
    await win.webContents.session.protocol.handle('https', mockApi);
    await openLogin();
    assert.equal(quickLogins, 0);
    await evaluate(`localStorage.setItem('rememberedSessionToken','remembered'); localStorage.setItem('rememberedUser',${JSON.stringify(JSON.stringify(user))});`);
    await openLogin();
    await until(`location.pathname.endsWith('dashboard.html') && document.querySelector('#projectSelect')?.value === 'none' && document.querySelector('#clientSelect')?.value === 'internal'`);
    assert.equal(quickLogins, 1); assert.equal(starts, 0);
    assert.equal(await evaluate(`document.querySelector('#taskSelect').value`), '');
    assert.equal(await evaluate(`localStorage.getItem('rememberedSessionToken')`), 'rotated');
    assert.equal(await evaluate(`!!document.querySelector('#clientSelect option[value="external"]')`), false);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const output = path.resolve(root, '../backend/.local-repairs/startup-review/timer-default.png');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
    await evaluate(`(() => { const select = document.querySelector('#projectSelect'); select.value = 'audit'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await until(`!!document.querySelector('#clientSelect option[value="second"]')`);
    await evaluate(`(() => { const select = document.querySelector('#clientSelect'); select.value = 'external'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await until(`!!document.querySelector('#taskSelect option[value="task"]')`);
    assert.equal(await evaluate(`!!document.querySelector('#taskSelect option[value="other-task"]')`), false);
    await evaluate(`document.querySelector('#taskSelect').value = 'task'; document.querySelector('#taskSelect').dispatchEvent(new Event('change', { bubbles: true }));`);
    await evaluate(`(() => { const select = document.querySelector('#clientSelect'); select.value = 'second'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await until(`!!document.querySelector('#taskSelect option[value="other-task"]')`);
    assert.equal(await evaluate(`document.querySelector('#taskSelect').value`), '');
    assert.equal(await evaluate(`!!document.querySelector('#taskSelect option[value="task"]')`), false);
    active = { _id: 'existing', status: 'running', startedAt: new Date().toISOString(), project: { _id: 'audit', projectName: 'Audit' }, client: { _id: 'external', clientName: 'WCPA' }, task: { _id: 'task', taskName: 'Review', taskType: 'work' }, pauses: [] };
    await openLogin();
    await until(`location.pathname.endsWith('dashboard.html') && document.querySelector('#projectSelect')?.value === 'audit' && document.querySelector('#clientSelect')?.value === 'external'`);
    assert.equal(quickLogins, 1); assert.equal(starts, 0);
    await evaluate(`localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.setItem('desktopAutoLoginPaused','true');`);
    await openLogin();
    await delay(300); assert.equal(quickLogins, 1);
    assert.equal(await evaluate(`location.pathname.endsWith('index.html')`), true);
    console.log('PASS: saved account auto-login, first-run fallback, No Project linked client, no timer auto-start, active session restoration and explicit sign-out pause. Mock API only.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); app.exit(process.exitCode || 0); }
});
