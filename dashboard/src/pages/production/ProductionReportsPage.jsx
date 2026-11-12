import { useEffect, useState } from 'react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import ProductionWorkFilters from '../../components/production/ProductionWorkFilters';
import { getProductionReportTable, authorizeProductionExport } from '../../api/productionApi';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { productionDates, productionWarnings } from '../../utils/production';
import { productionReportCell, reportDataHash, exportProductionExcel, exportProductionPdf } from '../../utils/productionExport';
import { productionReportView } from '../../utils/productionViews';
import '../../styles/production.css';

const types = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', employee: 'Employee', team: 'Team', client: 'Client & project', task: 'Task', details: 'Employee work details' };
const bases = { live: 'Live production estimates', approved: 'Saved approved billing', finalized: 'Original finalized billing', adjustments: 'Recorded historical adjustments', adjusted: 'Finalized billing after adjustments' };
const reportHeadlines = {
  overview: ['Expected', 'Production', 'Remaining target', 'Production achievement'],
  employee: ['Employees', 'Production', 'Remaining target', 'Production achievement'],
  team: ['Employees', 'Expected', 'Production', 'Production achievement'],
  client: ['Production', 'Eligible client work', 'Non-billable production', 'Billable hours'],
  task: ['Tracked', 'Production', 'Training', 'Break / Idle'],
  details: ['Tracked', 'Production', 'Training', 'Break / Idle'],
};
export default function ProductionReportsPage() {
  const [from, to] = productionDates('today');
  const [draft, setDraft] = useState({ basis: 'live', type: 'daily', period: 'today', startDate: from, endDate: to, team: 'all', employee: 'all', client: 'all', project: 'all', task: 'all' });
  const [query, setQuery] = useState(() => ({ ...draft })), [report, setReport] = useState(null), [page, setPage] = useState(1);
  const [choices, setChoices] = useState({ teams: [], employees: [], clients: [], projects: [], tasks: [] });
  const [loading, setLoading] = useState(true), [exporting, setExporting] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setReport(null); setPage(1);
    getProductionReportTable(query, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      // Preserve the exact signed data separately; translated UI warnings must
      // not change the exported snapshot or its integrity hash.
      setReport({ ...value, uiWarnings: value.data.warnings.map(row => ({ ...row, message: productionWarnings[row.code] || row.code })) });
      if (value.choices) setChoices(previous => ({ ...value.choices,
        ...Object.fromEntries([['clients', 'client'], ['projects', 'project'], ['tasks', 'task']].map(([plural, singular]) => {
          const rows = value.choices[plural], selected = previous[plural].find(row => row._id === query[singular]);
          return [plural, selected && !rows.some(row => row._id === selected._id) ? [...rows, selected] : rows];
        })) }));
    }).catch(error => { if (!controller.signal.aborted) setError(getApiErrorMessage(error, 'Unable to prepare this report.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query]);
  const update = (key, value) => setDraft(previous => ({ ...previous, [key]: value,
    ...(key === 'team' ? { employee: 'all' } : {}), ...(key === 'basis' && value !== 'live' ? { client: 'all', project: 'all', task: 'all' } : {}) }));
  const generate = event => { event.preventDefault(); setQuery({ ...draft }); };
  const pending = JSON.stringify(draft) !== JSON.stringify(query);
  const exportFile = async format => {
    setExporting(true); setError('');
    try {
      const permission = await authorizeProductionExport(report.exportToken, format);
      if (await reportDataHash(report.data) !== permission.dataHash || permission.dataHash !== report.dataHash) throw new Error('Report values changed. Generate the report again.');
      await (format === 'excel' ? exportProductionExcel : exportProductionPdf)(report.data);
    } catch (error) {
      if (error.response?.status === 403) setReport(null);
      setError(getApiErrorMessage(error, error.message || 'Unable to export the report.'));
    } finally { setExporting(false); }
  };
  const data = report?.data, pages = Math.max(1, Math.ceil((data?.rows.length || 0) / 25));
  const headline = data?.summary.filter(row => data.basis === 'live'
    ? reportHeadlines[productionReportView(query.type)].includes(row.label) || (row.type === 'money' && ['employee', 'client'].includes(query.type))
    : row.type === 'money' || ['Saved periods', 'Adjustments', 'Eligible work'].includes(row.label)) || [];
  return <DashboardLayout title="Production reports"><section className="production-module production-reports">
    <div className="prod-intro"><div><p className="prod-kicker">PRODUCTION REPORTS</p><p>Choose the report and dates, review the totals, then download the same values.</p></div></div>
    <form className="prod-panel prod-filter-form" aria-label="Production report filters" onSubmit={generate}><fieldset disabled={loading || exporting}><div className="prod-filter-grid">
      <label>Report source<select aria-label="Report source" value={draft.basis} onChange={event => update('basis', event.target.value)}>{Object.entries(bases).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {draft.basis === 'live' && <label>Report type<select aria-label="Report type" value={draft.type} onChange={event => update('type', event.target.value)}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    </div>
    <ProductionWorkFilters draft={draft} choices={choices} view={draft.basis === 'live' ? productionReportView(draft.type) : 'saved'} onChange={patch => setDraft(previous => ({ ...previous, ...patch }))} />
    <div className="prod-filter-actions"><span>{pending ? 'Generate the report to apply your changed filters.' : 'Dates and filters apply to both the screen and downloads.'}</span><button className="prod-primary">{loading ? 'Preparing…' : 'Generate report'}</button></div></fieldset></form>
    {loading && <p className="prod-status" role="status">Preparing report…</p>}
    {error && <p className="prod-error" role="alert">{error}</p>}
    {data && !loading && <>
      <div className="prod-summary-grid" aria-label="Report summary">{headline.map(row => <article className="prod-panel prod-card" key={row.label}><span>{row.label}</span><strong>{productionReportCell(row.value, row)}</strong></article>)}</div>
      <section className="prod-panel"><div className="prod-section-heading"><div><h2>{data.title}</h2><p>{data.basisLabel} · {data.period.startDate} – {data.period.endDate} · {data.period.timezone}</p><p>As of {new Date(data.asOf).toLocaleString()} · Durations are h:mm:ss</p></div>{report.canExport && <div className="prod-export-actions"><button className="prod-secondary" disabled={exporting || pending} onClick={() => exportFile('excel')}>Export Excel</button><button className="prod-primary" disabled={exporting || pending} onClick={() => exportFile('pdf')}>Export PDF</button></div>}</div>
        <div className="prod-table-wrap"><table className="prod-table" aria-label="Production report data"><thead><tr>{data.columns.map(col => <th key={col.key}>{col.label}</th>)}</tr></thead><tbody>{data.rows.slice((page - 1) * 25, page * 25).map((row, index) => <tr key={index}>{row.map((value, columnIndex) => <td key={columnIndex}>{productionReportCell(value, data.columns[columnIndex])}</td>)}</tr>)}</tbody></table></div>
        {!data.rows.length && <p className="prod-empty">No records match these filters.</p>}
        <div className="prod-pagination"><span>{data.rows.length} rows · Page {page} of {pages} · Downloads include every report row.</span><div><button className="prod-secondary" disabled={page === 1 || exporting} onClick={() => setPage(value => value - 1)}>Previous</button><button className="prod-secondary" disabled={page === pages || exporting} onClick={() => setPage(value => value + 1)}>Next</button></div></div>
      </section>
      <details className="prod-panel prod-settings-form"><summary>Full report totals</summary><table className="prod-table" aria-label="Full report totals"><tbody>{data.summary.map(row => <tr key={row.label}><th>{row.label}</th><td>{productionReportCell(row.value, row)}</td></tr>)}</tbody></table></details>
      {!!report.uiWarnings.length && <div className="prod-warning"><strong>Review items</strong><ul>{report.uiWarnings.map(row => <li key={row.code}>{row.message} ({row.count})</li>)}</ul></div>}
      <div className="prod-footnote">{data.notes.map(note => <p key={note}>{note}</p>)}</div>
    </>}
  </section></DashboardLayout>;
}
