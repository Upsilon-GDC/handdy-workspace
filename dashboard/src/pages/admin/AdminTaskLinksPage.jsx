import { useState } from 'react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import ActivityLinksModal from '../../components/tasks/ActivityLinksModal';

export default function AdminTaskLinksPage() {
  const [open, setOpen] = useState(false);
  return <DashboardLayout title="Task links">
    <section className="card" style={{ padding: 24 }}>
      <p className="admin-eyebrow">PROJECTS, CLIENTS AND TASKS</p>
      <h2>Link existing tasks</h2>
      <p>Choose a project and client, then select tasks to link or unlink. Your available projects and tasks follow your team access.</p>
      <p>To remove a link, open the controls below, select tasks marked Linked, then click Unlink selected tasks.</p>
      <p>Existing timers and recorded time are preserved when links change.</p>
      <button type="button" onClick={() => setOpen(true)}>Link projects, clients and tasks</button>
    </section>
    {open && <ActivityLinksModal onClose={() => setOpen(false)} />}
  </DashboardLayout>;
}
