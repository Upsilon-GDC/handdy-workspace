const test = require('node:test');
const assert = require('node:assert/strict');
const { configureLaunchAtLogin } = require('../login-startup');
test('only the packaged Windows CRM executable registers for Windows sign-in', () => {
  const calls = [];
  const app = { isPackaged: false, setLoginItemSettings: settings => calls.push(settings) };
  assert.equal(configureLaunchAtLogin({ app, platform: 'win32' }), false);
  app.isPackaged = true;
  assert.equal(configureLaunchAtLogin({ app, platform: 'linux' }), false);
  assert.equal(calls.length, 0);
  assert.equal(configureLaunchAtLogin({ app, platform: 'win32', executable: 'C:\\CRM\\CRM.exe' }), true);
  assert.deepEqual(calls, [{ openAtLogin: true, path: 'C:\\CRM\\CRM.exe', args: [] }]);
});
test('Windows startup registration failure does not prevent CRM opening', () => {
  let warned = false;
  const result = configureLaunchAtLogin({ app: { isPackaged: true, setLoginItemSettings() { throw new Error('denied'); } }, platform: 'win32', logger: { warn() { warned = true; } } });
  assert.equal(result, false); assert.equal(warned, true);
});
