import DashboardLayout from '../../components/layout/DashboardLayout';
import ActivityLinksEditor from '../../components/tasks/ActivityLinksEditor';
import { Link2 } from 'lucide-react';

export default function AdminTaskLinksPage({ clientsOnly = false }) {
  return <DashboardLayout title={clientsOnly ? 'Project & client links' : 'Task links'}>
    <section className="card activity-links-page" aria-label={clientsOnly ? 'Project and client links editor' : 'Task links editor'}>
      <header className="activity-editor-heading"><span className="activity-heading-icon"><Link2 size={22} aria-hidden="true" /></span><div><p className="admin-eyebrow">{clientsOnly ? 'PROJECTS AND CLIENTS' : 'PROJECTS, CLIENTS AND TASKS'}</p><h2>{clientsOnly ? 'Manage project and client links' : 'Link existing tasks'}</h2></div><span className="activity-editor-badge">Bulk linking</span></header>
      <ActivityLinksEditor key={clientsOnly ? 'clients' : 'tasks'} clientsOnly={clientsOnly} />
    </section>
  </DashboardLayout>;
}
