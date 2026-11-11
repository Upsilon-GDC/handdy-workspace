import { TeamLogo } from "../../components/teams/TeamIdentity";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BriefcaseBusiness, Coffee, RefreshCw, Search } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import ReportSummary from '../../components/dashboard/ReportSummary';
import { WorkingHoursDetails, WorkingHoursSummary, WorkingHoursTeamProgress } from '../../components/dashboard/TeamWorkingHours';
import useWorkingHoursOverview, { canViewWorkingHours } from '../../hooks/useWorkingHoursOverview';
import { getAllEmployeeOptions, getAllMyTeamMembers } from '../../api/employeeApi';
import { getAllTeams } from '../../api/teamApi';
import { getAdminTimeLogs, getTeamTimeLogs } from '../../api/reportApi';
import { todayDateKey, APP_TIMEZONE } from '../../utils/appDate';
import { buildAdminOverview, overviewHours, overviewPreset, overviewRangeError } from '../../utils/adminOverview';
import { loadOverviewData } from '../../utils/overviewData';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import useDataRefresh from '../../hooks/useDataRefresh';
import useAuth from '../../context/useAuth';
import '../../styles/adminOverview.css';

const stateClass = state => ({ Working: 'working', 'On break': 'break', Idle: 'idle', Paused: 'idle' }[state] || 'stopped');
// The working-hours API names the no-team group differently from the overview.
const overviewTeamKey = key => key === 'unassigned' ? '__unassigned_team__' : key;
export default function AdminOverviewPage({ teamOnly = false }) {
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
  const hours = useWorkingHoursOverview(teamOnly || canViewWorkingHours(user?.role), { autoRefresh: false, includeRoster: true, teamOnly });
  const hoursLoader = useRef(hours.load);
  useEffect(() => { hoursLoader.current = hours.load; }, [hours.load]);
  const load = useCallback(async ({ range = applied.current, force = false } = {}) => {
    if (!mounted.current || (!force && busy.current)) return;
    const token = ++request.current;
    busy.current = true;
    setRefreshing(true);
    try {
      const today = todayDateKey();
      const { employees, teams, period, current } = await loadOverviewData({ range, today, force,
        loadContext: () => hoursLoader.current(), loadEmployees: teamOnly ? getAllMyTeamMembers : getAllEmployeeOptions, loadTeams: teamOnly ? async () => [] : getAllTeams, loadReport: teamOnly ? getTeamTimeLogs : getAdminTimeLogs });
      if (!mounted.current || token !== request.current) return;
      const asOf = Date.now();
      const allowedMembers = new Set(employees.map(row => String(row._id)));
      const records = rows => teamOnly ? (rows || []).filter(row => allowedMembers.has(String(row.employee?._id || row.employee))) : rows || [];
      const overview = buildAdminOverview({ teams, employees, records: records(period.timeLogs), todayRecords: records(current.timeLogs), asOf });
      applied.current = range;
      setSnapshot({ ...overview, range, asOf }); setError('');
    } catch (error) {
      if (mounted.current && token === request.current) setError(getApiErrorMessage(error, 'Unable to refresh the team overview.'));
    } finally { if (mounted.current && token === request.current) { busy.current = false; setRefreshing(false); } }
  }, [teamOnly]);
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
  // One card per team: activity for the selected period plus that team's working hours for the productivity date.
  const productivity = useMemo(() => new Map((hours.data?.teams || []).map(row => [overviewTeamKey(row.key), row])), [hours.data]);
  const allCards = useMemo(() => {
    const activity = snapshot?.teams || [];
    return [...activity.map(team => ({ key: team.key, name: team.name, team, hours: productivity.get(team.key) })),
      ...[...productivity].filter(([key]) => !activity.some(team => team.key === key)).map(([key, row]) => ({ key, name: row.name, hours: row }))];
  }, [snapshot, productivity]);
  const cards = allCards.filter(card => card.name.toLowerCase().includes(teamSearch.trim().toLowerCase()) && (!hours.team || card.key === overviewTeamKey(hours.team)));
  const activeKey = allCards.some(card => card.key === selectedTeam) ? selectedTeam : '';
  const team = snapshot?.teams.find(item => item.key === activeKey);
  const teamHours = productivity.get(activeKey);
  const members = team?.members.filter(member => (status === 'All' || member.state === status)
    && [member.fullName, member.employeeId, member.currentProject, member.currentTask].filter(Boolean).join(' ').toLowerCase().includes(memberSearch.trim().toLowerCase())) || [];
  const total = snapshot?.totals;
  const summaryTotal = hours.enabled && hours.team ? snapshot?.teams.find(row => row.key === overviewTeamKey(hours.team)) : total;
  const summaryScope = hours.team ? hours.data?.teams.find(row => row.key === hours.team)?.name || 'Selected team' : teamOnly ? 'Your teams' : 'All teams';
  const activityItems = summaryTotal ? [
    { label: error ? 'Working at last update' : 'Working now', value: `${summaryTotal.working} / ${summaryTotal.activeMembers}`, help: `${summaryScope} · ${summaryTotal.onBreak} on break · ${summaryTotal.idle} idle or paused` },
    { label: 'Tracked work', value: overviewHours(summaryTotal.workedSeconds), help: `${summaryScope} | Break / Idle ${overviewHours(summaryTotal.breakSeconds + summaryTotal.idleSeconds)}` },
  ] : [];
  const updated = snapshot ? new Intl.DateTimeFormat('en-IN', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(snapshot.asOf) : '';
  const selectTeam = key => {
    setSelectedTeam(key); setMemberSearch(''); setStatus('All');
    setTimeout(() => details.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };
  const chooseProductivityTeam = key => {
    hours.setTeam(key); setSelectedTeam(key ? overviewTeamKey(key) : ''); setMemberSearch(''); setStatus('All');
  };
  return <DashboardLayout title="Team overview" hideHeader>
    <div className="admin-team-overview">
      <section className="card overview-toolbar" aria-label="Overview period">
        <div><p className="overview-eyebrow">TEAM OVERVIEW</p><h2>{teamOnly ? 'Your team at a glance' : 'Your teams at a glance'}</h2><p>{teamOnly ? 'See activity, recorded time and daily working hours for your assigned team members.' : 'See who is working now and how much time each team has recorded.'}</p></div>
        <div className="overview-range-controls"><div className="overview-presets"><button onClick={() => preset('today')}>Today</button><button onClick={() => preset('week')}>This week</button><button onClick={() => preset('month')}>This month</button></div>
          <label>From<input type="date" aria-label="Overview from" max={todayDateKey()} value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label>To<input type="date" aria-label="Overview to" min={from} max={todayDateKey()} value={to} onChange={event => setTo(event.target.value)} /></label>
          <button className="overview-apply" onClick={() => applyRange({ startDate: from, endDate: to })}>Apply dates</button>
          <button className="overview-refresh" disabled={refreshing} onClick={() => load({ force: true })}><RefreshCw size={15} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {rangeError && <p className="overview-error" role="alert">{rangeError}</p>}
        <div className="overview-period-note"><span>{snapshot ? `${snapshot.range.startDate} – ${snapshot.range.endDate}` : 'Loading overview…'} · {APP_TIMEZONE}</span><span>{snapshot ? `${error ? 'Last successful update' : 'Updated'} ${updated} · refreshes every 5 minutes` : 'Fetching team activity'}</span></div>
      </section>
      {error && <p role="alert" className="overview-error">{error}{snapshot ? ' Showing the last successful update; current status may be out of date.' : ' Try Refresh to load the overview.'}</p>}
      {!hours.enabled && total && <ReportSummary items={[
        { label: error ? 'Working at last update' : 'Working now', value: `${total.working} / ${total.activeMembers}`, help: `${total.onBreak} on break · ${total.idle} idle or paused` },
        { label: 'Worked hours', value: overviewHours(total.workedSeconds), help: 'All teams · selected period' },
        { label: 'Break / Idle', value: overviewHours(total.breakSeconds + total.idleSeconds), help: 'Breaks and idle time combined' },
      ]} />}
      {hours.enabled && <WorkingHoursSummary hours={hours} admin={!teamOnly && ['admin', 'alpha', 'manager'].includes(user?.role)} teamOnly={teamOnly} onTeamChange={chooseProductivityTeam}
        activityItems={activityItems} activityPeriod={snapshot ? `${snapshot.range.startDate} – ${snapshot.range.endDate}` : ''} />}
      {(snapshot || hours.data) && <>
        <section className="overview-teams-section" aria-label="Team activity">
          <header className="overview-section-heading"><div><p className="overview-eyebrow">TEAMS</p><h2>Team activity</h2></div><label className="overview-search"><Search size={16} /><input aria-label="Search overview teams" placeholder="Search teams…" value={teamSearch} onChange={event => setTeamSearch(event.target.value)} /></label></header>
          <div className="overview-team-grid">{cards.map(card => <button key={card.key} type="button" className="overview-team-card" data-overview-team={card.team ? card.key : undefined} data-productivity-team={card.hours?.key} aria-pressed={activeKey === card.key} onClick={() => selectTeam(card.key)}>
            <div className="overview-team-title"><TeamLogo name={card.name} /><div><h3>{card.name}</h3><small>{card.team ? `${card.team.activeMembers} active members${!card.team.isActive ? ' · Inactive team' : ''}` : `${card.hours.presentCount} present`}</small></div><ArrowUpRight size={18} /></div>
            {card.team && <>
              <div className="overview-team-hours"><strong>{overviewHours(card.team.workedSeconds)}</strong><span>worked in selected period</span></div>
              <div className="overview-live-counts"><span className="working"><Activity size={13} />{card.team.working} working</span><span className="break"><Coffee size={13} />{card.team.onBreak} on break</span><span>{card.team.noTimer} no active timer</span></div>
              <div className="overview-team-time"><span>Break / Idle <strong>{overviewHours(card.team.breakSeconds + card.team.idleSeconds)}</strong></span></div>
            </>}
            {card.hours && <WorkingHoursTeamProgress row={card.hours} date={hours.date} />}
            {card.team && <p className="overview-current-projects"><BriefcaseBusiness size={14} />{card.team.projects.length ? card.team.projects.slice(0, 3).join(' · ') + (card.team.projects.length > 3 ? ` +${card.team.projects.length - 3}` : '') : 'No work timer running'}</p>}
            <span className="overview-open-team">View team details <ArrowUpRight size={13} /></span>
          </button>)}</div>
          {!cards.length && <p className="overview-empty">{teamSearch ? 'No teams match your search.' : 'No team activity available.'}</p>}
        </section>
        {(team || teamHours) && <section className="card overview-member-section" ref={details} aria-label="Team details">
          {team && <>
            <header className="overview-section-heading"><div><p className="overview-eyebrow">TEAM MEMBERS</p><h2>{team.name}</h2><p>Hours: {snapshot.range.startDate} – {snapshot.range.endDate}. Status and current activity: latest refresh today.</p></div><span>{team.members.length} members</span></header>
            <div className="overview-member-filters"><label className="overview-search"><Search size={16} /><input aria-label="Search overview members" placeholder="Search name, ID, project or task" value={memberSearch} onChange={event => setMemberSearch(event.target.value)} /></label><select aria-label="Member activity status" value={status} onChange={event => setStatus(event.target.value)}>{['All', 'Working', 'On break', 'Idle', 'Paused', 'No active timer', 'Inactive account'].map(state => <option key={state}>{state}</option>)}</select></div>
            <div className="overview-member-table"><table><thead><tr><th>Member</th><th>{error ? 'Last known status' : 'Current status'}</th><th>Current project / task</th><th>Worked</th><th>Break / Idle</th></tr></thead><tbody>{members.map(member => <tr key={member.key}>
              <td><strong>{member.fullName || 'Unavailable employee'}</strong><small>{member.employeeId || '—'} · {member.role?.replaceAll('_', ' ') || 'Former member'}</small></td>
              <td><span className={`overview-status ${stateClass(member.state)}`}>{member.state}</span></td><td>{member.currentProject ? <><strong>{member.currentProject}</strong><small>{member.currentTask}</small></> : '—'}</td>
              <td>{overviewHours(member.workedSeconds)}</td><td>{overviewHours(member.breakSeconds + member.idleSeconds)}</td>
            </tr>)}</tbody></table></div>
            {!members.length && <p className="overview-empty">No members match these filters.</p>}
          </>}
          {teamHours && <WorkingHoursDetails row={teamHours} date={hours.date} />}
        </section>}
      </>}
    </div>
  </DashboardLayout>;
}
