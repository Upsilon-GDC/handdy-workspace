// Included ONLY in isolated installer-test builds, never in the CRM installer.
const { app, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const settings = require('./pilot-settings.json');
const root = settings.output;
const stage = process.env.CRM_PILOT_STAGE;
if (!stage || !root || !settings.name.startsWith('CRM Phase2 Test ')) throw new Error('Isolated pilot settings required');
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'profile'));
const setName = app.setName.bind(app);
app.setName = () => setName(settings.name); // Isolate Windows startup registration.
const user = { _id: 'pilot-employee', fullName: 'Installer Test Employee', role: 'employee', team: 'team' };
let quickLogins = 0, starts = 0;
setTimeout(() => {
  fs.writeFileSync(path.join(root, `${stage}.json`), JSON.stringify({ success: false, error: 'Pilot exceeded 60 seconds' }));
  app.exit(1);
}, 60_000).unref();
const apiCalls = [];
app.whenReady().then(async () => {
  await session.defaultSession.protocol.handle('https', async req => {
    const headers = { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    apiCalls.push(url.pathname);
    let body = {};
    if (url.pathname === '/api/auth/login') {
      const input = await req.json();
      assert.equal(input.email, 'installer@example.invalid');
      assert.equal(input.password, 'synthetic-pilot-only');
      body = { token: 'pilot-access', rememberedSessionToken: 'pilot-remembered', user };
    }
    if (url.pathname === '/api/auth/quick-login') {
      quickLogins++;
      if (stage === 'offline') throw new Error('Synthetic offline request');
      if (stage === 'expired') return new Response(JSON.stringify({ message: 'Remembered session expired' }), { status: 401, headers });
      const input = await req.json();
      assert.ok(input.rememberedSessionToken.startsWith('pilot-'));
      assert.equal(Object.hasOwn(input, 'password'), false);
      body = { token: 'pilot-access', rememberedSessionToken: 'pilot-rotated', user };
    }
    if (url.pathname === '/api/auth/me') body = { user };
    if (url.pathname === '/api/settings/idle-policy') body = { idlePolicy: { idleThresholdMinutes: 5, autoLogoutMinutes: 50 } };
    if (url.pathname === '/api/clients') body = { clients: [{ _id: 'internal', clientName: 'Pilot Internal', status: 'Active' }] };
    if (url.pathname === '/api/projects') body = { projects: [{ _id: 'none', projectName: 'No Project', clients: ['internal'] }], totalPages: 1 };
    if (url.pathname.endsWith('/activity-options')) body = { clients: [{ _id: 'internal', clientName: 'Pilot Internal' }], tasks: [], mappingEnabled: true };
    if (url.pathname === '/api/time-logs/active') body = { timeLog: null };
    if (url.pathname === '/api/time-logs/my') body = { timeLogs: [], totalPages: 1 };
    if (url.pathname === '/api/time-logs/start') starts++;
    return new Response(JSON.stringify(body), { headers });
  });
});
// Suppress external update checks only in the test build.
require('./app-updater').startAppUpdater = () => null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(win, code) {
  for (let i = 0; i < 200; i++) {
    try { if (await win.webContents.executeJavaScript(code)) return; } catch { /* navigation */ }
    await delay(100);
  }
  throw new Error(`Pilot timeout: ${code}`);
}
let done = false;
app.on('browser-window-created', (_event, win) => {
  win.hide();
  if (done) return;
  done = true;
  (async () => {
    const evaluate = code => win.webContents.executeJavaScript(code);
    if (stage === 'first-login') {
      await until(win, `!!document.querySelector('#loginForm')`);
      assert.equal(quickLogins, 0);
      await evaluate(`document.querySelector('#email').value='installer@example.invalid'; document.querySelector('#password').value='synthetic-pilot-only'; document.querySelector('#loginForm').requestSubmit();`);
    }
    if (['first-login', 'upgrade-startup'].includes(stage)) {
      await until(win, `location.pathname.endsWith('dashboard.html') && document.querySelector('#projectSelect')?.value==='none' && document.querySelector('#clientSelect')?.value==='internal'`);
      assert.equal(await evaluate(`document.querySelector('#taskSelect').value`), '');
      assert.ok(await evaluate(`!!localStorage.getItem('rememberedSessionToken')`));
      if (stage === 'first-login') {
        await evaluate(`localStorage.setItem('installerUpgradeMarker','preserve-me'); localStorage.removeItem('token'); localStorage.removeItem('user');`);
      } else {
        assert.equal(app.getVersion(), settings.nextVersion);
        assert.equal(quickLogins, 1);
        assert.equal(await evaluate(`localStorage.getItem('installerUpgradeMarker')`), 'preserve-me');
        await evaluate(`document.querySelector('#logoutButton').click()`);
        await until(win, `location.pathname.endsWith('index.html') && localStorage.getItem('desktopAutoLoginPaused')==='true'`);
      }
    } else if (stage === 'after-logout') {
      await until(win, `!!document.querySelector('#loginForm')`);
      await delay(600);
      assert.equal(quickLogins, 0);
      assert.equal(await evaluate(`localStorage.getItem('desktopAutoLoginPaused')`), 'true');
      await evaluate(`localStorage.removeItem('desktopAutoLoginPaused'); localStorage.removeItem('token'); localStorage.removeItem('user');`);
    } else if (['offline', 'expired'].includes(stage)) {
      await until(win, `!!document.querySelector('#loginForm') && !document.querySelector('#loginButton').disabled`);
      await delay(700);
      assert.equal(quickLogins, 1);
      const saved = await evaluate(`localStorage.getItem('rememberedSessionToken')`);
      if (stage === 'offline') assert.ok(saved, 'Network failure must retain remembered credentials');
      else assert.equal(saved, null, 'Expired credential must return to manual sign-in');
    } else throw new Error('Unknown pilot stage');
    assert.equal(starts, 0, 'Opening CRM must never start a timer');
    const startup = app.getLoginItemSettings({ path: process.execPath, args: [] });
    assert.equal(startup.openAtLogin, true);
    session.defaultSession.flushStorageData();
    await delay(250);
    const device = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'device.json'), 'utf8'));
    fs.writeFileSync(path.join(root, `${stage}.json`), JSON.stringify({ success: true, stage, version: app.getVersion(),
      isPackaged: app.isPackaged, executable: process.execPath, userData: app.getPath('userData'),
      deviceId: device.deviceId, openAtLogin: startup.openAtLogin, quickLogins, starts, apiCalls }, null, 2));
    app.exit(0);
  })().catch(error => {
    fs.writeFileSync(path.join(root, `${stage}.json`), JSON.stringify({ success: false, error: error.stack }, null, 2));
    app.exit(1);
  });
});
require('./main'); // Run the actual packaged application, preload and pages.
// Test only: keep the actual timer screen from locking the operator's desktop.
ipcMain.removeAllListeners('timer-lock:set');
