// Test Chromium's real HTTP cache against the production cache middleware.
// Loopback fixtures only: no employee account, external server or MongoDB.
const { app, BrowserWindow } = require('electron');
const express = require('../../backend/node_modules/express');
const assert = require('node:assert/strict');
const cache = require('../../backend/src/middleware/catalogCache');
const { invalidate } = require('../../backend/src/services/readRevisions');
const Model = { modelName: 'Phase3BrowserFixture', aggregate: () => ({ hint: async () => [{ count: 1, total: revision }] }) };
let revision = 1, name = 'Original client', permitted = ['upsilon'], revoked = false, reads = 0;
const statuses = [];
const api = express();
api.get('/', (_req, res) => res.type('html').send('<!doctype html><title>Isolated catalog cache test</title>'));
api.use('/api', (req, res, next) => {
  res.on('finish', () => statuses.push(res.statusCode));
  if (revoked || !req.headers.authorization) return res.status(401).json({ success: false });
  req.user = { _id: req.headers.authorization, role: 'employee', team: 'software' }; next();
}, cache([Model], { scopeKey: () => permitted }), (req, res) => {
  reads++; res.json({ success: true, name, clients: permitted, caller: req.user._id, page: req.query.page || '1' });
});
let win, server;
app.whenReady().then(async () => {
  let code = 0;
  try {
    server = api.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, webPreferences: { partition: `phase3-${Date.now()}` } });
    await win.loadURL(origin);
    const fetch = (url, token = 'first', mode = 'default') => win.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}, {cache:${JSON.stringify(mode)},headers:{Authorization:${JSON.stringify(token)}}}).then(async response=>({status:response.status,body:await response.json()}))`);
    for (const path of ['/api/clients', '/api/projects', '/api/tasks', '/api/employees/options', '/api/teams']) {
      const first = await fetch(path), before = reads;
      assert.equal(first.status, 200);
      const next = await fetch(path);
      assert.equal(next.status, 200, 'Chromium supplies a usable body after server 304');
      assert.equal(next.body.name, 'Original client');
      assert.equal(statuses.at(-1), 304, `${path} was validated without downloading a body`);
      assert.equal(reads, before, 'Unchanged list skips the data-loading handler');
    }
    revision++; name = 'Renamed client'; invalidate(Model.modelName);
    assert.equal((await fetch('/api/clients')).body.name, 'Renamed client');
    assert.equal(statuses.at(-1), 200);
    permitted = [];
    assert.deepEqual((await fetch('/api/clients')).body.clients, []);
    assert.equal(statuses.at(-1), 200, 'A narrower client policy never reuses the old cached body');
    assert.equal((await fetch('/api/clients', 'second')).body.caller, 'second');
    assert.equal(statuses.at(-1), 200, 'Other sessions do not receive the first caller body');
    assert.equal((await fetch('/api/clients?page=2')).body.page, '2');
    revoked = true;
    assert.equal((await fetch('/api/clients')).status, 401, 'Revocation is checked before returning a cached list');
    console.log('PASS: Chromium cache validation, usable 304 bodies, edited records, narrower client access, caller/filter isolation and revocation.');
  } catch (error) { code = 1; console.error(error); }
  finally { win?.destroy(); server?.closeAllConnections(); server?.close(); app.exit(code); }
});
