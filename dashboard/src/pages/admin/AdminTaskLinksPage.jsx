import DashboardLayout from '../../components/layout/DashboardLayout';
import ActivityLinksEditor from '../../components/tasks/ActivityLinksEditor';
import { useState } from 'react';
import { Link2, Users } from 'lucide-react';
import useAuth from '../../context/useAuth';
import ClientAccessSettings from './ClientAccessSettings';
import '../../styles/workSetup.css';

export default function AdminTaskLinksPage() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [clientsOnly, setClientsOnly] = useState(false);
  const [section, setSection] = useState('links');
  const [accessOpened, setAccessOpened] = useState(false);
  const canManageAccess = ['admin', 'alpha', 'manager'].includes(user?.role);
  const selectSection = value => { setSection(value); if (value === 'access') setAccessOpened(true); };
  return <DashboardLayout title="Work setup">
    <div className="work-setup-tabs" role="tablist" aria-label="Work setup sections" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[index].click(); tabs[index].focus();
    }}>
      <button type="button" id="work-links-tab" role="tab" aria-selected={section === 'links'} aria-controls="work-links-panel" tabIndex={section === 'links' ? 0 : -1} onClick={() => selectSection('links')}><Link2 size={18} aria-hidden="true" />Clients, projects & tasks</button>
      {canManageAccess && <button type="button" id="employee-access-tab" role="tab" aria-selected={section === 'access'} aria-controls="employee-client-access" tabIndex={section === 'access' ? 0 : -1} onClick={() => selectSection('access')}><Users size={18} aria-hidden="true" />Employee access</button>}
    </div>
    <div id="work-links-panel" role="tabpanel" aria-labelledby="work-links-tab" hidden={section !== 'links'}>
    <section className="card activity-links-page work-setup-unified" aria-label="Clients, projects and tasks">
      <header className="unified-setup-heading"><div><h2>Select what you want to connect</h2><p>Choose clients, projects and tasks below in any order. All your choices stay on this page.</p></div></header>
      <div className="unified-setup-mode"><label><input type="checkbox" aria-label="Include tasks" checked={!clientsOnly} disabled={busy} onChange={event => setClientsOnly(!event.target.checked)} />Include tasks</label><span>Turn off to update only project clients.</span></div>
      <ActivityLinksEditor clientsOnly={clientsOnly} allInOne onBusyChange={setBusy} />
    </section>
    </div>
    {canManageAccess && <div id="employee-client-access" role="tabpanel" aria-labelledby="employee-access-tab" hidden={section !== 'access'}>
      {accessOpened && <ClientAccessSettings embedded />}
    </div>}
  </DashboardLayout>;
}
