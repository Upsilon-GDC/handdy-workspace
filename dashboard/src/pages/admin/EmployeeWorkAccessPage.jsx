import { useEffect, useState } from 'react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import EmployeeAccessList from '../../components/tasks/EmployeeAccessList';
import axiosInstance from '../../api/axiosInstance';
import useAuth from '../../context/useAuth';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import '../../styles/clientAccess.css';

const id = value => String(value?._id || value || '');

export default function EmployeeWorkAccessPage() {
  const { user, hasPermission } = useAuth();
  const authorized = ['admin', 'alpha', 'manager'].includes(user?.role) && hasPermission('manage_activity_links');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [team, setTeam] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!authorized) return;
    const controller = new AbortController();
    setError('');
    axiosInstance.get('/client-access', { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setData(response.data); })
      .catch(reason => { if (!controller.signal.aborted) setError(getApiErrorMessage(reason, 'Unable to load teams and employees.')); });
    return () => controller.abort();
  }, [authorized, reload]);
  const members = data?.employees.filter(row => team === 'unassigned' ? !row.team : id(row.team) === team) || [];
  return <DashboardLayout title="Employee work access">
    {!authorized ? <p role="alert">Only company administrators with activity-link permission can view employee work access.</p> : <section className="card client-access-page employee-work-access-page">
      <p className="employee-work-access-intro">Choose a team and employee to see their available clients, projects and tasks.</p>
      {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>Try again</button></div>}
      {!data && !error && <p role="status">Loading teams and employees…</p>}
      {data && <>
        <label className="employee-work-access-team">Team<select aria-label="Choose team" value={team} onChange={event => setTeam(event.target.value)}>
          <option value="">Choose a team</option>
          {data.teams.map(row => <option key={id(row)} value={id(row)}>{row.teamName}</option>)}
          <option value="unassigned">No team assigned</option>
        </select></label>
        {team && (members.length ? <EmployeeAccessList key={team} members={members} team={team}
          revision={data.policies.map(row => `${id(row)}:${row.version || 0}`).join(',')} heading="Clients, projects & tasks" />
          : <p>No active employees in this team.</p>)}
      </>}
    </section>}
  </DashboardLayout>;
}
