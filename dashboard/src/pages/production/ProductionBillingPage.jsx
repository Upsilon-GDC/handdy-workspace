import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import LegacyProductionBillingPage from './LegacyProductionBillingPage';
import { getProduction, getProductionReportTable, authorizeProductionExport } from '../../api/productionApi';
import { productionDates } from '../../utils/production';
import { billingPeriodDates } from '../../utils/billingReviewGroups';
import { productionReportCell, reportDataHash, exportProductionExcel } from '../../utils/productionExport';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import '../../styles/production.css';

function TeamWorkReport() {
  const [from, to] = productionDates('month');
  const [draft, setDraft] = useState({ team: '', period: 'this-month', startDate: from, endDate: to });
  const [teams, setTeams] = useState([]), [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    getProduction({ startDate: from, endDate: to, view: 'team', limit: 1 }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setTeams(value.choices.teams); })
      .catch(error => { if (!controller.signal.aborted) setError(getApiErrorMessage(error)); });
    return () => controller.abort();
  }, [from, to]);
  const change = patch => { setDraft(previous => ({ ...previous, ...patch })); setReport(null); setError(''); };
  const generate = async event => {
    event.preventDefault(); setLoading(true); setReport(null); setError('');
    try { setReport(await getProductionReportTable({ basis: 'live', type: 'employee', team: draft.team, employee: 'all', startDate: draft.startDate, endDate: draft.endDate })); }
    catch (error) { setError(getApiErrorMessage(error)); }
    finally { setLoading(false); }
  };
  const download = async () => {
    setExporting(true); setError('');
    try {
      const permission = await authorizeProductionExport(report.exportToken, 'excel');
      if (await reportDataHash(report.data) !== permission.dataHash || permission.dataHash !== report.dataHash) throw Error('Generate the report again before downloading.');
      await exportProductionExcel(report.data);
    } catch (error) { setError(error.isAxiosError ? getApiErrorMessage(error) : error.message); }
    finally { setExporting(false); }
  };
  const data = report?.data;
  const columns = data?.columns.filter(column => ['fullName', 'actualSeconds', 'productionSeconds', 'trainingSeconds', 'breakIdleSeconds', 'billableSeconds'].includes(column.key) || column.type === 'money') || [];
  const summary = data?.summary.filter(row => ['Tracked', 'Production', 'Break / Idle'].includes(row.label) || row.type === 'money') || [];
  return <DashboardLayout title="Billing management"><section className="production-module production-billing">
    <form className="prod-panel prod-filter-form" aria-label="Team work report filters" onSubmit={generate}><fieldset disabled={loading || exporting}>
      <div className="prod-filter-grid">
        <label>Team<select aria-label="Report team" required value={draft.team} onChange={event => change({ team: event.target.value })}><option value="">Choose a team</option>{teams.map(team => <option key={team._id} value={team._id}>{team.teamName}</option>)}</select></label>
        <label>Period<select aria-label="Report period" value={draft.period} onChange={event => change({ period: event.target.value, ...(event.target.value === 'custom' ? {} : { startDate: billingPeriodDates(event.target.value)[0], endDate: billingPeriodDates(event.target.value)[1] }) })}>{[['today', 'Today'], ['yesterday', 'Yesterday'], ['this-week', 'This week'], ['this-month', 'This month'], ['last-month', 'Last month'], ['custom', 'Custom dates']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>From date<input aria-label="Report from date" type="date" required value={draft.startDate} onChange={event => change({ startDate: event.target.value, period: 'custom' })} /></label>
        <label>To date<input aria-label="Report to date" type="date" required min={draft.startDate} value={draft.endDate} onChange={event => change({ endDate: event.target.value, period: 'custom' })} /></label>
      </div><div className="prod-filter-actions"><button className="prod-primary" disabled={!draft.team}>{loading ? 'Loading...' : 'View report'}</button></div>
    </fieldset></form>
    {error && <p className="prod-error" role="alert">{error}</p>}
    {data && <><div className="prod-summary-grid">{summary.map(row => <article className="prod-panel prod-card" key={row.label}><span>{row.label}</span><strong>{productionReportCell(row.value, row)}</strong></article>)}</div>
      <section className="prod-panel" aria-label="Team work report"><div className="prod-section-heading"><div><h2>{data.selection.team}</h2><p>{data.period.startDate} to {data.period.endDate}</p></div>{report.canExport && <button className="prod-primary" disabled={exporting} onClick={download}>{exporting ? 'Downloading...' : 'Download Excel'}</button>}</div>
        <div className="prod-table-wrap"><table className="prod-table"><thead><tr>{columns.map(column => <th key={column.key}>{column.key === 'fullName' ? 'Employee' : column.label.replace(' (h:mm:ss)', '')}</th>)}</tr></thead><tbody>{data.rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column.key}>{productionReportCell(row[data.columns.findIndex(value => value.key === column.key)], column)}</td>)}</tr>)}</tbody></table></div>
        {!data.rows.length && <p className="prod-settings-form">No work found for this team and period.</p>}
        <p className="prod-settings-form prod-muted">Excel includes employee totals and task details. Billing amounts are current estimates.</p>
      </section></>}
  </section></DashboardLayout>;
}

export default function ProductionBillingPage() {
  const [params] = useSearchParams();
  // Preserve existing saved-report links; the main page is read-only reporting.
  return params.has('id') || params.get('history') === '1' ? <LegacyProductionBillingPage /> : <TeamWorkReport />;
}
