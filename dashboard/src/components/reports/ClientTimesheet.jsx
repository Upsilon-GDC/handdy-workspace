import { useRef, useState } from "react";
import { formatReportDuration } from "../../utils/reportFormatting.js";
import "../../styles/clientTimesheet.css";

function TimeTotals({ node }) {
  return <span className="client-timesheet-totals">
    <strong>Worked {formatReportDuration(node.workedSeconds)}</strong>
    <span>Break / Idle {formatReportDuration(node.breakSeconds + node.idleSeconds)}</span>
  </span>;
}

function EmployeeTimesheet({ employee }) {
  const root = useRef(null);
  const [allExpanded, setAllExpanded] = useState(false);
  const updateExpansion = () => {
    if (root.current) setAllExpanded(root.current.open && [...root.current.querySelectorAll("details")].every((node) => node.open));
  };
  const toggleAll = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = !allExpanded;
    root.current.open = open;
    root.current.querySelectorAll("details").forEach((node) => { node.open = open; });
    setAllExpanded(open);
  };
  return <details className="client-timesheet-employee" ref={root} onToggle={updateExpansion}>
      <summary><span><small>Employee</small>{employee.name}</span><TimeTotals node={employee} />
        <button type="button" className="client-timesheet-expand-all" onClick={toggleAll}
          aria-label={`${allExpanded ? "Collapse" : "Expand"} all for ${employee.name}`} aria-expanded={allExpanded}>
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </summary>
      <div className="client-timesheet-children">
        {employee.clients.map((client) => <details className="client-timesheet-client" key={client.key} onToggle={updateExpansion}>
          <summary><span><small>Client</small>{client.name}</span><TimeTotals node={client} /></summary>
          <div className="client-timesheet-children">
            {client.projects.map((project) => <details className="client-timesheet-project" key={project.key} onToggle={updateExpansion}>
              <summary><span><small>Project</small>{project.name}</span><TimeTotals node={project} /></summary>
              <div className="admin-report-table-wrap"><table>
                <thead><tr><th>Task</th><th>Sessions</th><th>Worked</th><th>Break / Idle</th></tr></thead>
                <tbody>{project.tasks.map((task) => <tr key={task.key}>
                  <td>{task.name}</td><td>{task.sessions}</td><td>{formatReportDuration(task.workedSeconds)}</td>
                  <td>{formatReportDuration(task.breakSeconds + task.idleSeconds)}</td>
                </tr>)}</tbody>
              </table></div>
            </details>)}
          </div>
        </details>)}
      </div>
    </details>;
}

export default function ClientTimesheet({ employees }) {
  return <div className="client-timesheet" aria-label="Timesheet by employee, client, project and task">
    <p className="client-timesheet-help">Expand a row to see clients, projects and tasks. Worked time excludes breaks and idle.</p>
    {employees.map((employee) => <EmployeeTimesheet employee={employee} key={employee.key} />)}
  </div>;
}
