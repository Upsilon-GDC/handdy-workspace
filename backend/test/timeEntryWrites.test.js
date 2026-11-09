const test = require('node:test');
const assert = require('node:assert/strict');
const { withEmployeeTimeWrite } = require('../src/services/timeEntryWrites');

test('same-employee writes wait through failures while other employees remain independent', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const order = [];
  const first = withEmployeeTimeWrite('EMPLOYEE-A', async () => { order.push('first'); await blocked; throw Error('write failed'); });
  const observedFailure = first.catch(error => { assert.equal(error.message, 'write failed'); });
  const second = withEmployeeTimeWrite('employee-a', async () => { order.push('second'); });
  await withEmployeeTimeWrite('employee-b', async () => { order.push('independent'); });
  assert.deepEqual(order, ['first', 'independent']);
  release();
  await Promise.all([observedFailure, second]);
  assert.deepEqual(order, ['first', 'independent', 'second']);
  await withEmployeeTimeWrite('employee-a', async () => { order.push('later'); });
  assert.equal(order.at(-1), 'later');
});
