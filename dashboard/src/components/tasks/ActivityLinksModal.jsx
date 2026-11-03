import { useEffect, useState } from 'react';
import ModalFrame from '../layout/ModalFrame';
import axiosInstance from '../../api/axiosInstance';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import useAuth from '../../context/useAuth';
import { activityId, clientIdsForProject, tasksForActivityProject, toggleVisibleTasks } from '../../utils/activityLinks';
import '../../styles/activityLinks.css';

export default function ActivityLinksModal({ onClose }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientDraft, setClientDraft] = useState(null);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    axiosInstance.get('/projects/activity-links')
      .then(response => { if (active) setData(response.data); })
      .catch(reason => { if (active) setError(getApiErrorMessage(reason, 'Unable to load links. Close and try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const project = data?.projects.find(item => activityId(item) === projectId);
  const savedClientIds = clientIdsForProject(project);
  const chosenClients = clientDraft ?? savedClientIds;
  const clients = (data?.clients || []).filter(item => savedClientIds.includes(activityId(item)));
  const eligible = tasksForActivityProject(data?.tasks || [], project);
  const filtered = eligible.filter(task => `${task.taskName} ${task.taskCode} ${(task.teams || []).map(team => team.teamName).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));
  const visibleIds = filtered.map(activityId);
  const linkedIds = new Set((data?.mappings || []).filter(item => activityId(item.project) === projectId && activityId(item.client) === clientId).map(item => activityId(item.task)));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.includes(id));
  const changeProject = value => {
    setProjectId(value); setClientId(''); setClientDraft(null); setSelected([]); setSearch(''); setError(''); setMessage('');
  };
  const save = async (action, enabled) => {
    if (action === 'policy' && !window.confirm(enabled ? 'Enable linked selection for new time entries on this project? Make sure all required tasks are linked and employees have the updated desktop app. Existing timers are preserved.' : 'Restore legacy task selection for this project?')) return;
    if (action === 'clients') {
      const removed = savedClientIds.filter(id => !chosenClients.includes(id));
      if (removed.length && !window.confirm('Removing clients also unlinks their tasks from this project. Existing tracked time stays unchanged. Continue?')) return;
    }
    setBusy(true); setError(''); setMessage('');
    let saved = false;
    try {
      const response = await axiosInstance.post('/projects/activity-links', {
        action, project: projectId, client: clientId, version: project.activityLinksVersion || 0,
        ...(action === 'policy' ? { enabled } : {}),
        ...(action === 'clients' ? { clientIds: chosenClients } : { taskIds: selected }),
      });
      saved = true;
      // Keep the newest version even if the follow-up fetch fails. Disable
      // further edits until a full refresh proves which links were saved.
      setData(null); setLoading(true);
      const refreshed = await axiosInstance.get('/projects/activity-links');
      setData(refreshed.data); setClientDraft(null); setSelected([]);
      if (action === 'clients' && !chosenClients.includes(clientId)) setClientId('');
      setMessage(response.data.message);
    } catch (reason) {
      setError(saved ? 'Changes were saved, but the refreshed list could not load. Close this window and reopen it.' : getApiErrorMessage(reason, 'Unable to save links.'));
    } finally { setBusy(false); setLoading(false); }
  };

  return <ModalFrame onClose={busy ? undefined : onClose} label="Link projects, clients and tasks">
    <div className="employee-modal activity-links-modal">
      <div className="employee-modal-header"><div><p className="admin-eyebrow">ACTIVITY LINKS</p><h2>Link existing tasks</h2></div><button type="button" className="modal-close-button" onClick={onClose} disabled={busy} aria-label="Close">×</button></div>
      <p>Choose a project and its clients, then select several existing tasks to link. Team and employee assignments stay in place.</p>
      {error && <p role="alert" className="admin-error-box">{error}</p>}
      {message && <p role="status" className="activity-links-success">{message}</p>}
      {loading && <p role="status">Loading activity links…</p>}
      {data && <fieldset disabled={busy} className="activity-links-fields">
        <label htmlFor="activity-project">Project</label>
        <select id="activity-project" value={projectId} onChange={event => changeProject(event.target.value)}><option value="">Select project</option>{data.projects.map(item => <option key={item._id} value={item._id}>{item.projectName} ({item.projectCode})</option>)}</select>
        {project && <>
          {['admin', 'alpha', 'manager', 'hr'].includes(user?.role) && <div className="activity-client-editor"><strong>New time entries: {project.activityMappingEnabled ? 'Linked tasks only' : 'Legacy task selection'}</strong><p>Finish linking the required tasks before enabling linked selection. Running timers and historical time stay unchanged.</p><button type="button" className="secondary-button" onClick={() => void save('policy', !project.activityMappingEnabled)}>{project.activityMappingEnabled ? 'Restore legacy selection' : 'Enable linked selection'}</button></div>}
          <details className="activity-client-editor" open={!savedClientIds.length}>
            <summary>Project clients ({savedClientIds.length} saved)</summary>
            <p>Select the clients that belong to this project.</p>
            <div className="activity-client-list">{data.clients.map(item => <label key={item._id}><input type="checkbox" checked={chosenClients.includes(item._id)} onChange={() => setClientDraft(chosenClients.includes(item._id) ? chosenClients.filter(id => id !== item._id) : [...chosenClients, item._id])} />{item.clientName}</label>)}{chosenClients.filter(id => !data.clients.some(client => client._id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => setClientDraft(chosenClients.filter(value => value !== id))} />Inactive or missing client ({id})</label>)}</div>
            {!data.clients.length && <p>No active clients. Create a client on the Clients page first.</p>}
            {chosenClients.some(id => !data.clients.some(client => client._id === id)) && <p>Some saved clients are unavailable. Uncheck them before saving new client choices.</p>}
            <button type="button" className="primary-button" onClick={() => void save('clients')}>Save project clients</button>
          </details>
          <label htmlFor="activity-client">Client</label>
          <select id="activity-client" value={clientId} onChange={event => { setClientId(event.target.value); setSelected([]); setMessage(''); setError(''); }}><option value="">Select client</option>{clients.map(item => <option key={item._id} value={item._id}>{item.clientName}</option>)}</select>
          {!clients.length && <p>Save at least one active project client above to link tasks.</p>}
          {clientId && <>
            <label htmlFor="activity-task-search">Find tasks</label><input id="activity-task-search" value={search} placeholder="Search by task name, code or team" onChange={event => setSearch(event.target.value)} />
            <div className="activity-selection-actions"><button type="button" disabled={!visibleIds.length} onClick={() => setSelected(toggleVisibleTasks(selected, visibleIds))}>{allVisibleSelected ? 'Deselect shown' : 'Select all shown'}</button><button type="button" disabled={!selected.length} onClick={() => setSelected([])}>Clear selection</button><span aria-live="polite">{selected.length} selected · {filtered.length} shown</span></div>
            <div className="activity-task-list" role="group" aria-label="Select tasks to link">{filtered.map(task => <label key={task._id} className="activity-task-row"><input type="checkbox" checked={selected.includes(task._id)} onChange={() => setSelected(selected.includes(task._id) ? selected.filter(id => id !== task._id) : [...selected, task._id])} /><span><strong>{task.taskName}</strong><small>{task.taskCode} · {task.taskType || 'work'} · {(task.teams?.length ? task.teams : task.team ? [task.team] : []).map(team => team.teamName).filter(Boolean).join(', ') || 'Assigned employees'}</small></span>{linkedIds.has(task._id) && <span className="activity-linked-badge">Linked</span>}</label>)}{!filtered.length && <p>No eligible tasks match. Create a task or check its project/team assignment.</p>}</div>
            <p className="activity-links-help">Selection is kept when searching. Actions apply to all selected tasks, including those hidden by the search (up to 500 per save). Unlinking preserves tasks and historical time entries.</p>
            <div className="employee-form-actions"><button type="button" className="secondary-button" disabled={!selected.length || selected.length > 500} onClick={() => void save('unlink')}>Unlink selected tasks</button><button type="button" className="primary-button" disabled={!selected.length || selected.length > 500} onClick={() => void save('link')}>{busy ? 'Saving…' : 'Link selected tasks'}</button></div>
          </>}
        </>}
      </fieldset>}
    </div>
  </ModalFrame>;
}
