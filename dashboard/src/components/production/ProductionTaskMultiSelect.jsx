import { useState } from 'react';
import { productionTaskChoices } from '../../utils/production';

export default function ProductionTaskMultiSelect({ rows, selected, onChange, disabled }) {
  const [search, setSearch] = useState('');
  const choices = productionTaskChoices(rows);
  const shown = choices.filter(row => `${row.taskName} ${row.taskCode || ''} ${row.project?.projectName || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedIds = new Set(selected.map(row => row._id));
  const add = rows => onChange([...new Map([...selected, ...rows.map(row => ({ ...row, expectedVersion: row.classificationVersion || 0 }))].map(row => [row._id, row])).values()]);
  return <fieldset className="prod-task-picker prod-form-wide" disabled={disabled} aria-label="Select classification tasks">
    <label>Find tasks<input aria-label="Find classification tasks" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tasks or projects" /></label>
    <div className="prod-task-picker-actions"><strong>{selected.length} selected</strong><span>{shown.length} shown</span><button type="button" className="prod-secondary" disabled={!shown.length} onClick={() => add(shown)}>{search.trim() ? 'Select all shown' : 'Select all tasks'}</button><button type="button" className="prod-secondary" disabled={!selected.length} onClick={() => onChange([])}>Clear selection</button></div>
    <div className="prod-task-picker-list">{shown.map(row => <label className="prod-checkbox" key={row._id}><input type="checkbox" data-task-id={row._id} aria-label={`Select ${row.taskName} ${row.taskCode || ''}`} checked={selectedIds.has(row._id)} onChange={event => event.target.checked ? add([row]) : onChange(selected.filter(task => task._id !== row._id))} /><span>{row.optionLabel}{row.taskType === 'break' && <small>Break task — excluded from production and billing</small>}</span></label>)}{!shown.length && <p>No tasks match this search.</p>}</div>
    {!!selected.length && <details className="prod-selected-task-review"><summary>Review {selected.length} selected tasks</summary><ul>{selected.map(row => <li key={row._id}>{row.optionLabel || row.taskName}</li>)}</ul></details>}
  </fieldset>;
}
