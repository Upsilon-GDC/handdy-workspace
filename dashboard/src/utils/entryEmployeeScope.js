export const UNASSIGNED_ENTRY_TEAM = '__unassigned__';
const id = value => String(value?._id || value || '');
export const entryEmployeesForTeam = (employees, team) => !team ? [] : employees.filter(employee =>
  employee.role !== 'alpha' && (team === UNASSIGNED_ENTRY_TEAM ? !id(employee.team) : id(employee.team) === team));
