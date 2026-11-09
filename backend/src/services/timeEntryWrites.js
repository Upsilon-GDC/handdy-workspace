// All interval-creating/moving writers must share this queue. The deployment
// is deliberately single-process (render.yaml); this is not a distributed lock.
const pending = new Map();
function withEmployeeTimeWrite(employee, operation) {
  const key = String(employee?._id || employee || '').toLowerCase();
  const result = (pending.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, result);
  result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => {});
  return result;
}
module.exports = { withEmployeeTimeWrite };
