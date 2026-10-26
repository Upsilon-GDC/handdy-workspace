import { useNavigate } from "react-router-dom";

import TaskForm from "../../components/tasks/TaskForm";

import "../../styles/teamLeadSidebar.css";
import "../../styles/teamLeadTasks.css";
import "../../styles/teamLeadAddTask.css";

function TeamLeadAddTask() {
  const navigate = useNavigate();

  return (
    <div className="tl-page">
      <main className="tl-main">
        <button
          type="button"
          className="tl-add-task-back"
          onClick={() => navigate("/team-lead/tasks")}
        >
          ← Back to tasks
        </button>

        <TaskForm
          mode="create"
          scope="teamLead"
          formClassName="admin-add-task-card"
          saveLabel="Save task"
          header={
            <header>
              <p>TASK MANAGEMENT</p>
              <h2>Add New Task</h2>
              <span>Create a task for your team and decide who can work on it.</span>
            </header>
          }
          onCancel={() => navigate("/team-lead/tasks")}
          onSaved={() => navigate("/team-lead/tasks")}
        />
      </main>
    </div>
  );
}

export default TeamLeadAddTask;
