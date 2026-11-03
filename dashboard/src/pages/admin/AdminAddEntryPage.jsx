import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import EntryEmployeePicker from '../../components/reports/EntryEmployeePicker';
import AddEntryModal from '../../components/reports/AddEntryModal';
import { getAllEmployeeOptions } from '../../api/employeeApi';
import { getAllTeams } from '../../api/teamApi';
import { entryEmployeesForTeam } from '../../utils/entryEmployeeScope';
import { canManageManualEntries } from '../../utils/manualEntry';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import useAuth from '../../context/useAuth';
import '../../styles/addEntryPage.css';

export default function AdminAddEntryPage() {
  const { user, hasPermission } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState('');
  const [team, setTeam] = useState('');
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entryEmployee, setEntryEmployee] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([getAllEmployeeOptions({ isActive: true }), getAllTeams()]).then(([employees, teams]) => {
      if (active) {
        setEmployees(employees.filter(employee => employee.isActive !== false && canManageManualEntries(user, employee)));
        setTeams(teams.filter(team => team.isActive !== false));
      }
    }).catch(error => { if (active) setError(getApiErrorMessage(error, 'Unable to load employees.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);
  const employee = entryEmployeesForTeam(employees, team).find(employee => employee._id === selected);
  return <DashboardLayout title="Add Entry">
    <section className="card entry-add-panel" aria-label="Add manual entry">
      <p className="admin-eyebrow">ENTRY MANAGEMENT</p><h2>Add Entry</h2>
      <p>Choose a team, then an employee from that team to add their project, client, task and times.</p>
      {error && <p role="alert" className="add-entry-alert">{error}</p>}
      {notice && <p role="status" className="report-entry-notice">{notice}</p>}
      <EntryEmployeePicker teams={teams} employees={employees} team={team} employee={selected} loading={loading}
        onTeamChange={value => { setTeam(value); setSelected(''); setNotice(''); }} onEmployeeChange={value => { setSelected(value); setNotice(''); }} />
      <div className="entry-add-actions"><button type="button" className="primary-button" disabled={loading || !employee || !hasPermission('add_manual_entries')}
        onClick={() => setEntryEmployee({ id: employee._id, name: employee.fullName })}><Plus size={16} />Add entry</button>
        <Link to="/admin/time-entry-edits">Open Edit Entries</Link></div>
      <p className="add-entry-hint">To view or edit an older entry, open Edit Entries and select its date.</p>
    </section>
    {entryEmployee && <AddEntryModal employee={entryEmployee} onClose={() => setEntryEmployee(null)}
      onSaved={(_record, form) => setNotice(`Entry saved for ${entryEmployee.name} on ${form.date}.`)} />}
  </DashboardLayout>;
}
