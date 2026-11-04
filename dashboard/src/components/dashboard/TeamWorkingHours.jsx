import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RefreshCw, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import axiosInstance from '../../api/axiosInstance';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { todayDateKey, APP_TIMEZONE } from '../../utils/appDate';
import { workingDuration } from '../../utils/workingHours';
import useDataRefresh from '../../hooks/useDataRefresh';
import useAuth from '../../context/useAuth';
import ReportSummary from './ReportSummary';
import '../../styles/workingHours.css';

export default function TeamWorkingHours() {
  const { user } = useAuth();
  return ['admin', 'alpha', 'manager'].includes(user?.role) ? <WorkingHoursOverview admin={['admin', 'alpha'].includes(user.role)} /> : null;
}
function WorkingHoursOverview({ admin }) {
  const [date, setDate] = useState(todayDateKey), [data, setData] = useState(null), [team, setTeam] = useState(''), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const request = useRef(0), details = useRef(null);
  const load = useCallback(async () => {
    const current = ++request.current;
    if (!date) return;
    setLoading(true);
    try {
      const response = await axiosInstance.get('/working-hours/overview', { params: { date } });
      if (current !== request.current) return;
      setData(response.data); setError('');
      setTeam(previous => response.data.teams?.some(row => row.key === previous) ? previous : '');
      setSelected(previous => response.data.teams?.some(row => row.key === previous) ? previous : '');
    } catch (error) { if (current === request.current) setError(getApiErrorMessage(error, 'Unable to load working hours.')); }
    finally { if (current === request.current) setLoading(false); }
  }, [date]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);
  useDataRefresh(load);
  const currentData = data?.date === date ? data : null;
  const chosenTeam = currentData?.teams.find(row => row.key === team);
  const total = team ? chosenTeam : currentData?.totals;
  const teams = (currentData?.teams || []).filter(row => !team || row.key === team);
  const detail = currentData?.teams.find(row => row.key === selected && (!team || row.key === team));
  const select = key => { setSelected(key); setTimeout(() => details.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0); };
  return <section className="wh-overview" aria-label="Team Working Hours Overview"><header className="wh-section-header"><div><p className="overview-eyebrow">DAILY PRODUCTIVITY</p><h2>Team Working Hours Overview</h2><p>Attendance-based targets and productive time for one company day.</p></div><div className="wh-filters"><label>Date<input type="date" aria-label="Productivity date" max={todayDateKey()} value={date} onChange={event => setDate(event.target.value)} /></label><label>Team<select aria-label="Productivity team" value={team} onChange={event => { setTeam(event.target.value); setSelected(event.target.value); }}><option value="">All teams</option>{(currentData?.teams || []).map(row => <option key={row.key} value={row.key}>{row.name}</option>)}</select></label><button disabled={loading || !date} onClick={load}><RefreshCw size={15} />{loading ? 'Refreshing…' : 'Refresh hours'}</button></div></header>
    {error && <p role="alert" className="wh-error">{error}{currentData ? ' Showing the last successful update.' : ''}</p>}
    {loading && !currentData && <p role="status">Loading daily working hours…</p>}
    {total && <><ReportSummary items={[
      { label: 'Employees present', value: total.presentCount, help: `${date} · ${APP_TIMEZONE}` },
      { label: 'Required working hours', value: workingDuration(total.requiredSeconds), help: 'Present employees with configured targets' },
      { label: 'Completed working hours', value: workingDuration(total.completedSeconds), help: 'Breaks, idle and overlaps excluded' },
      { label: 'Pending working hours', value: workingDuration(total.pendingSeconds), help: 'Required minus completed, minimum zero' },
      { label: 'Team completion', value: `${total.completionPercent}%`, help: `${workingDuration(total.overtimeSeconds)} employee overtime` },
    ]} />
      {total.unconfiguredCount > 0 && <p className="wh-warning" role="status">{total.unconfiguredCount} present {total.unconfiguredCount === 1 ? 'employee has' : 'employees have'} no working-hours setting. Their time is shown in details and excluded from target and completion totals.{admin && <> <Link to="/admin/working-hours">Configure working hours</Link></>}</p>}
      <div className="wh-team-grid">{teams.map(row => <button type="button" key={row.key} className="card wh-team-card" aria-pressed={selected === row.key} data-productivity-team={row.key} onClick={() => select(row.key)}><div className="wh-section-header"><h3><Users size={18} />{row.name}</h3><ArrowUpRight size={17} /></div><strong>{row.completionPercent}%</strong><progress aria-label={`${row.name} completion`} value={row.completionPercent} max="100" /><p>{row.presentCount} present · {workingDuration(row.completedSeconds)} / {workingDuration(row.requiredSeconds)}</p><small>Pending {workingDuration(row.pendingSeconds)} · Overtime {workingDuration(row.overtimeSeconds)}</small><span>View employee progress <ArrowUpRight size={13} /></span></button>)}</div>
      {!teams.length && <p className="wh-empty">No teams match this filter.</p>}
      <section className="card wh-details" ref={details} aria-label="Employee working hours progress">{!detail ? <div className="wh-empty"><Users size={26} /><h3>Choose a team to view employee progress</h3></div> : <><header className="wh-section-header"><div><h3>{detail.name}</h3><p>{date} · {detail.presentCount} employees present</p></div><span>{detail.completionPercent}% complete</span></header><div className="wh-table-scroll"><table><thead><tr><th>Employee / Team</th><th>Attendance</th><th>Required</th><th>Tracked work</th><th>Pending</th><th>Overtime</th><th>Progress / Status</th></tr></thead><tbody>{detail.members.map(member => <tr key={member.employee}><td><strong>{member.fullName}</strong><small>{member.employeeId} · {member.teamName}{!member.isActive ? ' · Inactive' : ''}</small></td><td>{member.attendance}{member.adjustmentReason && <small>{member.adjustmentReason}</small>}</td><td>{member.present && !member.configured ? 'Not configured' : workingDuration(member.requiredSeconds)}{member.present && member.attendance === 'Half day' && member.configured && <small>{member.halfDayPercent}% of {workingDuration(member.dailyRequiredSeconds)}</small>}</td><td>{workingDuration(member.trackedSeconds)}{(!member.present || !member.configured) && <small>Excluded from completion total</small>}</td><td>{workingDuration(member.pendingSeconds)}</td><td>{workingDuration(member.overtimeSeconds)}</td><td><div className="wh-member-progress"><progress aria-label={`${member.fullName} completion`} value={member.completionPercent} max="100" /><span>{member.completionPercent}%</span></div><span className={`wh-status ${member.status === 'Completed' ? 'complete' : ''}`}>{member.status}</span></td></tr>)}</tbody><tfoot><tr><th>Total</th><td>{detail.presentCount} present</td><td>{workingDuration(detail.requiredSeconds)}</td><td>{workingDuration(detail.completedSeconds)}</td><td>{workingDuration(detail.pendingSeconds)}</td><td>{workingDuration(detail.overtimeSeconds)}</td><td>{detail.completionPercent}%</td></tr></tfoot></table></div><p className="wh-note">Employee pending hours sum to {workingDuration(detail.employeePendingSeconds)}. Team pending uses total required minus total completed; one employee’s overtime can offset another’s shortfall in that total.</p></> }</section>
      <p className="wh-note">Updated {new Date(currentData.asOf).toLocaleTimeString('en-IN', { timeZone: APP_TIMEZONE })} · refreshes every 30 seconds. Teams follow current membership. This measures working time; task completion statuses remain separate.{admin && <> <Link to="/admin/working-hours">Working Hours Settings</Link></>}</p>
    </>}
  </section>;
}
