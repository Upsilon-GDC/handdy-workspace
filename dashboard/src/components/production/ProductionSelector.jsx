export default function ProductionSelector({ label, value, onChange, rows = [], name, allLabel }) {
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="all">{allLabel || `All ${label.toLowerCase()}s`}</option>{rows.map(row => <option key={row._id} value={row._id}>{row[name]}{row.employeeId ? ` (${row.employeeId})` : row.projectCode || row.taskCode ? ` · ${row.projectCode || row.taskCode}` : ''}</option>)}</select></label>;
}
