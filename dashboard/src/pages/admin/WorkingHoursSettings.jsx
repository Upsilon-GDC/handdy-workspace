import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, Clock3, Users, ArrowRight, ArrowLeft } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import useAuth from '../../context/useAuth';
import axiosInstance from '../../api/axiosInstance';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { todayDateKey, APP_TIMEZONE } from '../../utils/appDate';
import { hoursPreview, workingDuration } from '../../utils/workingHours';
import '../../styles/workingHours.css';

export default function WorkingHoursSettings() {
  const { user } = useAuth();
  return <DashboardLayout title="Working Hours Settings" hideHeader>{['admin', 'alpha'].includes(user?.role)
    ? <SettingsEditor /> : <section className="card" role="alert"><h2>Admin access required</h2><p>Only Admin users can configure working hours.</p></section>}</DashboardLayout>;
}
function SettingsEditor() {
  const [employees, setEmployees] = useState([]), [selected, setSelected] = useState([]);
  const [search, setSearch] = useState(''), [team, setTeam] = useState('');
  const [date, setDate] = useState(todayDateKey), [effectiveFrom, setEffectiveFrom] = useState(todayDateKey);
  const [loadedDate, setLoadedDate] = useState('');
  const [mode, setMode] = useState('hours');
  const [hours, setHours] = useState('8'), [halfDayPercent, setHalfDayPercent] = useState('50');
  const [type, setType] = useState('half_day'), [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const request = useRef(0), hoursInput = useRef(null);
  const openAssignment = () => { setMode('hours'); setMessage(''); requestAnimationFrame(() => hoursInput.current?.focus({ preventScroll: true })); };
  const load = useCallback(async () => {
    const current = ++request.current;
    if (!date) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await axiosInstance.get('/working-hours/settings', { params: { date } });
      if (current !== request.current) return;
      setEmployees(data.employees); setLoadedDate(date); setError('');
    } catch (error) { if (current === request.current) setError(getApiErrorMessage(error, 'Unable to load working hours.')); }
    finally { if (current === request.current) setLoading(false); }
  }, [date]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);
  const teams = [...new Map(employees.map(employee => [employee.team?._id || 'unassigned', employee.team?.teamName || 'No team assigned'])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const ready = Boolean(date) && loadedDate === date;
  const teamMembers = employees.filter(employee => (employee.team?._id || 'unassigned') === team);
  const teamName = teams.find(([key]) => key === team)?.[1];
  const chooseTeam = key => { setTeam(key); setSearch(''); setSelected([]); setMessage(''); };
  const shown = ready ? employees.filter(employee => team && (employee.team?._id || 'unassigned') === team
    && `${employee.fullName} ${employee.employeeId}`.toLowerCase().includes(search.toLowerCase().trim())) : [];
  const groups = teams.map(([key, name]) => ({ key, name, employees: shown.filter(employee => (employee.team?._id || 'unassigned') === key) })).filter(group => group.employees.length);
  const toggle = key => { setMessage(''); setSelected(previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key]); };
  const save = async (event, adjustment = false) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const { data } = await axiosInstance.put(adjustment ? '/working-hours/adjustments' : '/working-hours/settings', adjustment
        ? { employeeIds: selected, date, type, reason }
        : { employeeIds: selected, effectiveFrom, requiredHours: hours, halfDayPercent: Number(halfDayPercent), versions: selected.map(employee => ({ employee, version: employees.find(row => row._id === employee)?.version ?? 0 })) });
      setMessage(data.message); setSelected([]); if (adjustment) setReason('');
      await load();
    } catch (error) { setError(getApiErrorMessage(error, 'Unable to save working hours. Your selection has been kept.')); }
    finally { setBusy(false); }
  };
  return <div className="working-hours-settings">
    <header className="wh-page-heading"><h1>Working Hours Settings</h1><p>Select employees by team and update their daily requirements.</p></header>
    {error && <p role="alert" className="wh-error">{error}</p>}{message && <p role="status" className="wh-success">{message}</p>}
    {!team ? <section className="wh-team-chooser" aria-label="Choose a team for working hours"><div className="wh-chooser-heading"><h2>Choose a team</h2><p>Open a team, then assign hours to everyone or select individual employees.</p></div>
      {loading && <p role="status">Loading teams…</p>}
      {!loading && <div className="wh-settings-team-grid">{teams.map(([key, name]) => {
        const members = employees.filter(employee => (employee.team?._id || 'unassigned') === key);
        return <button type="button" className="card wh-settings-team-card" data-working-hours-team={key} key={key} onClick={() => chooseTeam(key)}><span className="wh-settings-team-icon"><Users size={21} /></span><span><strong>{name}</strong><small>{members.length} {members.length === 1 ? 'employee' : 'employees'} · {members.filter(employee => employee.policy).length} configured</small></span><ArrowRight size={18} /></button>;
      })}</div>}
      {!loading && !teams.length && <div className="card wh-empty"><p>No employees are available.</p><button type="button" onClick={load}>Refresh teams</button></div>}
    </section> : <>
    <div className="wh-chosen-team"><button type="button" disabled={busy} onClick={() => chooseTeam('')}><ArrowLeft size={15} />Change team</button><strong><Users size={17} />{teamName || 'Selected team'}</strong><span>{teamMembers.length} employees</span></div>
    <section className="card wh-action-panel" aria-label="Working hours controls">
      <header className="wh-action-heading"><div className="wh-mode-tabs" role="group" aria-label="Working hours action"><button type="button" aria-pressed={mode === 'hours'} disabled={busy} onClick={openAssignment}><Clock3 size={16} />Working hours</button><button type="button" aria-pressed={mode === 'exception'} disabled={busy} onClick={() => setMode('exception')}>Daily exception</button></div><strong className="wh-selected-count" aria-live="polite">{selected.length} {selected.length === 1 ? 'employee' : 'employees'} selected</strong></header>
      <div className="wh-assignment-choice" role="group" aria-label="Assign to team or employees"><span>Assign to</span><button type="button" disabled={busy || loading || !ready} onClick={() => { setSelected(teamMembers.map(employee => employee._id)); setMessage(''); }}>Whole team ({teamMembers.length})</button><button type="button" disabled={busy || loading} onClick={() => { setSelected([]); setMessage(''); }}>Choose employees</button></div>
    <div className="wh-settings-forms"><form hidden={mode !== 'hours'} aria-label="Assign working hours" onSubmit={event => save(event)}><fieldset disabled={busy || loading}><label>Required daily hours<input ref={hoursInput} aria-label="Required daily hours" type="number" min="0" max="24" step="0.01" required value={hours} onChange={event => setHours(event.target.value)} /><small>{hoursPreview(hours)}</small></label><label>Effective from<input aria-label="Working hours effective from" type="date" min={todayDateKey()} required value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} /></label><label>Half-day requirement (%)<input aria-label="Half-day requirement percent" type="number" min="1" max="100" step="1" required value={halfDayPercent} onChange={event => setHalfDayPercent(event.target.value)} /></label><button className="wh-primary" disabled={!selected.length}>{busy ? 'Saving…' : 'Save working hours'}</button></fieldset></form>
      <form hidden={mode !== 'exception'} aria-label="Daily attendance exception form" onSubmit={event => save(event, true)}><fieldset disabled={busy || loading || !date}><label>Exception<select aria-label="Daily attendance exception" value={type} onChange={event => setType(event.target.value)}><option value="half_day">Half day</option><option value="leave">Approved leave</option><option value="absent">Absent</option><option value="normal">Clear exception / normal attendance</option></select></label><label className="wh-exception-reason">Reason<textarea aria-label="Working hours exception reason" required minLength="3" maxLength="500" value={reason} onChange={event => setReason(event.target.value)} /></label><button className="wh-primary" disabled={!selected.length}>{busy ? 'Saving…' : 'Save daily exception'}</button></fieldset></form></div>
      <p className="wh-action-note">{mode === 'hours' ? 'Select employees below, enter hours, then save. Changes apply from today or a future date.' : `Record approved leave or half-day exceptions for ${date}. Choose the date in the employee filters below.`}</p>
    </section>
    <section className="card wh-roster"><header className="wh-section-header"><div><h2>Employees by team</h2><p>Requirements and daily exceptions for {date || 'the selected date'} · {APP_TIMEZONE}</p></div><button disabled={busy || loading || !date} onClick={load}><RefreshCw size={15} />Refresh</button></header>
      <fieldset disabled={busy}><div className="wh-filters"><label>View / exception date<input type="date" aria-label="Working hours date" value={date} onChange={event => { setDate(event.target.value); setSelected([]); }} /></label><label className="wh-search"><Search size={16} /><input aria-label="Search working hours employees" placeholder="Search name or employee ID" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
        <div className="wh-selection"><span>{selected.length} selected</span><button type="button" disabled={loading} onClick={() => setSelected(previous => [...new Set([...previous, ...shown.map(row => row._id)])])}>Select all shown</button><button type="button" onClick={() => setSelected([])}>Clear selection</button><button type="button" disabled={!selected.length || loading} onClick={openAssignment}>Edit selected hours</button></div>
        {loading && <p role="status">Loading employees…</p>}
        <div className="wh-roster-list" aria-label="Employees grouped by team">
        {!loading && groups.map(group => <section className="wh-team-group" key={group.key}><h3>{group.name} <small>{group.employees.length} members</small></h3><div className="wh-table-scroll"><table><thead><tr><th>Select</th><th>Employee</th><th>Daily requirement</th><th>Half-day target</th><th>Daily exception</th><th>Schedule history</th></tr></thead><tbody>{group.employees.map(employee => <tr key={employee._id}>
          <td><input type="checkbox" aria-label={`Select ${employee.fullName}`} checked={selected.includes(employee._id)} onChange={() => toggle(employee._id)} /></td><td><strong>{employee.fullName}</strong><small>{employee.employeeId}{!employee.isActive ? ' · Inactive' : ''}</small><button type="button" className="wh-text-button" onClick={() => { setSelected([employee._id]); setHours(employee.policy ? String(employee.policy.requiredSeconds / 3600) : '8'); setHalfDayPercent(employee.policy ? String(employee.policy.halfDayPercent) : '50'); openAssignment(); }}>Edit requirement</button></td>
          <td>{employee.policy ? <>{workingDuration(employee.policy.requiredSeconds)}<small>From {employee.policy.effectiveFrom}</small></> : <span className="wh-muted">Not configured</span>}</td><td>{employee.policy ? `${employee.policy.halfDayPercent}% · ${workingDuration(Math.round(employee.policy.requiredSeconds * employee.policy.halfDayPercent / 100))}` : '—'}</td><td>{({ normal: 'None', half_day: 'Half day', leave: 'Approved leave', absent: 'Absent' })[employee.adjustment?.type] || 'None'}{employee.adjustment?.reason && <small>{employee.adjustment.reason}</small>}</td>
          <td>{employee.history?.length ? <details><summary>{employee.history.length} revisions</summary>{[...employee.history].reverse().map((revision, index) => <p key={index}>From {revision.effectiveFrom}: {workingDuration(revision.requiredSeconds)} · half day {revision.halfDayPercent}%<small>Saved {new Date(revision.changedAt).toLocaleString('en-IN', { timeZone: APP_TIMEZONE })}</small></p>)}</details> : '—'}</td>
        </tr>)}</tbody></table></div></section>)}
        {!loading && !shown.length && <p className="wh-empty">No employees match these filters.</p>}
        </div>
      </fieldset>
    </section>
    </>}
  </div>;
}
