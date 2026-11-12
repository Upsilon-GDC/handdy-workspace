import Selector from './ProductionSelector';
import { productionDates, productionTeamEmployees } from '../../utils/production';
import { productionViews } from '../../utils/productionViews';

const selectors = {
  team: ['Team', 'teams', 'teamName'], employee: ['Employee', 'employees', 'fullName'],
  client: ['Client', 'clients', 'clientName'], project: ['Project', 'projects', 'projectName'], task: ['Task', 'tasks', 'taskName'],
};
export default function ProductionWorkFilters({ draft, choices, onChange, personal = false, view = 'employee', showHint = true }) {
  const fields = productionViews[view].fields;
  const employees = productionTeamEmployees(choices.employees, draft.team);
  const focused = Object.keys(selectors).filter(key => !fields.includes(key) && draft[key] && draft[key] !== 'all');
  const select = key => {
    const [label, plural, name] = selectors[key];
    const allLabel = key === 'employee' ? personal ? 'My production' : draft.team !== 'all' ? 'All team members' : 'All available employees' : key === 'team' ? 'All available teams' : undefined;
    return <Selector key={key} label={label} allLabel={allLabel} value={draft[key]} onChange={value => onChange({ [key]: value, ...(key === 'team' ? { employee: 'all' } : {}) })} rows={key === 'employee' ? employees : choices[plural]} name={name} />;
  };
  return <>
    <div className="prod-filter-grid prod-main-filters">
      <label>Period<select aria-label="Period" value={draft.period} onChange={event => {
        const period = event.target.value, [startDate, endDate] = productionDates(period);
        onChange({ period, ...(period !== 'custom' ? { startDate, endDate } : {}) });
      }}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom dates</option></select></label>
      {fields.map(select)}
      {draft.period === 'custom' && <>
        <label>From date<input aria-label="From date" type="date" required value={draft.startDate} onChange={event => onChange({ startDate: event.target.value })} /></label>
        <label>To date<input aria-label="To date" type="date" required min={draft.startDate} value={draft.endDate} onChange={event => onChange({ endDate: event.target.value })} /></label>
      </>}
    </div>
    {showHint && <p className="prod-filter-hint">{draft.startDate} to {draft.endDate}.{fields.includes('employee') && ' All members are included unless you choose one employee.'}{fields.includes('employee') && draft.team !== 'all' && !employees.length ? ' No employees in this team are available within your access.' : ''}</p>}
    {!!focused.length && <div className="prod-focus-filters" aria-label="Selected work context"><span>Opened with:</span>{focused.map(key => {
      const [label, plural, name] = selectors[key];
      const value = choices[plural]?.find(row => row._id === draft[key])?.[name] || `Selected ${label.toLowerCase()}`;
      return <button key={key} type="button" className="prod-secondary" aria-label={`Remove ${label.toLowerCase()} filter`} onClick={() => onChange({ [key]: 'all', ...(key === 'team' ? { employee: 'all' } : {}) })}>{label}: {value} ?</button>;
    })}</div>}
  </>;
}
