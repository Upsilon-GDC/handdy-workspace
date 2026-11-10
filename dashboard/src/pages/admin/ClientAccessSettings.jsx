import TeamIdentity, { TeamLogo } from "../../components/teams/TeamIdentity";
import { useEffect, useId, useState } from 'react';
import { Users } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import WorkSetupNavigation from '../../components/tasks/WorkSetupNavigation';
import axiosInstance from '../../api/axiosInstance';
import useAuth from '../../context/useAuth';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { APP_TIMEZONE } from '../../utils/appDate';
import '../../styles/clientAccess.css';

const id = value => String(value?._id || value || '');
function ClientEditor({ type, subject, policy, clients, teamPolicy, onSaved, employees, policies, team, teams = [], projects = [], mixed = false, busy, onBusy }) {
  const choiceId = useId();
  const [enabled, setEnabled] = useState(mixed ? null : policy?.enabled === true);
  const [overrideTeam, setOverrideTeam] = useState(policy?.overrideTeam === true);
  const [workTeams, setWorkTeams] = useState(policy?.workTeams || []);
  const [workProjects, setWorkProjects] = useState(policy?.workProjects || []);
  const [projectSearch, setProjectSearch] = useState('');
  const [selected, setSelected] = useState(policy?.clients || []);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const allowed = type === 'employee' && !overrideTeam && teamPolicy?.enabled ? teamPolicy.clients : null;
  const rows = [...clients, ...selected.filter(value => !clients.some(client => id(client) === value))
    .map(value => ({ _id: value, clientName: 'Inactive or removed client', inactive: true }))];
  const effective = (enabled ? selected : clients.map(id)).filter(value => (allowed === null || allowed.includes(value)) && clients.some(client => id(client) === value));
  const save = async event => {
    event.preventDefault(); if (enabled === null) return; setSaving(true); onBusy(true); setError('');
    try {
      const values = { enabled, overrideTeam: type === 'employee' && enabled && overrideTeam, clients: enabled ? selected : [],
        ...(type === 'employee' ? { workTeams, workProjects } : {}) };
      const { data } = employees
        ? await axiosInstance.post('/client-access/employees/batch', { ...values, team,
          employees: employees.map(row => ({ id: id(row), version: policies.find(item => item.subjectType === 'employee' && id(item.subjectId) === id(row))?.version || 0 })) })
        : await axiosInstance.put(`/client-access/${type}/${id(subject)}`, { ...values, version: policy?.version || 0 });
      onSaved(data);
    } catch (error) { setError(getApiErrorMessage(error, 'Unable to save client access.')); }
    finally { setSaving(false); onBusy(false); }
  };
  return <form className="client-access-editor" onSubmit={save}>
    <h3>{type === 'team' ? <TeamIdentity name={subject.teamName} /> : subject.fullName}</h3>
    <fieldset className="client-access-method" disabled={saving || busy} aria-label={`${type} client access choice`}>
      <legend>Which clients should they see?</legend>
      <label className={enabled === false ? 'is-selected' : ''}><input type="radio" name={choiceId} aria-label={`${type} use default clients`} checked={enabled === false} onChange={() => { setEnabled(false); setOverrideTeam(false); }} /><span><strong>{type === 'team' ? "Use the project's clients" : "Use the team's clients"}</strong><small>{type === 'team' ? 'Use clients already connected to their projects.' : 'Use the same client list as the rest of their team.'}</small></span></label>
      <label className={enabled === true ? 'is-selected' : ''}><input type="radio" name={choiceId} aria-label={`${type} choose clients`} checked={enabled === true} onChange={() => { setEnabled(true); setOverrideTeam(false); }} /><span><strong>Choose clients</strong><small>Tick the clients you want to allow below.</small></span></label>
    </fieldset>
    {mixed && <p>Selected members have different saved settings. Your choice below will apply to every selected member.</p>}
    {enabled && <>
      {type === 'employee' && <label className="client-access-outside"><input type="checkbox" aria-label="Allow clients outside their team" checked={overrideTeam} disabled={saving || busy} onChange={event => setOverrideTeam(event.target.checked)} /><span>Allow clients outside their team<small>Turn on only when these employees need clients from another team's list.</small></span></label>}
      <input aria-label={`Search ${type} clients`} placeholder="Search clients…" value={search} onChange={event => setSearch(event.target.value)} />
      <fieldset disabled={saving || busy} className="client-access-choices"><legend>Allowed clients ({selected.length} selected)</legend>
        {rows.filter(client => client.clientName.toLowerCase().includes(search.toLowerCase())).map(client => {
          const value = id(client), outside = allowed !== null && !allowed.includes(value), checked = selected.includes(value);
          return <label key={value}><input type="checkbox" checked={checked} disabled={!checked && (outside || client.inactive)} onChange={() => setSelected(previous => checked ? previous.filter(item => item !== value) : [...previous, value])} />
            <span>{client.clientName}{outside && <small>Outside team limits</small>}{client.inactive && <small>Remove this inactive selection before saving.</small>}</span></label>;
        })}
        {!rows.length && <p>No active clients available.</p>}
      </fieldset>
      {!selected.length && <p role="status">No clients selected: new timers and entries will be blocked for this scope.</p>}
    </>}
    {enabled !== null && <p className="client-access-result"><strong>Clients allowed:</strong> {clients.filter(client => effective.includes(id(client))).map(client => client.clientName).join(', ') || 'None'}<small>Project and task access still apply.</small></p>}
    {type === 'employee' && <details className="access-extra-options"><summary>Allow work from other teams or projects</summary>
      <fieldset disabled={saving || busy} className="client-access-choices client-access-work-teams"><legend>Additional work teams ({workTeams.length} selected)</legend>
        {[...teams, ...workTeams.filter(value => !teams.some(row => id(row) === value)).map(value => ({ _id: value, teamName: 'Inactive or removed team' }))]
          .filter(row => id(row) !== team).map(row => <label key={id(row)}><input type="checkbox" aria-label={`Work with ${row.teamName}`} checked={workTeams.includes(id(row))}
            onChange={() => setWorkTeams(previous => previous.includes(id(row)) ? previous.filter(value => value !== id(row)) : [...previous, id(row)])} /><span>{row.teamName}</span></label>)}
      </fieldset>
      <p>Keep the employee in their main team and allow projects and shared tasks from these teams. Client selections above still apply. Tasks assigned only to another employee stay private; team management and reports are unchanged.</p>
      <label>Search additional projects<input aria-label="Search additional projects" placeholder="Search project name or code…" value={projectSearch} onChange={event => setProjectSearch(event.target.value)} /></label>
      <fieldset disabled={saving || busy} className="client-access-choices client-access-work-projects"><legend>Additional projects ({workProjects.length} selected)</legend>
        {[...projects, ...workProjects.filter(value => !projects.some(row => id(row) === value)).map(value => ({ _id: value, projectName: 'Inactive or removed project' }))]
          .filter(row => `${row.projectName} ${row.projectCode || ''}`.toLowerCase().includes(projectSearch.toLowerCase()))
          .map(row => <label key={id(row)}><input type="checkbox" aria-label={`Work on ${row.projectName}`} checked={workProjects.includes(id(row))}
            onChange={() => setWorkProjects(previous => previous.includes(id(row)) ? previous.filter(value => value !== id(row)) : [...previous, id(row)])} /><span>{row.projectName}{row.projectCode && <small>{row.projectCode}</small>}</span></label>)}
        {!projects.length && !workProjects.length && <p>No active projects available.</p>}
      </fieldset>
      <p>Select specific projects to share their linked shared tasks. Leave Additional work teams unchecked when you want only these projects from another team. Client access and individual task assignments still apply.</p>
    </details>}
    <p className="client-access-help">Changes apply to new selections. Running timers and recorded time are preserved.</p>
    {error && <p role="alert">{error} If another window changed these settings, use Refresh and try again.</p>}
    <button disabled={saving || busy || enabled === null}>{saving ? 'Saving…' : employees ? `Save clients for ${employees.length} selected members` : `Save ${type} clients`}</button>
  </form>;
}
function AccessHistory({ state, error, onPage }) {
  const clientSummary = (target, before) => !(before ? target.beforeEnabled : target.afterEnabled)
    ? target.subjectType === 'team' ? 'Use project client links' : 'Inherit team clients'
    : `${(before ? target.beforeOverrideTeam : target.afterOverrideTeam) ? 'Selected clients across teams: ' : ''}${(before ? target.beforeClients : target.afterClients).map(client => client.name).join(', ') || 'No clients allowed'}`;
  const summary = (target, before) => clientSummary(target, before) + (target.subjectType === 'employee'
    ? `; Additional work teams: ${(before ? target.beforeWorkTeams : target.afterWorkTeams)?.map(row => row.name).join(', ') || 'None'}; Additional projects: ${(before ? target.beforeWorkProjects : target.afterWorkProjects)?.map(row => row.name).join(', ') || 'None'}` : '');
  return <section className="client-access-history" aria-label="Client access history"><h3>History</h3><p>Saved team and employee client settings, newest first. History starts with saves made after this update.</p>
    {error && <p role="alert">{error}</p>}
    {!state ? <p>Loading history…</p> : <>
      {!state.history.length ? <p>No client-access changes recorded yet.</p> : <div className="client-access-history-table"><table><thead><tr><th>When</th><th>Team</th><th>Changed members</th><th>Changes</th><th>By</th></tr></thead><tbody>
        {state.history.map(row => <tr key={row._id}><td>{new Intl.DateTimeFormat('en-IN', { timeZone: APP_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.createdAt))}</td><td><TeamIdentity name={row.teamName} /></td><td>{row.targets.length === 1 ? row.targets[0].name : `${row.targets.length} employees`}</td><td><details><summary>View settings</summary>{row.targets.map(target => <div key={`${target.subjectType}:${target.subjectId}`}><strong>{target.name}</strong><p>Before: {summary(target, true)}<br />After: {summary(target, false)}</p></div>)}</details></td><td>{row.actorName}</td></tr>)}
      </tbody></table></div>}
      <div className="client-access-history-pages"><button disabled={state.page <= 1} onClick={() => onPage(state.page - 1)}>Previous history</button><span>Page {state.page} of {state.totalPages} · {state.totalRecords} saves</span><button disabled={state.page >= state.totalPages} onClick={() => onPage(state.page + 1)}>Next history</button></div>
    </>}
  </section>;
}
export default function ClientAccessSettings({ embedded = false }) {
  const { user, hasPermission } = useAuth();
  const authorized = ['admin', 'alpha', 'manager'].includes(user?.role) && hasPermission('manage_activity_links');
  const [data, setData] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [team, setTeam] = useState(''), [employees, setEmployees] = useState([]), [search, setSearch] = useState('');
  const [scope, setScope] = useState('team');
  const [busy, setBusy] = useState(false), [history, setHistory] = useState(null), [historyError, setHistoryError] = useState('');
  const loadHistory = async (page = 1) => {
    try { const response = await axiosInstance.get('/client-access/history', { params: { page, limit: 10 } }); setHistory(response.data); setHistoryError(''); }
    catch (error) { setHistoryError(getApiErrorMessage(error, 'Unable to load client-access history.')); }
  };
  const load = async () => {
    try { const response = await axiosInstance.get('/client-access'); setData(response.data); setEmployees([]); setError(''); setMessage(''); }
    catch (error) { setError(getApiErrorMessage(error, 'Unable to load client access.')); }
  };
  useEffect(() => { if (authorized) { void load(); void loadHistory(); } }, [authorized]);
  const policy = (type, subjectId) => data?.policies.find(row => row.subjectType === type && id(row.subjectId) === subjectId);
  const saved = result => {
    const rows = result.policies || [result.policy];
    setData(previous => ({ ...previous, policies: [...previous.policies.filter(item => !rows.some(row => item.subjectType === row.subjectType && id(item.subjectId) === id(row.subjectId))), ...rows] }));
    if (rows[0].subjectType === 'employee') setEmployees([]);
    setMessage('Client access saved. Refresh the desktop choices when the current timer has stopped.');
    void loadHistory();
  };
  const selectedTeam = data?.teams.find(row => id(row) === team);
  const members = data?.employees.filter(row => (team === 'unassigned' ? !row.team : id(row.team) === team)) || [];
  const selectedEmployees = members.filter(row => employees.includes(id(row)));
  const visibleMembers = members.filter(row => `${row.fullName} ${row.employeeId}`.toLowerCase().includes(search.toLowerCase()));
  const fingerprints = selectedEmployees.map(row => { const value = policy('employee', id(row)); return JSON.stringify([value?.enabled === true, value?.overrideTeam === true, [...(value?.clients || [])].sort(), [...(value?.workTeams || [])].sort(), [...(value?.workProjects || [])].sort()]); });
  const mixed = new Set(fingerprints).size > 1;
  const content = <>
    {authorized && !embedded && <WorkSetupNavigation busy={busy} />}
    {!authorized ? <p role="alert">Only company administrators with activity-link permission can configure client access.</p> : <section className="card client-access-page">
      <header><div><p className="admin-eyebrow">EMPLOYEE ACCESS</p><h2>Who needs access to a client?</h2><p>Choose their team first. Then update the whole team or specific employees.</p></div><button disabled={busy} onClick={() => { void load(); void loadHistory(); }}>Refresh</button></header>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      {!data ? <p>Loading client access…</p> : <>
        <h3 className="access-question-title">Choose a team</h3>
        <div className="client-access-teams" aria-label="Choose team">{[...data.teams, { _id: 'unassigned', teamName: 'No team assigned' }].map(row => <button key={id(row)} disabled={busy} aria-pressed={team === id(row)} onClick={() => { setTeam(id(row)); setScope(id(row) === 'unassigned' ? 'employees' : 'team'); setEmployees([]); setSearch(''); setMessage(''); }}><TeamLogo name={row.teamName} small />{row.teamName}</button>)}</div>
        {team && <div className="access-guided-content">
          <h3 className="access-question-title">Whose access do you want to change?</h3>
          <div className="access-scope-options" role="group" aria-label="Access for"><button type="button" disabled={busy || !selectedTeam} aria-pressed={scope === 'team'} onClick={() => { setScope('team'); setEmployees([]); }}><strong>The whole team</strong><span>Set the usual client access for this team.</span></button><button type="button" disabled={busy} aria-pressed={scope === 'employees'} onClick={() => setScope('employees')}><strong>Specific employees</strong><span>Give selected people different client access.</span></button></div>
          {scope === 'team' && <section>{selectedTeam && <ClientEditor key={`team:${team}:${policy('team', team)?.version || 0}`} type="team" subject={selectedTeam} policy={policy('team', team)} clients={data.clients} onSaved={saved} busy={busy} onBusy={setBusy} />}</section>}
          {scope === 'employees' && <section className="client-access-members"><h3><Users size={18} /> Choose employees ({members.length})</h3><input aria-label="Search team employees" placeholder="Search employees…" value={search} onChange={event => setSearch(event.target.value)} />
            <div className="client-access-selection"><button disabled={busy || !members.length} onClick={() => setEmployees(members.map(id))}>Select whole team ({members.length})</button><button disabled={busy || !visibleMembers.length} onClick={() => setEmployees(previous => [...new Set([...previous, ...visibleMembers.map(id)])])}>Select all shown</button><button disabled={busy || !employees.length} onClick={() => setEmployees([])}>Clear selection</button><span aria-live="polite">{selectedEmployees.length} members selected</span></div>
            <div className="client-access-member-list">{visibleMembers.map(row => <label key={id(row)} className={employees.includes(id(row)) ? 'is-selected' : ''}><input type="checkbox" disabled={busy} aria-label={`Select ${row.fullName}`} checked={employees.includes(id(row))} onChange={() => setEmployees(previous => previous.includes(id(row)) ? previous.filter(value => value !== id(row)) : [...previous, id(row)])} /><span>{row.fullName}<small>{row.employeeId} · {policy('employee', id(row))?.enabled ? policy('employee', id(row))?.overrideTeam ? 'Selected clients across teams' : 'Individual restriction' : 'Inherits team clients'}</small></span></label>)}{!members.length && <p>No active employees in this team.</p>}{!!members.length && !visibleMembers.length && <p>No members match your search.</p>}</div>
            {!!selectedEmployees.length && <ClientEditor key={`employees:${selectedEmployees.map(row => `${id(row)}:${policy('employee', id(row))?.version || 0}`).join(',')}:${policy('team', team)?.version || 0}`} type="employee" subject={{ fullName: selectedEmployees.length === 1 ? selectedEmployees[0].fullName : `${selectedEmployees.length} selected members` }} policy={policy('employee', id(selectedEmployees[0]))} clients={data.clients} teamPolicy={policy('team', team)} onSaved={saved} employees={selectedEmployees} policies={data.policies} team={team} teams={data.teams} projects={data.projects} mixed={mixed} busy={busy} onBusy={setBusy} />}
          </section>}
        </div>}
      </>}
      <details className="setup-history"><summary>View previous access changes</summary><AccessHistory state={history} error={historyError} onPage={loadHistory} /></details>
    </section>}
  </>;
  return embedded ? content : <DashboardLayout title="Work setup">{content}</DashboardLayout>;
}
