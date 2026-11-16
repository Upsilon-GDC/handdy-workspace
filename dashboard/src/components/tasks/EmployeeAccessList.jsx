import { useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import getApiErrorMessage from '../../utils/getApiErrorMessage';

const id = value => String(value?._id || value || '');

export default function EmployeeAccessList({ members, team, revision, busy, heading = 'Current employee access' }) {
  const [employee, setEmployee] = useState('');
  const [result, setResult] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const selected = members.some(row => id(row) === employee) ? employee : '';
  const requestKey = `${selected}:${team}:${revision}:${refresh}`;
  const current = result?.key === requestKey ? result : null;
  const snapshot = current?.data;
  const error = current?.error;
  const loading = Boolean(selected && !current);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    axiosInstance.get(`/client-access/employees/${selected}/links`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setResult({ key: requestKey, data }); })
      .catch(reason => { if (!controller.signal.aborted) setResult({ key: requestKey, error: getApiErrorMessage(reason, 'Unable to load employee access.') }); });
    return () => controller.abort();
  }, [selected, requestKey]);
  const changeEmployee = value => setEmployee(value);
  const reload = () => setRefresh(value => value + 1);
  return <section className="employee-access-list" aria-label="Current employee access">
    <header><div><h3>{heading}</h3><p>See the clients, projects and tasks available for new timer selections.</p></div></header>
    <div className="employee-access-list-controls">
      <label>Employee<select value={selected} disabled={busy} onChange={event => changeEmployee(event.target.value)}>
        <option value="">Choose an employee</option>
        {members.map(row => <option key={id(row)} value={id(row)}>{row.fullName} ({row.employeeId})</option>)}
      </select></label>
      <button type="button" disabled={!selected || loading || busy} onClick={reload}>Refresh list</button>
    </div>
    {selected && loading && <p role="status">Loading current access…</p>}
    {selected && error && <p role="alert">{error}</p>}
    {selected && !error && snapshot?.employee?._id === selected && <>
      <div className="employee-access-list-table"><table><thead><tr><th>Project</th><th>Client</th><th>Available tasks</th></tr></thead><tbody>
        {snapshot.projects.flatMap(project => (project.clients.length ? project.clients : [{ _id: 'none', clientName: 'No permitted clients' }]).map(client => {
          const tasks = client._id === 'none' ? [] : project.tasks.filter(task => !project.mappingEnabled || task.clientIds?.includes(id(client)));
          return <tr key={`${id(project)}:${id(client)}`}><td><strong>{project.projectName}</strong></td><td>{client.clientName}</td><td>
            {tasks.length ? <details><summary>{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} — view list</summary><ul>{tasks.map(task => <li key={id(task)}>{task.taskName}{task.taskType === 'break' ? ' (Break)' : ''}</li>)}</ul></details> : 'No available tasks'}
          </td></tr>;
        }))}
      </tbody></table></div>
      {!snapshot.projects.length && <p>No active projects are available for this employee.</p>}
    </>}
  </section>;
}
