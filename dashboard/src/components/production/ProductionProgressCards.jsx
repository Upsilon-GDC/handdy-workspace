import { Link } from 'react-router-dom';
import { ArrowUpRight, Building2, Users } from 'lucide-react';
import { productionDuration as duration, productionPercent as percent, productionMoney as money } from '../../utils/production';

export default function ProductionProgressCards({ rows, teamLink }) {
  if (!rows?.length) return null;
  return <section className="prod-team-highlights" aria-label="Team production cards">
    <div className="prod-highlights-heading"><h2>Team production</h2><span>Production against attendance targets</span></div>
    <div className="prod-team-card-grid">{rows.map(row => <article className="prod-panel prod-team-card" key={row.team || 'unallocated'}>
      <header><span className="prod-team-icon"><Building2 size={20} /></span><div><h3>{row.teamName}</h3><span><Users size={12} /> {row.employeeCount} employees in period</span></div>{row.team && <Link aria-label={`View ${row.teamName} production`} to={teamLink(row.team)}><ArrowUpRight size={19} /></Link>}</header>
      <div className="prod-team-production"><strong>{duration(row.productionSeconds)}</strong><span>production in selected period</span></div>
      <div className="prod-team-metrics"><span>Tracked <b>{duration(row.actualSeconds)}</b></span><span>Break / Idle <b>{duration(row.breakIdleSeconds)}</b></span><span>Training <b>{duration(row.trainingSeconds)}</b></span></div>
      <div className="prod-team-progress"><div><span>Target achievement</span><strong>{percent(row.achievementPercent)}</strong></div>{row.achievementPercent != null && <progress aria-label={`${row.teamName} target achievement`} max="100" value={Math.max(0, Math.min(100, row.achievementPercent))} />}<small>{duration(row.targetEligibleProductionSeconds)} against {duration(row.expectedSeconds)} expected</small><small>Remaining {duration(row.remainingSeconds)} · Overtime {duration(row.overtimeSeconds)}</small></div>
      <footer><div>{row.billing?.applicable ? <><span>Estimated billing</span>{row.billing.estimates.map(estimate => <strong key={estimate.currency}>{money(estimate.estimatedAmount, estimate.currency)}{!estimate.complete && <small> · Incomplete</small>}</strong>)}</> : <span>Hours only · Billing disabled</span>}</div>{row.team && <Link to={teamLink(row.team)}>View employees <ArrowUpRight size={13} /></Link>}</footer>
    </article>)}</div>
  </section>;
}
