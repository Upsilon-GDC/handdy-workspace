import { useState } from 'react';
import { updateProductionEmployeeRates } from '../../api/productionApi';
import getApiErrorMessage from '../../utils/getApiErrorMessage';

export default function ProductionEmployeeRateEditor({ employee, team, projects, onSaved, onCancel, onBusy }) {
  const [rates, setRates] = useState(() => (employee.projectRates?.length ? employee.projectRates.map(row => ({ project: row.project?._id || '', chargeRate: String(row.chargeRate ?? '') })) : [{ project: '', chargeRate: '' }]));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const choices = [...new Map([...projects, ...(employee.projectRates || []).map(row => row.project).filter(Boolean)].map(row => [row._id, row])).values()];
  const update = (index, field, value) => setRates(previous => previous.map((row, at) => at === index ? { ...row, [field]: value } : row));
  const save = async () => {
    if (saving) return;
    if (rates.some(row => !row.project || !row.chargeRate || !Number.isFinite(Number(row.chargeRate)) || Number(row.chargeRate) < 0.01 || Number(row.chargeRate) > 1000000 || !/^\d+(\.\d{1,2})?$/.test(row.chargeRate))) {
      setError('Choose a project and enter a rate from 0.01 to 1,000,000, with at most two decimal places.'); return;
    }
    if (new Set(rates.map(row => row.project)).size !== rates.length) { setError('Choose each project only once.'); return; }
    setSaving(true); onBusy(true); setError('');
    try {
      const updated = await updateProductionEmployeeRates(employee._id, { team, expectedUpdatedAt: employee.updatedAt || null,
        projectRates: rates.map(row => ({ project: row.project, chargeRate: Number(row.chargeRate) })) });
      onSaved(updated);
    } catch (error) { setError(getApiErrorMessage(error, 'Unable to save employee project rates.')); }
    finally { setSaving(false); onBusy(false); }
  };
  return <section className="prod-rate-editor" aria-label="Edit employee project rates">
    <h3>Project rates for {employee.fullName}</h3>
    <p>Saving here updates the same rates shown in the employee form.</p>
    <fieldset disabled={saving}>
      {rates.map((row, index) => <div className="prod-rate-editor-row" key={index}>
        <label>Project<select aria-label={`Rate project ${index + 1}`} value={row.project} onChange={event => update(index, 'project', event.target.value)}><option value="">Choose project</option>{choices.map(project => <option key={project._id} value={project._id} disabled={rates.some((other, at) => at !== index && other.project === project._id)}>{project.projectName}{project.projectCode ? ` (${project.projectCode})` : ''}</option>)}</select></label>
        <label>Hourly rate<input aria-label={`Employee hourly rate ${index + 1}`} type="number" min="0.01" max="1000000" step="0.01" value={row.chargeRate} onChange={event => update(index, 'chargeRate', event.target.value)} /></label>
        <button type="button" className="prod-secondary" aria-label={`Remove project rate ${index + 1}`} onClick={() => setRates(previous => previous.filter((_, at) => at !== index))}>Remove</button>
      </div>)}
      {!rates.length && <p>No rates. Saving will remove this employee&apos;s project rates.</p>}
      <button type="button" className="prod-secondary" onClick={() => setRates(previous => [...previous, { project: '', chargeRate: '' }])}>Add project rate</button>
      {error && <p role="alert">{error}</p>}
      <div className="prod-rate-editor-actions"><button type="button" className="prod-secondary" onClick={onCancel}>Cancel</button><button type="button" className="prod-primary" onClick={save}>{saving ? 'Saving...' : 'Save employee rates'}</button></div>
    </fieldset>
  </section>;
}
