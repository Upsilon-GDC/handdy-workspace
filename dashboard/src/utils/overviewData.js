// Reuse only data with matching scope. Historical-only ranges still need a
// separate report for today's live status; productive-hours rules stay server-side.
export async function loadOverviewData({ range, today, force, loadContext, loadEmployees, loadTeams, loadReport }) {
  const period = loadReport(range, { force });
  const current = range.startDate <= today && range.endDate >= today
    ? period : loadReport({ startDate: today, endDate: today }, { force });
  const roster = (async () => {
    let context;
    try { context = await loadContext?.(); } catch { /* Keep activity usable during a productivity outage. */ }
    if (Array.isArray(context?.roster?.employees) && Array.isArray(context?.roster?.teams)) return context.roster;
    // Older servers and roles without productivity access retain their original
    // authorized catalog endpoints, which have private cache validation.
    const [employees, teams] = await Promise.all([loadEmployees(), loadTeams()]);
    return { employees, teams };
  })();
  const [people, records, todayRecords] = await Promise.all([roster, period, current]);
  return { ...people, period: records, current: todayRecords };
}

// Coalesce concurrent reads only; never retain a settled result or reuse data
// across sessions. A later manual refresh always performs a fresh request.
export function createSharedRead(fetch, sessionKey) {
  const pending = new Map();
  return params => {
    const session = sessionKey();
    const key = JSON.stringify([session, params]);
    if (pending.has(key)) return pending.get(key);
    const operation = Promise.resolve().then(() => fetch(params)).then(data => {
      if (sessionKey() !== session) throw new Error('The signed-in session changed during overview loading.');
      return data;
    }).finally(() => { if (pending.get(key) === operation) pending.delete(key); });
    pending.set(key, operation);
    return operation;
  };
}
