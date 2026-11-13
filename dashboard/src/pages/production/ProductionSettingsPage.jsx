import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import useAuth from '../../context/useAuth';
import { getProductionCatalog, getProductionHistory, saveProductionSetting, saveProductionClassifications } from '../../api/productionApi';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { todayDateKey } from '../../utils/appDate';
import { productionTaskChoices } from '../../utils/production';
import ProductionTaskMultiSelect from '../../components/production/ProductionTaskMultiSelect';
import ProductionEmployeeRateEditor from '../../components/production/ProductionEmployeeRateEditor';
import '../../styles/production.css';

const kinds = { 'team-billing': ['Team billing', 'Enable billing and setup alerts for the selected team. Disabled teams keep their tracked hours and saved employee rates.'],
  classification: ['Activity classifications', 'Choose how a task counts: productive work, training, another exclusion, or Break / Idle.'],
  rate: ['Billing rates', 'Review the project rates saved in each employee profile.'],
  access: ['Team access', 'Give a manager or team lead access to a team. Financial visibility is a separate choice. Employee accounts keep personal access.'] };
const defaults = () => ({ billingEnabled: false, approvalRequired: true, currency: 'USD', category: 'productive', billable: false, reportOptionalBillable: false,
  enabled: true, canViewBilling: false, canApproveBilling: false, hourlyRate: '', effectiveFrom: todayDateKey(), reason: '' });
export default function ProductionSettingsPage() {
  const { user } = useAuth(), admin = ['admin', 'alpha'].includes(user?.role);
  const [catalog, setCatalog] = useState(null);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [kind, setKind] = useState('team-billing'), [team, setTeam] = useState(''), [target, setTarget] = useState('');
  const [employee, setEmployee] = useState(''), [editingRates, setEditingRates] = useState(null);
  const includeInactiveClients = false;
  const [includeArchivedTasks, setIncludeArchivedTasks] = useState(false);
  const [multiple, setMultiple] = useState(false), [selectedTasks, setSelectedTasks] = useState([]);
  const [form, setForm] = useState(defaults), [version, setVersion] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false), [historyLoading, setHistoryLoading] = useState(false);
  const loading = catalogLoading || historyLoading;
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const taskTeam = kind === 'classification' ? team : '';
  const rateTeam = kind === 'rate' ? team : '';
  const accessTeam = kind === 'access' ? team : '';
  const accessReady = team && catalog?.accessTeam === team;
  const taskReady = team && catalog?.taskTeam === team && catalog?.includeArchivedTasks === includeArchivedTasks;
  const rateReady = team && catalog?.rateTeam === team && catalog?.includeInactiveClients === includeInactiveClients;
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController(); setCatalogLoading(true); setError('');
    getProductionCatalog('', controller.signal, { taskTeam, rateTeam, accessTeam, includeInactiveClients, includeArchivedTasks }).then(data => {
      if (controller.signal.aborted) return;
      setCatalog({ ...data, taskTeam, rateTeam, accessTeam, includeInactiveClients, includeArchivedTasks }); setTeam(previous => previous || data.teams[0]?._id || '');
    })
      .catch(error => { if (!controller.signal.aborted) setError(getApiErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [admin, catalogRetry, taskTeam, rateTeam, accessTeam, includeInactiveClients, includeArchivedTasks]);
  const key = !team ? '' : kind === 'team-billing' ? team : kind === 'classification' ? !multiple && target ? `${team}:task:${target}` : ''
    : kind === 'access' ? employee ? `${employee}:${team}` : '' : '';
  useEffect(() => {
    if (!admin || !key) { setVersion(0); setHistoryLoading(false); return; }
    const controller = new AbortController(); setHistoryLoading(true); setError(''); setVersion(0);
    getProductionHistory(kind, key, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const latest = data.items[0]; setVersion(latest?.version || 0);
      const values = latest?.values;
      setForm({ ...defaults(), ...(values || {}), currency: values?.currency || 'USD',
        hourlyRate: values?.hourlyRateHundredths ? values.hourlyRateHundredths / 100 : '',
        effectiveFrom: latest?.effectiveFrom && (kind === 'access' || latest.effectiveFrom > todayDateKey()) ? latest.effectiveFrom : todayDateKey(), reason: '' });
    }).catch(error => { if (!controller.signal.aborted) setError(getApiErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [admin, kind, key, refresh]);
  const update = (field, value) => setForm(previous => ({ ...previous, [field]: value }));
  const historical = form.effectiveFrom < todayDateKey();
  const batchMode = kind === 'classification' && multiple;
  const breakConflict = batchMode && selectedTasks.some(row => row.taskType === 'break') && (!['break-idle', 'excluded'].includes(form.category) || form.reportOptionalBillable);
  const save = async event => {
    event.preventDefault(); if (batchMode ? !selectedTasks.length || breakConflict || !taskReady : !key) return;
    setSaving(true); setError(''); setMessage('');
    try {
      if (batchMode) {
        const result = await saveProductionClassifications({ ...form, team, billable: form.category === 'productive' && form.billable, tasks: selectedTasks.map(row => ({ task: row._id, expectedVersion: row.expectedVersion })) }, historical);
        setMessage(`Saved classification for ${result.count} tasks, effective from ${form.effectiveFrom}.`); setSelectedTasks([]); setCatalogRetry(value => value + 1); setRefresh(value => value + 1); return;
      }
      await saveProductionSetting(kind, { ...form, team, expectedVersion: version, ...(kind === 'classification' ? { targetType: 'task', target, billable: form.category === 'productive' && form.billable } : {}),
 ...(kind === 'access' ? { employee } : {}) }, historical);
      const savedDate = form.effectiveFrom; setRefresh(value => value + 1);
      setMessage(`Saved. This setting applies from ${savedDate}.`);
    } catch (error) { setError(getApiErrorMessage(error, 'Unable to save Production settings. Reload the current setting before retrying a conflicting edit.')); }
    finally { setSaving(false); }
  };
  const rateEmployees = rateReady ? catalog.employees.filter(row => !employee || row._id === employee) : [];
  const missingRateEmployees = rateEmployees.filter(row => !row.projectRates?.length || row.projectRates.some(rate => !rate.project || !Number.isFinite(rate.chargeRate) || rate.chargeRate <= 0)).length;
  const select = (label, value, change, rows, name, optional = false, disabled = false) => <label>{label}<select aria-label={label} required={!optional} disabled={disabled} value={value} onChange={event => change(event.target.value)}><option value="">{optional ? kind === 'rate' && label === 'Employee' ? 'All team employees' : `Any ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}</option>{rows?.map(row => <option key={row._id} value={row._id}>{row[name]}{row.employeeId ? ` (${row.employeeId})` : ''}</option>)}</select></label>;
  return <DashboardLayout title="Production settings"><section className="production-module production-settings">
    {!admin ? <p role="alert">Only an Admin can configure Production.</p> : <>
      <div className="prod-intro"><div><p className="prod-kicker">PRODUCTION SETTINGS</p><p>Manage team configuration with effective dates and a record of every change.</p></div><Link to="/admin/production/team" className="prod-secondary">Back to teams</Link></div>
      <div className="prod-tabs" aria-label="Settings sections">{Object.entries(kinds).map(([value, [label]]) => <button key={value} className="prod-secondary" disabled={saving} aria-pressed={kind === value} onClick={() => { if (value !== kind) { setEditingRates(null); setKind(value); setEmployee(''); setTarget(''); setIncludeArchivedTasks(false); setMultiple(false); setSelectedTasks([]); } setMessage(''); }}>{label}</button>)}</div>
      <form className={`prod-panel prod-settings-form${kind === 'rate' ? ' prod-rates-form' : ''}`} onSubmit={save} aria-label="Production settings form"><h2>{kinds[kind][0]}</h2><p>{kinds[kind][1]}</p>
        <fieldset disabled={saving || !catalog}><div className="prod-form-grid">
          {select('Team', team, value => { setEditingRates(null); setTeam(value); setTarget(''); setEmployee(''); setIncludeArchivedTasks(false); setSelectedTasks([]); }, catalog?.teams, 'teamName')}
          {kind === 'classification' && <label className="prod-checkbox"><input aria-label="Select multiple tasks" type="checkbox" checked={multiple} onChange={event => { setMultiple(event.target.checked); setTarget(''); setSelectedTasks([]); setForm(defaults()); setMessage(''); }} />Select multiple tasks</label>}
          {kind === 'classification' && !multiple && select('Task', target, setTarget, taskReady ? productionTaskChoices(catalog.tasks) : [], 'optionLabel', false, loading || !taskReady)}
          {batchMode && <ProductionTaskMultiSelect key={team} rows={taskReady ? catalog.tasks : []} selected={selectedTasks} onChange={setSelectedTasks} disabled={loading || !taskReady} />}
          {kind === 'classification' && <><label className="prod-checkbox prod-form-wide"><input aria-label="Include archived tasks" type="checkbox" checked={includeArchivedTasks} onChange={event => { setIncludeArchivedTasks(event.target.checked); setTarget(''); setSelectedTasks([]); }} />Include inactive or deleted tasks for historical classification</label><p className="prod-form-wide prod-filter-hint">Active tasks linked to the selected team are shown by default. Same-name tasks show their project and task code.{taskReady && !loading && !catalog.tasks.length ? ' No matching tasks found. Check the team links.' : ''}</p></>}
          {kind === 'rate' && select('Employee', employee, value => { setEditingRates(null); setEmployee(value); }, rateReady ? catalog.employees : [], 'fullName', true, loading || !rateReady)}
          {kind === 'access' && <>{select('Employee', employee, setEmployee, accessReady ? catalog.employees : [], 'fullName', false, loading || !accessReady)}<p className="prod-form-wide prod-filter-hint">Only employees from the selected team are listed.{accessReady && !loading && !catalog.employees.length ? ' No matching active employees found. Check the team assignment.' : ''}</p></>}
        </div></fieldset>
        {kind === 'rate' && <div className="prod-rates-reference">
          <div className="prod-rates-toolbar"><div><h3>Employee project rates</h3><p>Click Edit rates next to an employee. Changes also appear in the employee form.</p></div></div>
          {editingRates && <ProductionEmployeeRateEditor key={editingRates._id} employee={editingRates} team={team} projects={catalog?.projects || []} onBusy={setSaving} onCancel={() => setEditingRates(null)} onSaved={updated => { setCatalog(previous => ({ ...previous, employees: previous.employees.map(row => row._id === updated._id ? updated : row) })); setEditingRates(null); setMessage(`Saved project rates for ${updated.fullName}. The employee form uses these same rates.`); }} />}
          {rateReady && !loading && <>
            <div className="prod-rates-summary"><span>{rateEmployees.length} {rateEmployees.length === 1 ? 'employee' : 'employees'}</span>{rateEmployees.length > 0 && <span className={missingRateEmployees ? 'prod-rates-missing' : ''}>{missingRateEmployees ? `${missingRateEmployees} need rate setup` : 'Rates ready'}</span>}<span>Per hour / Currency from Team billing</span></div>
            <div className="prod-table-wrap"><table className="prod-table prod-rates-table" aria-label="Employee project billing rates"><thead><tr><th>Employee</th><th>Project</th><th>Hourly rate</th><th>Status</th><th>Action</th></tr></thead>
              {rateEmployees.map(row => <tbody className="prod-rate-employee-group" key={row._id}>
                {row.projectRates?.length ? row.projectRates.map((rate, index) => {
                  const ready = !!rate.project && Number.isFinite(rate.chargeRate) && rate.chargeRate > 0;
                  return <tr key={`${row._id}:${index}`}>
                    {index === 0 && <td rowSpan={row.projectRates.length} className="prod-rate-employee"><strong>{row.fullName}</strong><small>ID {row.employeeId}</small><small>{row.projectRates.length} {row.projectRates.length === 1 ? 'project' : 'projects'}</small></td>}
                    <td>{rate.project?.projectName || 'Unavailable project'}{rate.project?.projectCode && <small>{rate.project.projectCode}</small>}</td>
                    <td className="prod-rate-amount">{ready ? rate.chargeRate.toFixed(2) : <>&mdash;</>}</td>
                    <td><span className={`prod-rate-status${ready ? ' is-ready' : ''}`}>{ready ? 'Saved' : 'Needs setup'}</span></td>
                    {index === 0 && <td rowSpan={row.projectRates.length} className="prod-rate-employee-action"><button type="button" className="prod-secondary" disabled={saving || row.role === 'alpha'} onClick={() => { setEditingRates(row); setMessage(''); }}>Edit rates</button></td>}
                  </tr>;
                }) : <tr><td className="prod-rate-employee"><strong>{row.fullName}</strong><small>ID {row.employeeId}</small></td><td><span className="prod-muted">No project rate saved</span></td><td className="prod-rate-amount">&mdash;</td><td><span className="prod-rate-status">Needs setup</span></td><td><button type="button" className="prod-secondary" disabled={saving || row.role === 'alpha'} onClick={() => { setEditingRates(row); setMessage(''); }}>Add rates</button></td></tr>}
              </tbody>)}
              {!rateEmployees.length && <tbody><tr><td colSpan={5}><div className="prod-empty">No employees in this team. Choose another team.</div></td></tr></tbody>}
            </table></div>
          </>}
          <p className="prod-rates-note">Saved rates apply to live estimates. Refresh existing billing drafts after changing a rate. Finalized billing keeps its saved amount.</p>
        </div>}
        {kind !== 'rate' && <fieldset disabled={loading || saving || !catalog || (batchMode ? !selectedTasks.length || !taskReady : !key)}><div className="prod-form-grid" style={{ marginTop: 18 }}>
          {kind === 'team-billing' && <><label className="prod-checkbox"><input type="checkbox" checked={form.billingEnabled} onChange={event => update('billingEnabled', event.target.checked)} />Enable billing amounts</label><label className="prod-checkbox"><input type="checkbox" checked={form.approvalRequired} onChange={event => update('approvalRequired', event.target.checked)} />Require billing approval</label></>}
          {kind === 'classification' && <><label>Activity category<select aria-label="Activity category" value={form.category} onChange={event => setForm(previous => ({ ...previous, category: event.target.value, billable: event.target.value === 'productive' && previous.billable, reportOptionalBillable: event.target.value === 'excluded' && previous.reportOptionalBillable }))}><option value="productive">Productive work</option><option value="training">Training</option><option value="excluded">Other excluded activity</option><option value="break-idle">Break / Idle</option></select></label><label className="prod-checkbox"><input type="checkbox" checked={form.billable && form.category === 'productive'} disabled={form.category !== 'productive'} onChange={event => update('billable', event.target.checked)} />Eligible for billing</label>{form.category === 'excluded' && <label className="prod-checkbox prod-form-wide"><input aria-label="Allow optional report billing" type="checkbox" checked={!!form.reportOptionalBillable} onChange={event => update('reportOptionalBillable', event.target.checked)} />Allow reports to optionally count this activity as productive and billable</label>}</>}
          {kind === 'access' && <><label className="prod-checkbox"><input type="checkbox" checked={form.enabled} onChange={event => update('enabled', event.target.checked)} />Team access enabled</label><label className="prod-checkbox"><input type="checkbox" checked={form.canViewBilling} onChange={event => setForm(previous => ({ ...previous, canViewBilling: event.target.checked, canApproveBilling: event.target.checked && previous.canApproveBilling }))} />Allow billing amounts and rates for this team</label><label className="prod-checkbox"><input type="checkbox" checked={!!form.canApproveBilling} disabled={!form.canViewBilling || !['manager', 'team_lead'].includes(catalog?.employees.find(row => row._id === employee)?.role)} onChange={event => update('canApproveBilling', event.target.checked)} />Allow this manager or team lead to review and approve billing</label></>}
          {(kind === 'team-billing' && form.billingEnabled) && <label>Currency<select aria-label="Currency" required value={form.currency} onChange={event => update('currency', event.target.value)}>{Intl.supportedValuesOf('currency').map(currency => <option key={currency}>{currency}</option>)}</select></label>}
          {historical && <p className="prod-form-wide">{kind === 'access'
            ? 'You selected a past date. Add a reason of at least 10 characters. Settings with a later effective date will still take priority.'
            : 'You selected a past date. Saving records a historical correction with your reason (at least 10 characters). It applies until the next effective revision. Original finalized billing stays unchanged; use Billing Management to preview and record any financial adjustment.'}</p>}
          <label>Effective from<input aria-label="Effective from" type="date" min="1900-01-01" required value={form.effectiveFrom} onChange={event => update('effectiveFrom', event.target.value)} /></label>
          <label className="prod-form-wide">Reason for change<textarea aria-label="Reason for change" required minLength={historical ? 10 : 3} maxLength={500} rows={2} value={form.reason} onChange={event => update('reason', event.target.value)} /></label>
        </div>{batchMode && <div className="prod-batch-review"><strong>{selectedTasks.length} selected tasks</strong><br />Apply {({ productive: 'Productive work', training: 'Training', excluded: 'Other excluded activity', 'break-idle': 'Break / Idle' })[form.category]} · {form.category === 'productive' && form.billable ? 'Eligible for billing' : 'Not billable'} · From {form.effectiveFrom}. All selected tasks receive this rule together.{breakConflict && <p role="alert">Your selection includes break tasks. Choose Break / Idle or Other excluded activity, or deselect break tasks before marking work as productive or training.</p>}</div>}<div className="prod-filter-actions"><span>{batchMode ? 'Each task receives its own saved classification and change history.' : version ? `Current revision ${version}. Earlier revisions are preserved.` : 'No saved setting for this selection.'}</span><button className="prod-primary" type="submit" disabled={breakConflict}>{saving ? 'Saving…' : batchMode ? `Apply to ${selectedTasks.length} selected tasks` : 'Save setting'}</button></div></fieldset>}
        {loading && <p role="status">Loading current setting…</p>}
      </form>
      {error && <div className="prod-error" role="alert">{error}<button className="prod-secondary" onClick={() => { setRefresh(value => value + 1); setCatalogRetry(value => value + 1); setSelectedTasks([]); setEditingRates(null); }}>Reload</button></div>}
      {message && <p className="prod-success" role="status">{message}</p>}
    </>}
  </section></DashboardLayout>;
}
