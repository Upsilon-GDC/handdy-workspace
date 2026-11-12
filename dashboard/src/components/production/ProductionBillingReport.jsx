import { CalendarRange, Clock3, FolderKanban, ReceiptText, UsersRound } from 'lucide-react';
import { billingReviewGroups, billingLineTotals } from '../../utils/billingReviewGroups';
import { productionDuration as duration, productionMoney as money } from '../../utils/production';

function Amounts({ values }) {
  if (!values.length) return <span className="prod-muted">Amounts restricted or not applicable</span>;
  return <>{values.map(row => <span key={row.currency}>{money(row.amount, row.currency)}{!row.complete && <small className="billing-missing-rate">Incomplete subtotal</small>}</span>)}</>;
}
export default function ProductionBillingReport({ review, children, reviewPanel }) {
  const data = review.data, { projects, days } = billingReviewGroups(data.workDetails);
  const eligible = data.summary.find(row => row.label === 'Eligible work')?.value || 0;
  const amounts = data.summary.filter(row => row.type === 'money');
  const financial = review.items.some(row => row.financialAccess);
  const captured = field => review.items.every(row => Number.isFinite(row.snapshot.summary[field])) ? review.items.reduce((sum, row) => sum + row.snapshot.summary[field], 0) : null;
  const time = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: data.period.timezone });
  return <>
    <section className="billing-summary-grid" aria-label="Billing report summary">
      <article className="prod-panel"><UsersRound size={20} /><span>Team / employees</span><strong>{data.selection.team}</strong><small>{review.items.length} employees</small></article>
      <article className="prod-panel"><CalendarRange size={20} /><span>Selected period</span><strong>{data.period.startDate} to {data.period.endDate}</strong><small>{days.length} days with eligible work</small></article>
      <article className="prod-panel"><Clock3 size={20} /><span>Billable task hours</span><strong>{duration(eligible)}</strong><small>{projects.length} project / client groups</small></article>
      {captured('breakIdleSeconds') !== null && <article className="prod-panel break-card"><Clock3 size={20} /><span>Break / Idle</span><strong>{duration(captured('breakIdleSeconds'))}</strong><small>Excluded from billing</small></article>}
      {captured('actualSeconds') !== null && <article className="prod-panel total-card"><Clock3 size={20} /><span>Total tracked</span><strong>{duration(captured('actualSeconds'))}</strong><small>Includes non-billable activities</small></article>}
      {financial && <article className="prod-panel billing-amount-card"><ReceiptText size={20} /><span>Saved billable amount</span><strong>{amounts.length ? amounts.map(row => <span key={row.currency}>{money(row.value, row.currency)}</span>) : 'Not applicable'}</strong><small>Saved estimates; original values for finalized periods</small></article>}
    </section>
    {children}
    {reviewPanel}
    <section className="billing-report prod-panel" aria-label="Project-wise billing summary"><header><div><span>Primary report</span><h3>Project-wise task summary</h3></div><strong>{duration(eligible)}</strong></header>
      {!projects.length && <p className="billing-no-data">No eligible billable work in these saved periods. Check the employee review items below.</p>}
      {projects.map(project => <article className="billing-project" key={project.key}><div className="billing-project-heading"><div><FolderKanban size={18} /><div><h4>{project.name}</h4><p>{project.clientName || 'No client recorded'}</p></div></div><div className="billing-project-totals"><strong>{duration(project.seconds)}</strong>{financial && <Amounts values={project.amounts} />}</div></div>
        <div className="billing-table-wrap"><table><thead><tr><th>Employee</th><th>Task</th><th>Total time</th>{financial && <><th>Hourly rate</th><th>Billable amount</th></>}</tr></thead><tbody>{project.tasks.map(task => <tr key={task.key}><td>{task.employeeName}</td><td><strong>{task.taskName}</strong></td><td>{duration(task.seconds)}</td>{financial && <><td>{task.billing?.rateHundredths ? `${money(task.billing.rateHundredths / 100, task.billing.currency)} / hour` : 'Missing Rate'}</td><td><Amounts values={task.amounts} /></td></>}</tr>)}</tbody></table></div>
      </article>)}
    </section>
    <section className="billing-daily prod-panel" aria-label="Billing daily details"><header><div><span>Audit detail</span><h3>Daily details</h3></div><p>Expand a date to review the saved billable work sessions.</p></header>
      {!days.length && <p className="billing-no-data">No eligible billable sessions in this period.</p>}
      {days.map(day => <details key={day.date}><summary><span className="billing-day-date">{day.date}</span><span className="billing-day-cell"><small>Billable hours</small><strong>{duration(day.seconds)}</strong></span>{financial && <span className="billing-day-cell"><small>Billable amount</small><Amounts values={day.amounts} /></span>}</summary><div className="billing-table-wrap"><table><thead><tr><th>Employee</th><th>Project / client</th><th>Task</th><th>Start</th><th>End</th><th>Time</th>{financial && <><th>Rate</th><th>Amount</th></>}</tr></thead><tbody>{day.lines.map((line, index) => <tr key={index}><td>{line.employeeName}</td><td>{line.projectName}<small>{line.clientName}</small></td><td>{line.taskName}</td><td>{time(line.startedAt)}</td><td>{time(line.stoppedAt)}</td><td>{duration(line.actualSeconds)}</td>{financial && <><td>{line.billing?.rateHundredths ? money(line.billing.rateHundredths / 100, line.billing.currency) : 'Missing Rate'}</td><td><Amounts values={billingLineTotals([line])} /></td></>}</tr>)}</tbody></table></div></details>)}
    </section>
    <p className="prod-footnote">Training, excluded activities and Break / Idle do not contribute to billing. Project and daily subtotals use interval precision; independently rounded subtotals may differ from saved employee totals.</p>
  </>;
}
