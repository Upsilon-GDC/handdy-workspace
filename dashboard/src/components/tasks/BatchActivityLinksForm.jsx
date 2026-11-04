import { useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, Building2, FolderOpen, Link2, ListTodo, Search, Unlink } from 'lucide-react';
import axiosInstance from '../../api/axiosInstance';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { activityId, tasksForBulkProjects, toggleVisibleTasks } from '../../utils/activityLinks';

function Picker({ label, items, selected, onChange, nameField, search, onSearch, unavailable = new Set() }) {
  const visible = items.filter(item => `${item[nameField]} ${item.taskCode || item.projectCode || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectableIds = visible.filter(item => !unavailable.has(activityId(item))).map(activityId);
  const Icon = label === 'Projects' ? FolderOpen : label === 'Clients' ? Building2 : ListTodo;
  return <section className="activity-batch-picker">
    <h3><span><Icon size={18} aria-hidden="true" />{label}</span><small>{selected.length} selected</small></h3>
    <div className="activity-picker-search"><Search size={16} aria-hidden="true" /><input aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} value={search} onChange={event => onSearch(event.target.value)} /></div>
    <div className="activity-selection-actions"><button type="button" disabled={!selectableIds.length} onClick={() => onChange(toggleVisibleTasks(selected, selectableIds))}>{selectableIds.length && selectableIds.every(id => selected.includes(id)) ? 'Deselect shown' : 'Select all shown'}</button><button type="button" disabled={!selected.length} onClick={() => onChange([])}>Clear</button><span>{visible.length} shown</span></div>
    <div className="activity-batch-list" role="group" aria-label={`Select ${label.toLowerCase()}`}>{visible.map(item => {
      const value = activityId(item), checked = selected.includes(value), blocked = unavailable.has(value);
      return <label key={value} className={`${checked ? 'is-selected' : ''}${blocked ? ' is-unavailable' : ''}`}><input type="checkbox" value={value} checked={checked} disabled={blocked && !checked} onChange={() => onChange(checked ? selected.filter(id => id !== value) : [...selected, value])} /><span><strong>{item[nameField]}</strong>{(item.taskCode || item.projectCode) && <small>{item.taskCode || item.projectCode}</small>}{blocked && <small>Not available to every selected project’s teams</small>}</span></label>;
    })}{!visible.length && <p>No matching {label.toLowerCase()}.</p>}</div>
  </section>;
}

export default function BatchActivityLinksForm({ data, onRefresh, onBusyChange, onReload, clientProjectsOnly = false }) {
  const clientsOnly = clientProjectsOnly;
  const [projectIds, setProjectIds] = useState([]), [clientIds, setClientIds] = useState([]), [taskIds, setTaskIds] = useState([]);
  const [searches, setSearches] = useState({ projects: '', clients: '', tasks: '' });
  const [review, setReview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const submitting = useRef(false);
  const projects = data.projects.filter(project => projectIds.includes(activityId(project)));
  const clients = data.clients.filter(client => clientIds.includes(activityId(client)));
  const tasks = data.tasks.filter(task => taskIds.includes(activityId(task)));
  const eligible = new Set(tasksForBulkProjects(data.tasks, projects).map(activityId));
  const unavailable = new Set(data.tasks.filter(task => !eligible.has(activityId(task))).map(activityId));
  const incompatible = !clientsOnly && taskIds.some(id => unavailable.has(id));
  const count = projectIds.length * clientIds.length * (clientsOnly ? 1 : taskIds.length);
  const invalid = !count || projectIds.length > 50 || clientIds.length > 500 || (!clientsOnly && taskIds.length > 500) || count > 5000;
  const change = setter => values => { setter(values); setReview(null); setError(''); setMessage(''); };
  const searchProps = key => ({ search: searches[key], onSearch: value => setSearches(current => ({ ...current, [key]: value })) });
  const save = async () => {
    if (submitting.current || !review || invalid || needsReload || (review === 'link' && incompatible)) return;
    submitting.current = true; setBusy(true); onBusyChange(true); setError(''); setMessage('');
    let saved = false;
    try {
      const response = await axiosInstance.post('/projects/activity-links/batch', { action: review, mode: clientsOnly ? 'clients' : 'tasks',
        projects: projects.map(project => ({ project: activityId(project), version: project.activityLinksVersion || 0 })), clientIds, taskIds: clientsOnly ? [] : taskIds });
      saved = true;
      await onRefresh();
      setMessage(response.data.message); setTaskIds([]); setReview(null);
    } catch (reason) {
      if (saved || reason.response?.status === 409) setNeedsReload(true);
      setError(saved ? 'Changes were saved, but the refreshed list could not load. Reload links before saving again.' : getApiErrorMessage(reason, 'Unable to save this batch.'));
    } finally { setBusy(false); onBusyChange(false); submitting.current = false; }
  };
  return <div className="activity-batch-form">
    <p className="activity-editor-intro">{clientsOnly ? 'Choose your projects and clients below. Review the connections before adding or removing links.' : 'Select projects, clients and tasks, then review the connections. Every selected combination is saved together.'}</p>
    {error && <p role="alert" className="admin-error-box">{error}</p>}{message && <p role="status" className="activity-links-success">{message}</p>}
    {needsReload && onReload && <button type="button" disabled={busy} onClick={onReload}>Reload links</button>}
    <fieldset disabled={busy || needsReload} className="activity-links-fields">
      {!review && <>
        <div className={`activity-batch-columns${clientsOnly ? '' : ' has-tasks'}`}>
          <Picker label="Projects" items={data.projects} selected={projectIds} onChange={change(setProjectIds)} nameField="projectName" {...searchProps('projects')} />
          <Picker label="Clients" items={data.clients} selected={clientIds} onChange={change(setClientIds)} nameField="clientName" {...searchProps('clients')} />
        {!clientsOnly && <Picker label="Tasks" items={data.tasks} selected={taskIds} onChange={change(setTaskIds)} nameField="taskName" {...searchProps('tasks')} unavailable={unavailable} />}
        </div>
        {!clientsOnly && !projectIds.length && <p>Select projects to see which tasks their teams can use.</p>}
        {incompatible && <p role="alert">Some selected tasks do not share a team with every selected project. Deselect those tasks or adjust the projects before linking.</p>}
        {(count > 5000 || projectIds.length > 50 || clientIds.length > 500 || taskIds.length > 500) && <p role="alert">Choose at most 50 projects, 500 clients, 500 tasks and 5,000 combinations per save.</p>}
        <div className="activity-batch-footer">
          <div className="activity-connection-summary" aria-live="polite"><span className="activity-summary-icon"><Link2 size={19} aria-hidden="true" /></span><div><strong>{count} combinations</strong><span>{projectIds.length} projects × {clientIds.length} clients{!clientsOnly && ` × ${taskIds.length} tasks`}</span></div></div>
          <div className="activity-footer-actions"><button type="button" className="activity-action-secondary" disabled={invalid} onClick={() => setReview('unlink')}><Unlink size={15} aria-hidden="true" />Review unlink</button><button type="button" className="activity-action-primary" disabled={invalid || incompatible} onClick={() => setReview('link')}>Review links<ArrowRight size={16} aria-hidden="true" /></button></div>
        </div>
      </>}
      {review && <section className="activity-batch-review">
        <h3>Review {review === 'link' ? 'links' : 'unlink'}</h3>
        <p><strong>{count} combinations</strong> across {projects.length} projects, {clients.length} clients{!clientsOnly && ` and ${tasks.length} tasks`}.</p>
        <dl><dt>Projects</dt><dd>{projects.map(project => <span className="activity-review-chip" key={project._id}>{project.projectName}</span>)}</dd><dt>Clients</dt><dd>{clients.map(client => <span className="activity-review-chip" key={client._id}>{client.clientName}</span>)}</dd>{!clientsOnly && <><dt>Tasks</dt><dd>{tasks.map(task => <span className="activity-review-chip" key={task._id}>{task.taskName} ({task.taskCode})</span>)}</dd></>}</dl>
        <p>{clientsOnly
          ? review === 'link' ? 'Add these clients to every selected project. Existing task links and other clients are retained.' : 'Remove these clients from every selected project. Their task mappings on those projects will also be disabled. Task definitions and recorded time are retained.'
          : review === 'link' ? 'Each selected project receives all selected clients and tasks. Existing client links remain.' : 'Only these client-specific task links are disabled. Project clients, reusable tasks and recorded time are retained.'}</p>
        <div className="activity-batch-footer"><span className="activity-review-note">Recorded time and task definitions are retained.</span><div className="activity-footer-actions"><button type="button" className="activity-action-secondary" onClick={() => setReview(null)}><ArrowLeft size={15} aria-hidden="true" />Back</button><button type="button" className="activity-action-primary" onClick={() => void save()}>{busy ? 'Saving…' : review === 'link' ? 'Confirm links' : 'Confirm unlink'}<Link2 size={16} aria-hidden="true" /></button></div></div>
      </section>}
    </fieldset>
  </div>;
}
