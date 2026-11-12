import ProductionWorkFilters from '../../components/production/ProductionWorkFilters';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { getProduction } from '../../api/productionApi';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { productionDates, productionDuration as duration, productionPercent as percentage, productionMoney as money, productionWarnings } from '../../utils/production';
import { productionViews, productionColumnLabels } from '../../utils/productionViews';
import '../../styles/production.css';

const pages = {
  overview: ['Production overview', 'See working hours, targets and production in one place.'],
  employee: ['Employee production', 'Compare employee progress or open an employee to see their work.'],
  team: ['Team production', 'Compare team progress or open a team to see its employees.'],
  client: ['Client & project production', 'See where client and project work is being completed.'],
  task: ['Task production', 'See production and excluded time for each task.'],
  details: ['Employee work details', 'Daily work grouped by client, project and task.'],
};
function filtersFrom(params) {
  const [startDate, endDate] = productionDates('today');
  return { period: params.get('period') || (params.has('startDate') ? 'custom' : 'today'),
    startDate: params.get('startDate') || startDate, endDate: params.get('endDate') || endDate,
    ...Object.fromEntries(['team', 'employee', 'client', 'project', 'task'].map(key => [key, params.get(key) || 'all'])) };
}
function Estimates({ billing }) {
  if (!billing?.applicable) return <span className="prod-muted">Not applicable</span>;
  return <div className="prod-estimates">{billing.estimates?.map(row => <span key={row.currency}>{money(row.estimatedAmount, row.currency)}{!row.complete && <small>Incomplete estimate</small>}</span>)}</div>;
}
function ProductionPage({ view = 'overview' }) {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => filtersFrom(params));
  const [query, setQuery] = useState(() => ({ ...draft, page: 1 }));
  const [report, setReport] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [choices, setChoices] = useState({ employees: [], teams: [], clients: [], projects: [], tasks: [] });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const next = filtersFrom(params);
    setDraft(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    setQuery(previous => Object.entries(next).every(([key, value]) => previous[key] === value) ? previous : { ...next, page: 1 });
  }, [params]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    getProduction({ ...query, view, limit: 25, includeChoices: query.page === 1 }, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setReport({ ...data, warnings: data.warnings.filter(row => row.code !== 'team-inferred-from-current-relationships') });
      if (data.choices) setChoices(previous => ({ ...data.choices,
        ...Object.fromEntries([['clients', 'client'], ['projects', 'project'], ['tasks', 'task']].map(([plural, singular]) => {
          const rows = data.choices[plural], selected = previous[plural].find(row => row._id === query[singular]);
          return [plural, selected && !rows.some(row => row._id === selected._id) ? [...rows, selected] : rows];
        })) }));
    }).catch(error => {
      if (!controller.signal.aborted) setError(getApiErrorMessage(error, 'Unable to load Production.'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, view, reload]);
  const apply = event => {
    event.preventDefault(); setReport(null); setQuery({ ...draft, page: 1 });
    setParams(draft, { replace: true });
  };
  const drillTo = (path, overrides) => `${path}?${new URLSearchParams({ ...query, ...overrides, page: 1 })}`;
  const summary = report?.summary, billing = summary?.billing?.applicable === true;
  const [title, description] = pages[view];
  const layout = productionViews[view];
  const cards = summary ? {
    employees: ['Employees', String(summary.employeeCount)], teams: ['Teams compared', String(report.total)],
    clientProjects: ['Client / project groups', String(report.total)], tasks: ['Tasks reviewed', String(report.total)],
    expected: ['Expected hours', duration(summary.expectedSeconds)], tracked: ['Tracked hours', duration(summary.actualSeconds)],
    production: ['Production hours', duration(summary.productionSeconds)], achievement: ['Achievement', percentage(summary.achievementPercent)],
    remaining: ['Remaining target', duration(summary.remainingSeconds)], eligible: ['Eligible client work', duration(summary.eligibleClientWorkSeconds)],
    nonBillable: ['Non-billable production', duration(summary.nonBillableProductiveSeconds)], training: ['Training', duration(summary.trainingSeconds)],
    breakIdle: ['Break / Idle', duration(summary.breakIdleSeconds)],
  } : {};
  const showMoneyCard = billing && ['overview', 'client'].includes(view);
  const identity = row => view === 'overview' ? row.date : view === 'employee'
    ? <Link to={drillTo('/admin/production/employee/details', { employee: row.employee })}>{row.fullName}<small>{row.employeeId} · {row.teamName}</small></Link>
    : view === 'team' ? row.team ? <Link to={drillTo('/admin/production/employee', { team: row.team, employee: 'all' })}>{row.teamName}</Link> : row.teamName
    : view === 'client' ? <Link to={drillTo('/admin/production/employee', { client: row.client || 'all', project: row.project })}>{row.clientName}<small>{row.projectName}</small></Link>
    : <Link to={drillTo('/admin/production/employee', { task: row.task })}>{row.taskName}</Link>;
  const visible = report && !loading && !error;
  return <DashboardLayout title={title}><section className="production-module" data-production-view={view}>
    <div className="prod-intro"><div><p className="prod-kicker">PRODUCTION</p><p>{description}</p></div>{report?.scope.canConfigure && <Link className="prod-secondary" to="/admin/production/settings">Production settings</Link>}</div>
    <form className="prod-panel prod-filter-form" onSubmit={apply} aria-label="Production filters">
      <h2 className="prod-filter-title">{layout.title}</h2><p className="prod-filter-hint">{layout.hint}</p>
      <fieldset disabled={loading}>
        <ProductionWorkFilters view={view} draft={draft} choices={choices} personal={report?.scope.mode === 'personal'} onChange={patch => setDraft(previous => ({ ...previous, ...patch }))} />
      <div className="prod-filter-actions"><span>{report?.scope.mode === 'assigned' ? 'Your assigned teams and employees' : report?.scope.mode === 'personal' ? 'Your personal production' : 'Production within your authorized access'}</span><button className="prod-primary" type="submit">{loading ? 'Loading…' : 'Apply filters'}</button></div></fieldset>
    </form>
    {loading && <p className="prod-status" role="status">Loading production…</p>}
    {error && <div className="prod-error" role="alert">{error}<button className="prod-secondary" onClick={() => setReload(value => value + 1)}>Try again</button></div>}
    {visible && <>
      <div className="prod-summary-grid" aria-label="Production summary">{layout.cards.map(key => cards[key]).map(([label, value]) => <article className="prod-panel prod-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}
      {showMoneyCard && <article className="prod-panel prod-card prod-money-card"><span>Estimated billing</span><Estimates billing={summary.billing} /><small>Provisional · not approved</small></article>}</div>
      {report.warnings.length > 0 && <details className="prod-warning" open={report.warnings.some(row => row.code !== 'team-inferred-from-current-relationships')}><summary>{report.warnings.length} item{report.warnings.length === 1 ? '' : 's'} to review</summary><ul>{report.warnings.map(row => <li key={row.code}>{productionWarnings[row.code] || 'Some records need review.'} <strong>({row.count})</strong></li>)}</ul>{report.scope.canConfigure && <Link to="/admin/production/settings">Open production settings</Link>}</details>}
      <section className="prod-panel"><div className="prod-section-heading"><div><h2>{view === 'details' ? 'Daily work details' : title}</h2><p>{report.period.startDate} – {report.period.endDate} · {report.period.timezone}</p></div><span className="prod-badge">Provisional</span></div>
        <div className="prod-table-wrap"><table className="prod-table" aria-label={view === 'details' ? 'Employee work details' : title}><thead><tr>
          {view === 'details' ? <><th>Date</th><th>Client / project</th><th>Task</th><th>Team</th><th>Activity</th><th>Tracked</th><th>Production</th>{billing && <><th>Billing status</th><th>Rate</th></>}</>
            : <><th>{({ overview: 'Date', employee: 'Employee', team: 'Team', client: 'Client / project', task: 'Task' })[view]}</th>{layout.columns.map(key => <th key={key}>{productionColumnLabels[key]}</th>)}{billing && ['employee', 'client'].includes(view) && <><th>Billable</th><th>Estimated billing</th></>}</>}
        </tr></thead><tbody>{report.rows.map((row, index) => <tr key={`${row.employee || row.team || row.task || row.client || row.date || ''}-${index}`}>
          {view === 'details' ? <><td>{row.date}</td><td>{row.clientName}<small>{row.projectName}</small></td><td>{row.taskName}</td><td>{row.teamName}</td><td><span className="prod-category">{row.category === 'break-idle' ? 'Break / Idle' : row.category}</span></td><td>{duration(row.actualSeconds)}</td><td>{duration(row.productionSeconds)}</td>{billing && <><td>{row.billing?.applicable ? ({ estimated: 'Estimated', 'missing-rate': 'Missing Rate', 'currency-mismatch': 'Currency mismatch', 'not-billable': 'Non-billable' })[row.billing.status] : 'Not applicable'}</td><td>{row.billing?.rateHundredths ? `${money(row.billing.rateHundredths / 100, row.billing.currency)} / hour` : '—'}</td></>}</>
            : <><td>{identity(row)}</td>{layout.columns.map(key => <td key={key} className={key === 'productionSeconds' ? 'prod-emphasis' : undefined}>{key === 'employeeCount' ? row[key] : key === 'achievementPercent' ? percentage(row[key]) : duration(row[key])}</td>)}{billing && ['employee', 'client'].includes(view) && <><td>{row.billing?.applicable ? duration(row.billing.billableSeconds) : 'Not applicable'}</td><td><Estimates billing={row.billing} /></td></>}</>}
        </tr>)}</tbody></table></div>
        {report.rows.length === 0 && <div className="prod-empty"><h3>No work found for these filters</h3><p>Choose another period or adjust your selections.</p></div>}
        <div className="prod-pagination"><span>{report.total} record{report.total === 1 ? '' : 's'} · Page {report.page} of {Math.max(1, Math.ceil(report.total / report.limit))}</span><div><button className="prod-secondary" disabled={query.page <= 1} onClick={() => setQuery(previous => ({ ...previous, page: previous.page - 1 }))}>Previous</button><button className="prod-secondary" disabled={query.page * report.limit >= report.total} onClick={() => setQuery(previous => ({ ...previous, page: previous.page + 1 }))}>Next</button></div></div>
      </section>
      <p className="prod-footnote">{['overview', 'employee', 'team'].includes(view)
        ? 'Targets use attendance and employee working-hour settings. Achievement counts production against applicable targets; team targets follow the employee?s home team.'
        : view === 'client' ? 'Client and project totals show productive work. Billing estimates use eligible work and configured rates; they remain provisional until approved and finalized.'
        : view === 'task' ? 'Task totals separate productive work, training and Break / Idle. Open a task to see the employees who worked on it.'
        : 'Entries show the selected employee?s daily work, grouped by client, project, task and activity.'} Updated {new Date(report.asOf).toLocaleTimeString()}.</p>
      {view === 'details' && <Link to={drillTo('/admin/production/employee', { employee: 'all' })}>Back to employees</Link>}
    </>}
  </section></DashboardLayout>;
}
export default ProductionPage;
