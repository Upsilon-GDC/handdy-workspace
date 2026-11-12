import { useRef, useState } from 'react';
import { getProductionBillingPeriod, actOnProductionBilling } from '../../api/productionApi';
import getApiErrorMessage from '../../utils/getApiErrorMessage';

export default function BillingBulkActions({ review, onBusy, onDone }) {
  const [selected, setSelected] = useState([]), [action, setAction] = useState('verify-allocations');
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const requests = useRef(new Map());
  const items = review.items.filter(row => row.allowedActions?.includes(action));
  const chosen = items.filter(row => selected.includes(row._id));
  const all = items.length > 0 && chosen.length === items.length;
  const run = async () => {
    if (!chosen.length || note.trim().length < 3) return;
    setBusy(true); onBusy(true); setMessage(''); let saved = 0; const failures = [], failedIds = new Set();
    for (const row of chosen) {
      try {
        let { batch } = await getProductionBillingPeriod(row._id);
        if (!batch.allowedActions.includes(action)) throw new Error('This action is no longer available. Reload the review.');
        if (action === 'verify-allocations' && batch.allowedActions.includes('refresh')) {
          const refresh = { action: 'refresh', expectedVersion: batch.version, reason: note.trim() };
          const refreshKey = `${batch._id}:${JSON.stringify(refresh)}`;
          if (!requests.current.has(refreshKey)) requests.current.set(refreshKey, crypto.randomUUID());
          batch = await actOnProductionBilling(batch._id, { ...refresh, requestId: requests.current.get(refreshKey) });
        }
        const extra = action === 'verify-allocations' ? { verificationHash: batch.verificationHash,
          allocations: batch.snapshot.entries.filter(entry => !entry.verified).map(entry => ({ timeLog: entry.timeLog, expectedVersion: entry.allocationVersion })) } : {};
        if (action === 'verify-allocations' && !extra.allocations.length) { saved++; continue; }
        const body = { action, expectedVersion: batch.version, reason: note.trim(), ...extra };
        const key = `${batch._id}:${JSON.stringify(body)}`;
        if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID());
        await actOnProductionBilling(batch._id, { ...body, requestId: requests.current.get(key) }); saved++;
      } catch (error) { failedIds.add(row._id); failures.push(`${row.snapshot.employeeName}: ${getApiErrorMessage(error, error.message || 'Unable to save')}`); }
    }
    const result = `${saved} of ${chosen.length} employee periods completed.${failures.length ? ` ${failures.join(' · ')}` : ''}`;
    setMessage(result);
    setSelected([...failedIds]);
    setBusy(false); onBusy(false); onDone(result);
  };
  return <div className="prod-bulk-actions" aria-label="Bulk employee review">
    <div className="prod-bulk-toolbar"><label>Action<select aria-label="Employee bulk action" disabled={busy} value={action} onChange={event => { setAction(event.target.value); setSelected([]); setMessage(''); }}><option value="verify-allocations">Verify task assignments</option><option value="refresh">Refresh estimates</option><option value="submit">Submit for review</option><option value="approve">Approve billing</option></select></label><button type="button" className="prod-secondary" disabled={busy || !items.length} onClick={() => setSelected(all ? [] : items.map(row => row._id))}>{all ? 'Clear employee selection' : 'Select all employees'}</button><span>{chosen.length} of {items.length} available employees selected</span></div>
    <div className="prod-bulk-employees">{items.map(row => <label className="prod-checkbox" key={row._id}><input type="checkbox" aria-label={`Select billing employee ${row.snapshot.employeeName}`} disabled={busy} checked={selected.includes(row._id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, row._id] : previous.filter(id => id !== row._id))} />{row.snapshot.employeeName}</label>)}</div>
    {!items.length && <p className="prod-filter-hint">No employee periods are available for this action.</p>}
    <div className="prod-bulk-toolbar"><label>Review note (required)<input aria-label="Bulk review note" disabled={busy} value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></label><button type="button" className="prod-primary" disabled={busy || !chosen.length || note.trim().length < 3} onClick={run}>{busy ? 'Processing…' : `Apply to ${chosen.length} employees`}</button></div>
    {message && <p role="status" className="prod-bulk-result">{message}</p>}
  </div>;
}
