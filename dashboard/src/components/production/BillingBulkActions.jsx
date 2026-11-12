import { useRef, useState } from 'react';
import { getProductionBillingPeriod, actOnProductionBilling } from '../../api/productionApi';
import getApiErrorMessage from '../../utils/getApiErrorMessage';

export default function BillingBulkActions({ review, onBusy, onDone }) {
  const [selected, setSelected] = useState([]);
  const [stage, setStage] = useState(() => review.items.some(row => row.allowedActions?.includes('refresh')) ? 'prepare' : 'approve');
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const requests = useRef(new Map());
  const eligible = mode => review.items.filter(row => row.allowedActions?.includes(mode === 'prepare' ? 'refresh' : 'approve'));
  const items = eligible(stage), chosen = items.filter(row => selected.includes(row._id));
  const all = items.length > 0 && chosen.length === items.length;
  const changeStage = value => { setStage(value); setSelected([]); };
  const run = async () => {
    if (!chosen.length || (note.trim() && note.trim().length < 3)) return;
    setBusy(true); onBusy(true); let saved = 0; const failures = [];
    const reason = note.trim() || (stage === 'prepare' ? 'Prepare selected billing from the team review' : 'Approve selected billing from the team review');
    const send = async (batch, action, extra = {}) => {
      if (!batch.allowedActions.includes(action)) throw new Error('This action is unavailable. Ask an authorized billing reviewer.');
      const body = { action, expectedVersion: batch.version, reason, ...extra }, key = `${batch._id}:${JSON.stringify(body)}`;
      if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID());
      return actOnProductionBilling(batch._id, { ...body, requestId: requests.current.get(key) });
    };
    for (const row of chosen) {
      try {
        let { batch } = await getProductionBillingPeriod(row._id);
        if (stage === 'approve') await send(batch, 'approve');
        else {
          batch = await send(batch, 'refresh');
          const allocations = batch.snapshot.entries.filter(entry => !entry.verified).map(entry => ({ timeLog: entry.timeLog, expectedVersion: entry.allocationVersion }));
          if (allocations.length) batch = await send(batch, 'verify-allocations', { verificationHash: batch.verificationHash, allocations });
          await send(batch, 'submit');
        }
        saved++;
      } catch (error) { failures.push(`${row.snapshot.employeeName}: ${getApiErrorMessage(error, error.message || 'Unable to save')}`); }
    }
    setSelected([]); setBusy(false); onBusy(false);
    onDone(`${saved} of ${chosen.length} employee periods ${stage === 'prepare' ? 'submitted for approval' : 'approved'}.${failures.length ? ` Needs attention: ${failures.join(' ? ')}` : ''}`);
  };
  return <div className="prod-bulk-actions" aria-label="Bulk employee review">
    <div className="prod-simple-steps" role="group" aria-label="Billing review steps"><button type="button" aria-pressed={stage === 'prepare'} disabled={busy} onClick={() => changeStage('prepare')}>1. Prepare for approval</button><button type="button" aria-pressed={stage === 'approve'} disabled={busy} onClick={() => changeStage('approve')}>2. Approve billing ({eligible('approve').length})</button></div>
    <div className="prod-bulk-toolbar"><button type="button" className="prod-secondary" disabled={busy || !items.length} onClick={() => setSelected(all ? [] : items.map(row => row._id))}>{all ? 'Clear employee selection' : 'Select all employees'}</button><span>{chosen.length} of {items.length} employees selected</span><button type="button" className="prod-primary" disabled={busy || !chosen.length || (!!note.trim() && note.trim().length < 3)} onClick={run}>{busy ? 'Processing...' : stage === 'prepare' ? `Prepare ${chosen.length} for approval` : `Approve ${chosen.length} employees`}</button></div>
    <div className="prod-bulk-employees">{items.map(row => <label className="prod-checkbox" key={row._id}><input type="checkbox" aria-label={`Select billing employee ${row.snapshot.employeeName}`} disabled={busy} checked={selected.includes(row._id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, row._id] : previous.filter(id => id !== row._id))} />{row.snapshot.employeeName}</label>)}</div>
    {!items.length && <p className="prod-filter-hint">{stage === 'approve' ? 'No billing is ready for approval yet.' : 'No billing needs preparation.'}</p>}
    <details className="prod-preparation-note"><summary>Add a note (optional)</summary><label>Note<input aria-label="Bulk review note" disabled={busy} value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></label></details>
  </div>;
}
