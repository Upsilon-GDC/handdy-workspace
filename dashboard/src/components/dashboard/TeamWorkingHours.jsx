import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { todayDateKey, APP_TIMEZONE } from '../../utils/appDate';
import { workingDuration } from '../../utils/workingHours';
import ReportSummary from './ReportSummary';
import '../../styles/workingHours.css';

// Daily working-hours pieces for the Overview; data comes from useWorkingHoursOverview.
export function WorkingHoursSummary({ hours, admin, onTeamChange, activityItems = [], activityPeriod = '' }) {
  const { date, setDate, team, data, loading, error, load } = hours;
  const total = team ? data?.teams.find(row => row.key === team) : data?.totals;
  const items = [...activityItems, ...(total ? [
    { label: 'Employees present', value: total.presentCount, help: `${date} · ${APP_TIMEZONE}` },
    { label: 'Required working hours', value: workingDuration(total.requiredSeconds), help: 'Daily target · present employees' },
    { label: 'Completed working hours', value: workingDuration(total.completedSeconds), help: `${total.completionPercent}% complete · Eligible work only` },
    { label: 'Pending working hours', value: workingDuration(total.pendingSeconds), help: `${workingDuration(total.overtimeSeconds)} employee overtime` },
  ] : [])];
  return <section className="wh-overview wh-combined-overview" aria-label="Activity and working hours overview">
    <header className="wh-section-header">
      <div><p className="overview-eyebrow">ACTIVITY & DAILY TARGETS</p><h2>Team working overview</h2><p>Live activity, tracked time and progress towards daily working hours.</p></div>
      <div className="wh-filters">
        <label>Target date<input type="date" aria-label="Productivity date" max={todayDateKey()} value={date} onChange={event => setDate(event.target.value)} /></label>
        <label>Team<select aria-label="Productivity team" value={team} onChange={event => onTeamChange(event.target.value)}><option value="">All teams</option>{(data?.teams || []).map(row => <option key={row.key} value={row.key}>{row.name}</option>)}</select></label>
        <button disabled={loading || !date} onClick={load}><RefreshCw size={15} />{loading ? 'Refreshing…' : 'Refresh hours'}</button>
      </div>
    </header>
    <p className="wh-summary-scope">{activityPeriod && <>Tracked work: {activityPeriod}. </>}Daily targets: {date}. Live status is from the latest activity update today.</p>
    {error && <p role="alert" className="wh-error">{error}{data ? ' Showing the last successful update.' : ''}</p>}
    {loading && !data && <p role="status">Loading daily working hours…</p>}
    {!!items.length && <ReportSummary items={items} />}
    {total && <>
      {total.unconfiguredCount > 0 && <p className="wh-warning" role="status">{total.unconfiguredCount} present {total.unconfiguredCount === 1 ? 'employee has' : 'employees have'} no working-hours setting. Their time is shown in details and excluded from target and completion totals.{admin && <> <Link to="/admin/working-hours">Configure working hours</Link></>}</p>}
      <p className="wh-note">Tracked work can include employees without daily targets. Completed hours use eligible attendance and configured targets, excluding breaks, idle and overlaps. Pending is required minus completed, minimum zero. Updated {new Date(data.asOf).toLocaleTimeString('en-IN', { timeZone: APP_TIMEZONE })} · refreshes every 5 minutes.{admin && <> <Link to="/admin/working-hours">Working Hours Settings</Link></>}</p>
    </>}
  </section>;
}

// The working-hours part of a team card.
export function WorkingHoursTeamProgress({ row, date }) {
  return <div className="overview-team-productivity"><div><span>{date === todayDateKey() ? 'Working hours today' : `Working hours · ${date}`}</span><strong>{row.completionPercent}%</strong></div><progress aria-label={`${row.name} completion`} value={row.completionPercent} max="100" /><small>{row.presentCount} present · {workingDuration(row.completedSeconds)} / {workingDuration(row.requiredSeconds)}</small><small>Pending {workingDuration(row.pendingSeconds)} · Overtime {workingDuration(row.overtimeSeconds)}</small></div>;
}

export function WorkingHoursDetails({ row, date }) {
  return <div className="wh-details" aria-label="Employee working hours progress"><header className="wh-section-header"><div><p className="overview-eyebrow">WORKING HOURS</p><h3>{row.name}</h3><p>{date} · {row.presentCount} employees present</p></div><span>{row.completionPercent}% complete</span></header><div className="wh-table-scroll"><table><thead><tr><th>Employee / Team</th><th>Attendance</th><th>Required</th><th>Tracked work</th><th>Pending</th><th>Overtime</th><th>Progress / Status</th></tr></thead><tbody>{row.members.map(member => <tr key={member.employee}><td><strong>{member.fullName}</strong><small>{member.employeeId} · {member.teamName}{!member.isActive ? ' · Inactive' : ''}</small></td><td>{member.attendance}{member.adjustmentReason && <small>{member.adjustmentReason}</small>}</td><td>{member.present && !member.configured ? 'Not configured' : workingDuration(member.requiredSeconds)}{member.present && member.attendance === 'Half day' && member.configured && <small>{member.halfDayPercent}% of {workingDuration(member.dailyRequiredSeconds)}</small>}</td><td>{workingDuration(member.trackedSeconds)}{(!member.present || !member.configured) && <small>Excluded from completion total</small>}</td><td>{workingDuration(member.pendingSeconds)}</td><td>{workingDuration(member.overtimeSeconds)}</td><td><div className="wh-member-progress"><progress aria-label={`${member.fullName} completion`} value={member.completionPercent} max="100" /><span>{member.completionPercent}%</span></div><span className={`wh-status ${member.status === 'Completed' ? 'complete' : ''}`}>{member.status}</span></td></tr>)}</tbody><tfoot><tr><th>Total</th><td>{row.presentCount} present</td><td>{workingDuration(row.requiredSeconds)}</td><td>{workingDuration(row.completedSeconds)}</td><td>{workingDuration(row.pendingSeconds)}</td><td>{workingDuration(row.overtimeSeconds)}</td><td>{row.completionPercent}%</td></tr></tfoot></table></div><p className="wh-note">Employee pending hours sum to {workingDuration(row.employeePendingSeconds)}. Team pending uses total required minus total completed; one employee’s overtime can offset another’s shortfall in that total.</p></div>;
}
