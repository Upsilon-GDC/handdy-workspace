import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkingHoursOverview } from '../api/overviewApi';
import getApiErrorMessage from '../utils/getApiErrorMessage';
import { todayDateKey } from '../utils/appDate';
import useDataRefresh from './useDataRefresh';

export const canViewWorkingHours = role => ['admin', 'alpha', 'manager'].includes(role);

// Daily working-hours data for the Overview. The page merges each team's row
// into its team card and shows the employee table in the team details.
export default function useWorkingHoursOverview(enabled, { autoRefresh = true, includeRoster = false } = {}) {
  const [date, setDate] = useState(todayDateKey), [data, setData] = useState(null), [team, setTeam] = useState('');
  const [loading, setLoading] = useState(enabled), [error, setError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    if (!enabled || !date) return;
    setLoading(true);
    try {
      const result = await getWorkingHoursOverview({ date, ...(includeRoster ? { includeRoster: 'true' } : {}) });
      if (current !== request.current) return;
      setData(result); setError('');
      setTeam(previous => result.teams?.some(row => row.key === previous) ? previous : '');
      return result;
    } catch (error) { if (current === request.current) setError(getApiErrorMessage(error, 'Unable to load working hours.')); }
    finally { if (current === request.current) setLoading(false); }
  }, [date, enabled, includeRoster]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);
  useDataRefresh(load, undefined, autoRefresh && enabled);
  return { enabled, date, setDate, team, setTeam, data: data?.date === date ? data : null, loading, error, load };
}
