import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight, BriefcaseBusiness, Clock3, Coffee, RefreshCw, Search, Users } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import ReportSummary from '../../components/dashboard/ReportSummary';
import { getAllEmployeeOptions } from '../../api/employeeApi';
import { getAllTeams } from '../../api/teamApi';
import { getAdminTimeLogs } from '../../api/reportApi';
import { todayDateKey, APP_TIMEZONE } from '../../utils/appDate';
import { buildAdminOverview, overviewHours, overviewPreset, overviewRangeError } from '../../utils/adminOverview';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import useDataRefresh from '../../hooks/useDataRefresh';
import useAuth from '../../context/useAuth';
import { canEditTimeEntries } from '../../utils/timeEntryEditing';
import '../../styles/adminOverview.css';

const stateClass = state => ({ Working: 'working', 'On break': 'break', Idle: 'idle', Paused: 'idle' }[state] || 'stopped');
export default function AdminOverviewPage() {
  const { user } = useAuth();
  const [from, setFrom] = useState(todayDateKey);
  const [to, setTo] = useState(todayDateKey);
  const [snapshot, setSnapshot] = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [status, setStatus] = useState('All');
  const mounted = useRef(false);
  const request = useRef(0);
  const busy = useRef(false);
  const applied = useRef(overviewPreset('today', todayDateKey()));
  const details = useRef(null);
  const load = useCallback(async ({ range = applied.current, force = false } = {}) => {
    if (!mounted.current || (!force && busy.current)) return;
    const token = ++request.current;
    busy.current = true;
    setRefreshing(true);
    try {
      const today = todayDateKey();
      const periodPromise = getAdminTimeLogs(range, { force });
      const [employees, teams, period, current] = await Promise.all([
        getAllEmployeeOptions(), getAllTeams(), periodPromise,
        range.startDate === today && range.endDate === today ? periodPromise : getAdminTimeLogs({ startDate: today, endDate: today }, { force }),
      ]);
      if (!mounted.current || token !== request.current) return;
      const asOf = Date.now();
      const overview = buildAdminOverview({ teams, employees, records: period.timeLogs || [], todayRecords: current.timeLogs || [], asOf });
      applied.current = range;
      setSnapshot({ ...overview, range, asOf }); setError('');
      setSelectedTeam(previous => overview.teams.some(team => team.key === previous) ? previous : '');
    } catch (error) {
      if (mounted.current && token === request.current) setError(getApiErrorMessage(error, 'Unable to refresh the team overview.'));
    } finally { if (mounted.current && token === request.current) { busy.current = false; setRefreshing(false); } }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load({ force: true });
    return () => { mounted.current = false; };
  }, [load]);
  useDataRefresh(() => load());
  const applyRange = range => {
    const message = overviewRangeError(range.startDate, range.endDate, todayDateKey());
    setRangeError(message);
    if (message) return;
    void load({ range, force: true });
  };
  const preset = name => {
    const range = overviewPreset(name, todayDateKey());
    setFrom(range.startDate); setTo(range.endDate); applyRange(range);
  };
  const teams = useMemo(() => (snapshot?.teams || []).filter(team => team.name.toLowerCase().includes(teamSearch.trim().toLowerCase())), [snapshot, teamSearch]);
  const team = snapshot?.teams.find(team => team.key === selectedTeam);
  const members = team?.members.filter(member => (status === 'All' || member.state === status)
    && [member.fullName, member.employeeId, member.currentProject, member.currentTask].filter(Boolean).join(' ').toLowerCase().includes(memberSearch.trim().toLowerCase())) || [];
  const total = snapshot?.totals;
  const maxHours = Math.max(1, ...(snapshot?.teams || []).map(team => team.workedSeconds));
  const updated = snapshot ? new Intl.DateTimeFormat('en-IN', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(snapshot.asOf) : '';
  const selectTeam = key => {
    setSelectedTeam(key); setMemberSearch(''); setStatus('All');
    setTimeout(() => details.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };
  return <DashboardLayout title="Team overview" hideHeader>
    <div className="admin-team-overview">
      <section className="card overview-toolbar" aria-label="Overview period">
        <div><p className="overview-eyebrow">TEAM OVERVIEW</p><h2>Your teams at a glance</h2><p>See who is working now and how much time each team has recorded.</p></div>
        <div className="overview-range-controls"><div className="overview-presets"><button onClick={() => preset('today')}>Today</button><button onClick={() => preset('week')}>This week</button><button onClick={() => preset('month')}>This month</button></div>
          <label>From<input type="date" aria-label="Overview from" max={todayDateKey()} value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label>To<input type="date" aria-label="Overview to" min={from} max={todayDateKey()} value={to} onChange={event => setTo(event.target.value)} /></label>
          <button className="overview-apply" onClick={() => applyRange({ startDate: from, endDate: to })}>Apply dates</button>
          <button className="overview-refresh" disabled={refreshing} onClick={() => load({ force: true })}><RefreshCw size={15} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {rangeError && <p className="overview-error" role="alert">{rangeError}</p>}
        <div className="overview-period-note"><span>{snapshot ? `${snapshot.range.startDate} – ${snapshot.range.endDate}` : 'Loading overview…'} · {APP_TIMEZONE}</span><span>{snapshot ? `${error ? 'Last successful update' : 'Updated'} ${updated} · refreshes every 30 seconds` : 'Fetching team activity'}</span></div>
      </section>
      {error && <p role="alert" className="overview-error">{error}{snapshot ? ' Showing the last successful update; current status may be out of date.' : ' Try Refresh to load the overview.'}</p>}
      {total && <ReportSummary items={[
        { label: error ? 'Working at last update' : 'Working now', value: `${total.working} / ${total.activeMembers}`, help: `${total.onBreak} on break · ${total.idle} idle or paused` },
        { label: 'Worked hours', value: overviewHours(total.workedSeconds), help: 'All teams · selected period' },
        { label: 'Break hours', value: overviewHours(total.breakSeconds), help: 'Break tasks and intentional breaks' },
        { label: 'Idle hours', value: overviewHours(total.idleSeconds), help: 'Idle pauses and same-day gaps' },
      ]} />}
      {snapshot && <>
        <section className="overview-teams-section" aria-label="Team activity">
          <header className="overview-section-heading"><div><p className="overview-eyebrow">TEAMS</p><h2>Team activity</h2></div><label className="overview-search"><Search size={16} /><input aria-label="Search overview teams" placeholder="Search teams…" value={teamSearch} onChange={event => setTeamSearch(event.target.value)} /></label></header>
          <div className="overview-team-grid">{teams.map(item => <button key={item.key} type="button" className="overview-team-card" data-overview-team={item.key} aria-pressed={selectedTeam === item.key} onClick={() => selectTeam(item.key)}>
            <div className="overview-team-title"><span className="overview-team-icon"><Users size={20} /></span><div><h3>{item.name}</h3><small>{item.activeMembers} active members{!item.isActive ? ' · Inactive team' : ''}</small></div><ArrowUpRight size={18} /></div>
            <div className="overview-team-hours"><strong>{overviewHours(item.workedSeconds)}</strong><span>worked in selected period</span></div>
            <div className="overview-hours-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, item.workedSeconds / maxHours * 100)}%` }} /></div>
            <div className="overview-live-counts"><span className="working"><Activity size={13} />{item.working} working</span><span className="break"><Coffee size={13} />{item.onBreak} on break</span><span>{item.noTimer} no active timer</span></div>
            <div className="overview-team-time"><span>Break <strong>{overviewHours(item.breakSeconds)}</strong></span><span>Idle <strong>{overviewHours(item.idleSeconds)}</strong></span></div>
            <p className="overview-current-projects"><BriefcaseBusiness size={14} />{item.projects.length ? item.projects.slice(0, 3).join(' · ') + (item.projects.length > 3 ? ` +${item.projects.length - 3}` : '') : 'No work timer running'}</p>
            <span className="overview-open-team">View team members <ArrowUpRight size={13} /></span>
          </button>)}</div>
          {!teams.length && <p className="overview-empty">{teamSearch ? 'No teams match your search.' : 'No team activity available.'}</p>}
        </section>
        <section className="card overview-member-section" ref={details} aria-label="Team member activity">
          {!team ? <div className="overview-empty"><Users size={30} /><h3>Choose a team above</h3><p>View its members, current work and recorded hours.</p></div> : <>
            <header className="overview-section-heading"><div><p className="overview-eyebrow">TEAM MEMBERS</p><h2>{team.name}</h2><p>Hours: {snapshot.range.startDate} – {snapshot.range.endDate}. Status and current activity: latest refresh today.</p></div><span>{team.members.length} members</span></header>
            <div className="overview-member-filters"><label className="overview-search"><Search size={16} /><input aria-label="Search overview members" placeholder="Search name, ID, project or task" value={memberSearch} onChange={event => setMemberSearch(event.target.value)} /></label><select aria-label="Member activity status" value={status} onChange={event => setStatus(event.target.value)}>{['All', 'Working', 'On break', 'Idle', 'Paused', 'No active timer', 'Inactive account'].map(state => <option key={state}>{state}</option>)}</select></div>
            <div className="overview-member-table"><table><thead><tr><th>Member</th><th>{error ? 'Last known status' : 'Current status'}</th><th>Current project / task</th><th>Worked</th><th>Break</th><th>Idle</th></tr></thead><tbody>{members.map(member => <tr key={member.key}>
              <td><strong>{member.fullName || 'Unavailable employee'}</strong><small>{member.employeeId || '—'} · {member.role?.replaceAll('_', ' ') || 'Former member'}</small></td>
              <td><span className={`overview-status ${stateClass(member.state)}`}>{member.state}</span></td><td>{member.currentProject ? <><strong>{member.currentProject}</strong><small>{member.currentTask}</small></> : '—'}</td>
              <td>{overviewHours(member.workedSeconds)}</td><td>{overviewHours(member.breakSeconds)}</td><td>{overviewHours(member.idleSeconds)}</td>
            </tr>)}</tbody></table></div>
            {!members.length && <p className="overview-empty">No members match these filters.</p>}
          </>}
        </section>
        <div className="overview-bottom"><p>Team totals follow current membership. Working now means a running work timer; no active timer does not mean absent. Alpha accounts are hidden.</p><div><Link to="/admin/timesheets/detailed"><Clock3 size={15} />Detailed timesheet</Link>{canEditTimeEntries(user) && <Link to="/admin/time-entry-edits">Edit entries <ArrowUpRight size={15} /></Link>}</div></div>
      </>}
    </div>
  </DashboardLayout>;
}
