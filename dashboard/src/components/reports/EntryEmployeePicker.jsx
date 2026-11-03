import { entryEmployeesForTeam, UNASSIGNED_ENTRY_TEAM } from '../../utils/entryEmployeeScope';
import '../../styles/entryEmployeePicker.css';

export default function EntryEmployeePicker({ teams, employees, team, employee, onTeamChange, onEmployeeChange, loading = false }) {
  const [search, setSearch] = useState('');
  const available = entryEmployeesForTeam(employees, team);
  const hasUnassigned = employees.some(employee => employee.role !== 'alpha' && !employee.team);
  co nst teamChoices = [...teams, ...(hasUnassigned ? [{ _id: UNASSIGNED_ENTRY_TEAM, teamName: 'No team assigned' }] : [])];
  const selectedTeam = teamChoices.find(item => item._id === team);
  const selectedEmployee = available.find(item => item._id === employee);
  const needle = search.trim().toLowerCase();
  const members = available.filter(member => [member.fullName, member.employeeId, member.designation, member.role?.replaceAll('_', ' ')].filter(Boolean).join(' ').toLowerCase().includes(needle));
  const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('');
  const countLabel = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (loading) return <div className="entry-employee-picker" role="status">Loading teams and members…</div>;
  return <div className="entry-employee-picker">
    <div className="entry-picker-heading"><div><span>TEAM DIRECTORY</span><h3>Select a team</h3><p>Choose a team to view its members below.</p></div><small>{countLabel(teamChoices.length, 'team')}</small></div>
    <div className="entry-team-grid" role="group" aria-label="Teams">
      {teamChoices.map(item => <button type="button" key={item._id} data-team-id={item._id} aria-pressed={team === item._id}
        className="entry-team-card" onClick={() => { setSearch(''); if (team !== item._id) onTeamChange(item._id); }}>
        <span className="entry-team-icon"><Building2 size={20} /></span>
        <span className="entry-team-card-body"><strong>{item.teamName}</strong><small><Users size={13} />{countLabel(entryEmployeesForTeam(employees, item._id).length, 'member')}{item.isActive === false ? ' · Inactive team' : ''}</small></span>
        {team === item._id && <Check size={18} aria-hidden="true" />}
      </button>)}
    </div>
    {!teamChoices.length && <p className="entry-picker-empty">No teams available.</p>}
    {!selectedTeam ? <div className="entry-picker-empty"><Users size={24} /><p>Select a team above to see its members.</p></div> : <div className="entry-team-members">
      <div className="entry-member-heading"><div><span>TEAM MEMBERS</span><h3>{selectedTeam.teamName}</h3></div><small>{countLabel(available.length, 'member')}</small></div>
      <label className="entry-member-search"><Search size={16} /><input type="search" aria-label="Search team members" placeholder="Search name, employee ID or role" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {selectedEmployee && <p className="entry-selected-member" role="status">Selected: <strong>{selectedEmployee.fullName}</strong>{selectedEmployee.employeeId ? ` (${selectedEmployee.employeeId})` : ''}</p>}
      <div className="entry-member-grid" role="group" aria-label="Team members">
        {members.map(member => <button type="button" key={member._id} data-employee-id={member._id} aria-pressed={member._id === employee}
          className="entry-member-card" onClick={() => { if (employee !== member._id) onEmployeeChange(member._id); }}>
          <span className="entry-member-avatar">{initials(member.fullName)}</span>
          <span className="entry-member-card-body"><strong>{member.fullName}</strong><small>{[member.employeeId, member.designation || member.role?.replaceAll('_', ' '), member.isActive === false ? 'Inactive' : ''].filter(Boolean).join(' · ')}</small></span>
          {member._id === employee && <Check size={17} aria-hidden="true" />}
        </button>)}
      </div>
      {!members.length && <p className="entry-picker-empty">{available.length ? 'No members match your search.' : 'No members in this team.'}</p>}
    </div>}
  </div>;
}
import { useState } from 'react';
import { Building2, Check, Search, Users } from 'lucide-react';
