import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { getProduction, getProductionBilling, prepareProductionBillingReview, getProductionBillingReview, authorizeProductionExport, getProductionBillingPeriod, actOnProductionBilling, previewProductionAdjustment } from '../../api/productionApi';
import { exportProductionExcel, reportDataHash } from '../../utils/productionExport';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { productionTeamEmployees, productionDates, productionDuration as duration, productionMoney as money } from '../../utils/production';
import ProductionBillingReport from '../../components/production/ProductionBillingReport';
import BillingBulkActions from '../../components/production/BillingBulkActions';
import { billingBlockerMessages } from '../../utils/billingPreparation';
import { billingPeriodDates } from '../../utils/billingReviewGroups';
import '../../styles/billingPage.css';
import '../../styles/production.css';

const blockers = billingBlockerMessages;
const labels = { refresh: 'Refresh estimate', submit: 'Submit for review', approve: 'Approve', reject: 'Reject', finalize: 'Finalize billing' };
function Amounts({ billing }) {
  if (!billing?.applicable) return <span className="prod-muted">Not applicable</span>;
  return <div className="prod-estimates">{billing.estimates?.map(row => <span key={row.currency}>{money(row.estimatedAmount, row.currency)} {!row.complete && <small>Incomplete estimate</small>}</span>)}</div>;
}
export default function LegacyProductionBillingPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const reviewIds = params.get('review') || '';
  const [bulkResult, setBulkResult] = useState(null);
  const [review, setReview] = useState(null), [reviewLoading, setReviewLoading] = useState(false), [exporting, setExporting] = useState(false);
  const [startDate, endDate] = productionDates('today');
  const [draft, setDraft] = useState({ team: '', employee: '', period: 'today', startDate, endDate, reason: '' });
  const [otherTeams, setOtherTeams] = useState(false);
  const [choices, setChoices] = useState({ teams: [], employees: [] }), [listing, setListing] = useState(null), [details, setDetails] = useState(null);
  const [query, setQuery] = useState({ status: 'all', team: 'all', employee: 'all', page: 1 });
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [note, setNote] = useState(''), [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState(null), [checked, setChecked] = useState([]), [linePage, setLinePage] = useState(1), [entryPage, setEntryPage] = useState(1);
  const request = useRef(null), createRequest = useRef(crypto.randomUUID());
  const reviewRef = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) return () => controller.abort();
    getProduction({ startDate: draft.startDate, endDate: draft.endDate, view: 'employee', limit: 1 }, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setChoices(data.choices);
      setDraft(previous => previous.team && !data.choices.teams.some(team => team._id === previous.team && team.billingEnabled)
        ? { ...previous, team: '', employee: '' } : previous);
    })
      .catch(error => { if (!controller.signal.aborted) setError(getApiErrorMessage(error)); });
    return () => controller.abort();
  }, [draft.startDate, draft.endDate]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getProductionBilling({ ...query, limit: 25 }, controller.signal).then(setListing).catch(error => {
      if (!controller.signal.aborted) { setListing(null); setError(getApiErrorMessage(error)); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, refresh]);
  useEffect(() => {
    setDetails(null); setPreview(null); setChecked([]); setNote(''); setLinePage(1); setEntryPage(1);
    if (!selectedId) return;
    const controller = new AbortController(); setDetailLoading(true);
    getProductionBillingPeriod(selectedId, controller.signal).then(setDetails).catch(error => { if (!controller.signal.aborted) setError(getApiErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, refresh]);
  useEffect(() => {
    setReview(null);
    if (!reviewIds) { setReviewLoading(false); return; }
    const controller = new AbortController(); setReviewLoading(true);
    getProductionBillingReview(reviewIds.split(','), controller.signal).then(value => { if (!controller.signal.aborted) setReview(value); })
      .catch(error => { if (!controller.signal.aborted) setError(getApiErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setReviewLoading(false); });
    return () => controller.abort();
  }, [reviewIds, refresh]);
  const open = id => { setError(''); setMessage(''); setParams({ history: '1', ...(reviewIds ? { review: reviewIds } : {}), ...(id ? { id } : {}) }, { replace: true }); };
  const downloadReview = async () => {
    setExporting(true); setError('');
    try {
      const permission = await authorizeProductionExport(review.exportToken, 'excel');
      if (await reportDataHash(review.data) !== permission.dataHash || permission.dataHash !== review.dataHash) throw new Error('Reload the review report before downloading.');
      await exportProductionExcel(review.data);
    } catch (error) { if (error.response?.status === 403) setReview(null); setError(getApiErrorMessage(error, error.message || 'Unable to download the review report.')); }
    finally { setExporting(false); }
  };
  const create = async event => {
    event.preventDefault(); setBulkResult(null); setBusy(true); setError(''); setMessage('');
    try { const result = await prepareProductionBillingReview({ ...draft, reason: draft.reason.trim() || 'Prepare billing review report', requestId: createRequest.current }); createRequest.current = crypto.randomUUID(); setParams({ history: '1', review: result.ids.join(','), ...(result.ids.length === 1 ? { id: result.ids[0] } : {}) }, { replace: true }); setRefresh(value => value + 1); setMessage(`Prepared ${result.ids.length} employee ${result.ids.length === 1 ? 'period' : 'periods'} for review. Resolve any review items before submitting.`); }
    catch (error) { setError(getApiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const batch = details?.batch;
  useEffect(() => { if (batch?._id) reviewRef.current?.scrollIntoView({ block: 'start' }); }, [batch?._id]);
  const act = async (action, extra = {}) => {
    if (note.trim().length < 3) { setError('Add a review note of at least 3 characters.'); return; }
    const body = { action, expectedVersion: batch.version, reason: note.trim(), ...extra };
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true); setError(''); setMessage('');
    try { await actOnProductionBilling(batch._id, { ...body, requestId: request.current.requestId }); request.current = null; setRefresh(value => value + 1); setMessage(action === 'recalculate' ? 'Historical adjustment recorded. The original finalized values are unchanged.' : `Saved: ${action === 'verify-allocations' ? 'team assignments verified and estimate refreshed' : labels[action]}.`); }
    catch (error) { setError(getApiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const previewAdjustment = async () => {
    setBusy(true); setError('');
    try { setPreview(await previewProductionAdjustment(batch._id)); }
    catch (error) { setPreview(null); setError(getApiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const reviewTeam = listing?.access.admin || listing?.access.reviewTeamIds.includes(draft.team);
  const allowedEmployees = choices.employees.filter(row => row.isActive !== false && (reviewTeam || row._id === listing?.access.self));
  const createEmployees = draft.team ? otherTeams ? allowedEmployees : productionTeamEmployees(allowedEmployees, draft.team) : [];
  const inputDraft = (field, value) => { createRequest.current = crypto.randomUUID(); setDraft(previous => ({ ...previous, [field]: value, ...(['startDate', 'endDate'].includes(field) ? { period: 'custom' } : {}), ...(field === 'period' && value !== 'custom' ? { startDate: billingPeriodDates(value)[0], endDate: billingPeriodDates(value)[1] } : {}) })); };
  const unverified = batch?.snapshot.entries.filter(row => !row.verified) || [];
  const entryRows = unverified.slice((entryPage - 1) * 25, entryPage * 25);
  const amounts = batch?.snapshot.summary.billing;
  const actions = batch?.allowedActions || [];
  const billingReview = batch && !detailLoading && <section ref={reviewRef} className="prod-panel prod-billing-review" aria-label="Billing review">
      <div className="prod-section-heading"><div><h2>{batch.snapshot.employeeName} · {batch.snapshot.teamName}</h2><p>{batch.startDate} – {batch.endDate} · revision {batch.version}</p></div><span className={`prod-billing-status is-${batch.status.toLowerCase()}`}>{batch.status}</span></div>
      <div className="prod-billing-summary"><div><span>Eligible client work</span><strong>{duration(batch.snapshot.summary.eligibleClientWorkSeconds)}</strong></div>{batch.financialAccess && <div><span>{batch.status === 'Finalized' ? 'Original finalized billing' : batch.status === 'Approved' ? 'Approved estimate' : 'Saved estimate'}</span><Amounts billing={amounts} /></div>}<p>Saved {new Date(batch.snapshot.capturedAt).toLocaleString()}. {batch.status === 'Finalized' ? 'Original values are preserved.' : 'Refresh the draft after changing work or billing settings.'}</p></div>
      {!!batch.snapshot.blockers.length && <div className="prod-warning"><strong>Before submitting</strong><ul>{batch.snapshot.blockers.map(code => <li key={code}>{blockers[code] || code}</li>)}</ul></div>}
      {!reviewIds && <><div className="prod-settings-form"><label>Review note (required)<textarea aria-label="Review note" value={note} maxLength={500} rows={1} onChange={event => setNote(event.target.value)} placeholder="Explain the submission, review or adjustment…" /></label><div className="prod-billing-actions">
        {checked.length > 0 && actions.includes('verify-allocations') && <button className="prod-secondary" disabled={busy || note.trim().length < 3} onClick={() => act('verify-allocations', { verificationHash: batch.verificationHash, allocations: batch.snapshot.entries.filter(row => checked.includes(row.timeLog)).map(row => ({ timeLog: row.timeLog, expectedVersion: row.allocationVersion })) })}>Verify selected entries & refresh</button>}
        {Object.entries(labels).filter(([action]) => actions.includes(action)).map(([action, label]) => <button key={action} className={['reject', 'refresh'].includes(action) ? 'prod-secondary' : 'prod-primary'} disabled={busy || note.trim().length < 3 || (['submit', 'approve', 'finalize'].includes(action) && batch.snapshot.blockers.length > 0)} onClick={() => act(action)}>{label}</button>)}
        {actions.includes('recalculate') && <button className="prod-secondary" disabled={busy} onClick={previewAdjustment}>Preview historical adjustment</button>}
      </div></div>
      {!!unverified.length && actions.includes('verify-allocations') && <details className="prod-settings-form" open><summary>Verify team assignments ({unverified.length})</summary><p>Review these entries before assigning them to {batch.snapshot.teamName}. Only selected entries will be verified.</p><div className="prod-entry-select-all"><button type="button" className="prod-secondary" disabled={busy} onClick={() => setChecked(unverified.map(row => row.timeLog))}>Select all task entries ({unverified.length})</button><button type="button" className="prod-secondary" disabled={busy || !checked.length} onClick={() => setChecked([])}>Clear task selection</button><span>{checked.length} selected across all pages</span></div><div className="prod-table-wrap prod-assignment-scroll"><table className="prod-table" aria-label="Team assignment review"><thead><tr><th>Select</th><th>Work</th><th>Started</th></tr></thead><tbody>{entryRows.map(row => <tr key={row.timeLog}><td><input type="checkbox" aria-label={`Verify ${row.taskName} ${row.startedAt}`} checked={checked.includes(row.timeLog)} onChange={event => setChecked(previous => event.target.checked ? [...previous, row.timeLog] : previous.filter(value => value !== row.timeLog))} /></td><td>{row.taskName}<small>{row.projectName}</small></td><td>{new Date(row.startedAt).toLocaleString()}</td></tr>)}</tbody></table></div><div className="prod-pagination"><span>{checked.length} selected</span><div><button className="prod-secondary" disabled={entryPage === 1} onClick={() => setEntryPage(value => value - 1)}>Previous entries</button><button className="prod-secondary" disabled={entryPage * 25 >= unverified.length} onClick={() => setEntryPage(value => value + 1)}>Next entries</button></div></div></details>}
      </>}
      <details className="prod-billable-details"><summary>Billable work ({batch.lineCount})</summary>
      <div className="prod-table-wrap"><table className="prod-table" aria-label="Billable work"><thead><tr><th>Date</th><th>Client / project</th><th>Task</th><th>Hours</th>{batch.financialAccess && <th>Applicable rate</th>}</tr></thead><tbody>{batch.snapshot.lines.slice((linePage - 1) * 25, linePage * 25).map((row, index) => <tr key={`${row.startedAt}-${index}`}><td>{row.date}</td><td>{row.clientName}<small>{row.projectName}</small></td><td>{row.taskName}</td><td>{duration(row.actualSeconds)}</td>{batch.financialAccess && <td>{row.billing?.rateHundredths ? `${money(row.billing.rateHundredths / 100, row.billing.currency)} / hour` : 'Missing Rate'}</td>}</tr>)}</tbody></table></div>
      <div className="prod-pagination"><span>{batch.lineCount} billable intervals · Page {linePage}</span><div><button className="prod-secondary" disabled={linePage === 1} onClick={() => setLinePage(value => value - 1)}>Earlier work</button><button className="prod-secondary" disabled={linePage * 25 >= batch.lineCount} onClick={() => setLinePage(value => value + 1)}>More work</button></div></div>
      </details>
      {preview && <div className="prod-settings-form prod-adjustment-preview"><h3>Historical adjustment preview</h3><p>The original finalized billing will stay unchanged. These changes will be recorded separately.</p>{preview.deltas.map(row => <p key={row.currency}><strong>{row.currency}: {row.amount > 0 ? '+' : ''}{money(row.amount, row.currency)}</strong></p>)}<button className="prod-primary" disabled={busy || note.trim().length < 3 || preview.version !== batch.version} onClick={() => act('recalculate', { previewHash: preview.previewHash })}>Record historical adjustment</button></div>}
      {details.adjustedTotals && <div className="prod-settings-form"><h3>Billing after recorded adjustments</h3>{details.adjustedTotals.map(row => <p key={row.currency}>{money(row.amount, row.currency)}</p>)}</div>}
      {!!details.adjustments.length && <details className="prod-settings-form"><summary>Recent historical adjustments (up to 100)</summary><ul>{details.adjustments.map(row => <li key={row._id}>{row.actor?.fullName || 'Unavailable administrator'} · {new Date(row.createdAt).toLocaleString()} · {row.reason}{row.deltas?.map(delta => <small key={delta.currency}> {delta.currency}: {delta.amount > 0 ? '+' : ''}{money(delta.amount, delta.currency)}</small>)}</li>)}</ul></details>}
      <details className="prod-settings-form"><summary>Recent approval and change history (up to 100)</summary><ul>{details.events.map(row => <li key={row._id}>{row.actor?.fullName || 'Unavailable reviewer'} · {row.action} · {row.from} → {row.to} · {new Date(row.createdAt).toLocaleString()}<small>{row.reason}</small></li>)}</ul></details>
    </section>;
  return <DashboardLayout hideHeader title="Billing management"><section className="production-module production-billing billing-page">
    {error && <div className="prod-error" role="alert">{error}<button className="prod-secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Reload</button></div>}
    {bulkResult && <div className={`prod-bulk-result ${bulkResult.failures.length ? 'prod-warning' : 'prod-success'}`} role="status"><strong>{bulkResult.summary}</strong>{bulkResult.failures.length > 0 && <details><summary>{bulkResult.failures.length} employees need attention: view next steps</summary><div className="prod-bulk-result-list">{bulkResult.failures.map(row => <div key={row.id}><strong>{row.employee}</strong><span>{row.message}</span><button type="button" className="prod-secondary" disabled={busy} onClick={() => open(row.id)}>Review employee</button></div>)}</div></details>}</div>}
    {message && <p className="prod-success" role="status">{message}</p>}
    <section className="prod-panel prod-settings-form"><h2>Billing report</h2>
      <form onSubmit={create} aria-label="Prepare billing period"><fieldset disabled={busy || !listing}>
        <div className="billing-filters" aria-label="Billing report filters">
          <label><span>Team</span><select aria-label="Billing team" required value={draft.team} onChange={event => { inputDraft('team', event.target.value); setOtherTeams(false); setDraft(previous => ({ ...previous, employee: '' })); }}><option value="">Choose billing-enabled team</option>{choices.teams.filter(row => row.billingEnabled).map(row => <option key={row._id} value={row._id}>{row.teamName}</option>)}</select></label>
          <label><span>Employee</span><select aria-label="Billing employee" disabled={!draft.team} required value={draft.employee} onChange={event => inputDraft('employee', event.target.value)}><option value="">{draft.team ? 'Choose employees' : 'Choose a team first'}</option>{draft.team && !otherTeams && reviewTeam && <option value="all">All members ({createEmployees.length})</option>}{createEmployees.map(row => <option key={row._id} value={row._id}>{row.fullName} ({row.employeeId})</option>)}</select></label>
          <label><span>Date period</span><select aria-label="Billing date period" value={draft.period} onChange={event => inputDraft('period', event.target.value)}>{[['today','Today'],['yesterday','Yesterday'],['this-week','This week'],['last-week','Last week'],['this-month','This month'],['last-month','Last month'],['custom','Custom date range']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>From date</span><input aria-label="Billing from date" required type="date" value={draft.startDate} onChange={event => inputDraft('startDate', event.target.value)} /></label>
          <label><span>To date</span><input aria-label="Billing to date" required type="date" min={draft.startDate} value={draft.endDate} onChange={event => inputDraft('endDate', event.target.value)} /></label>
          <button className="billing-generate prod-primary">{busy ? 'Generating...' : 'Generate report'}</button>
        </div>
        {draft.team && !otherTeams && reviewTeam && draft.employee !== 'all' && <button type="button" className="prod-secondary" disabled={draft.employee === 'all'} onClick={() => inputDraft('employee', 'all')}>Select all team members ({createEmployees.length})</button>}
        {draft.team && <details className="prod-extra-filters"><summary>Work assigned across teams (optional)</summary><p className="prod-filter-hint">Use this only when someone from another home team completed work for this billing team.</p><label className="prod-checkbox"><input type="checkbox" checked={otherTeams} onChange={event => { setOtherTeams(event.target.checked); inputDraft('employee', ''); }} />Include employees from other teams within my access</label></details>}
        <details className="prod-preparation-note"><summary>Add a preparation note (optional)</summary><label>Note<input aria-label="Preparation note" minLength={3} maxLength={500} value={draft.reason} onChange={event => inputDraft('reason', event.target.value)} /></label></details>
      </fieldset></form>
    </section>
    {!review && !reviewLoading && !selectedId && <section className="billing-empty prod-panel"><h3>Choose a team, members and period</h3><p>Select All members for a combined team report, or choose one employee.</p></section>}
    {reviewLoading && <p role="status" className="prod-status">Preparing review report...</p>}
    {review && !reviewLoading && <ProductionBillingReport review={review} reviewPanel={billingReview}><section className="prod-panel billing-report" aria-label="Prepared billing review report"><div className="prod-section-heading prod-billing-list-heading"><div><h2>{review.data.selection.team} / Billing review</h2><p>{review.items.length} employees / {review.data.period.startDate} to {review.data.period.endDate}</p><p>Check each employee before submitting for approval. Excel includes all work rows.</p></div>{review.canExport && <button type="button" className="prod-primary" disabled={busy || exporting} onClick={downloadReview}>{exporting ? 'Downloading...' : 'Download review Excel'}</button>}</div><BillingBulkActions key={reviewIds} review={review} onBusy={setBusy} onDone={result => { setMessage(''); setBulkResult(result); setRefresh(value => value + 1); }} /><div className="prod-table-wrap prod-employee-review-scroll"><table className="prod-table" aria-label="Prepared employee reviews"><thead><tr><th>Employee</th><th>Eligible work</th><th>Billing</th><th>Status</th><th>Review items</th><th>Review</th></tr></thead><tbody>{review.items.map(row => <tr key={row._id}><td>{row.snapshot.employeeName}</td><td>{duration(row.snapshot.summary.eligibleClientWorkSeconds)}</td><td>{row.financialAccess ? <Amounts billing={row.snapshot.summary.billing} /> : 'Amounts restricted'}</td><td><span className={`prod-billing-status is-${row.status.toLowerCase()}`}>{row.status}</span></td><td>{row.snapshot.blockers.length ? `${row.snapshot.blockers.length} to resolve` : 'Ready for review'}</td><td><button type="button" className="prod-secondary" disabled={busy || exporting} onClick={() => open(row._id)}>Review employee</button></td></tr>)}</tbody></table></div></section></ProductionBillingReport>}
    <details className="prod-panel prod-billing-history"><summary>Previous billing reports</summary><div className="prod-section-heading prod-billing-list-heading"><h2>Billing periods</h2><div className="prod-billing-list-filters">
      <label>Team<select aria-label="Billing list team" disabled={loading || busy} value={query.team} onChange={event => setQuery(previous => ({ ...previous, team: event.target.value, employee: 'all', page: 1 }))}><option value="all">All available teams</option>{choices.teams.map(row => <option key={row._id} value={row._id}>{row.teamName}</option>)}</select></label>
      <label>Employee<select aria-label="Billing list employee" disabled={loading || busy} value={query.employee} onChange={event => setQuery(previous => ({ ...previous, employee: event.target.value, page: 1 }))}><option value="all">All available employees</option>{productionTeamEmployees(choices.employees, query.team).map(row => <option key={row._id} value={row._id}>{row.fullName}</option>)}</select></label>
      <label>Status<select aria-label="Billing status filter" disabled={loading || busy} value={query.status} onChange={event => setQuery(previous => ({ ...previous, status: event.target.value, page: 1 }))}>{['all', 'Draft', 'Submitted', 'Approved', 'Rejected', 'Finalized'].map(value => <option key={value} value={value}>{value === 'all' ? 'All statuses' : value}</option>)}</select></label>
    </div></div>
      {loading ? <p className="prod-status" role="status">Loading billing periods…</p> : <><div className="prod-table-wrap"><table className="prod-table" aria-label="Billing periods"><thead><tr><th>Employee / team</th><th>Period</th><th>Status</th><th>Eligible work</th><th>Billing</th><th>Open</th></tr></thead><tbody>{listing?.items.map(row => <tr key={row._id}><td>{row.snapshot.employeeName}<small>{row.snapshot.teamName}</small></td><td>{row.startDate}<small>to {row.endDate}</small></td><td><span className={`prod-billing-status is-${row.status.toLowerCase()}`}>{row.status}</span>{row.lastAdjustment && <small>Has historical adjustments</small>}</td><td>{duration(row.snapshot.summary.eligibleClientWorkSeconds)}</td><td>{row.financialAccess ? <><Amounts billing={row.snapshot.summary.billing} /><small>{row.status === 'Finalized' ? 'Original finalized billing' : 'Provisional estimate'}</small></> : 'Amounts restricted'}</td><td><button className="prod-secondary" disabled={busy} onClick={() => open(row._id)}>Review period</button></td></tr>)}</tbody></table></div>
      {!listing?.total && <p className="prod-empty">No billing periods yet. Prepare a draft above.</p>}
      <div className="prod-pagination"><span>{listing?.total || 0} periods · Page {query.page}</span><div><button className="prod-secondary" disabled={busy || query.page === 1} onClick={() => setQuery(previous => ({ ...previous, page: previous.page - 1 }))}>Previous</button><button className="prod-secondary" disabled={busy || query.page * 25 >= (listing?.total || 0)} onClick={() => setQuery(previous => ({ ...previous, page: previous.page + 1 }))}>Next</button></div></div></>}
    </details>
    {detailLoading && <p className="prod-status" role="status">Loading the saved billing period…</p>}
    {!review && billingReview}

  </section></DashboardLayout>;
}
