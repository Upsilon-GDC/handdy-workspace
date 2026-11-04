import { useState } from 'react';
import ModalFrame from '../layout/ModalFrame';
import ActivityLinksEditor from './ActivityLinksEditor';
import '../../styles/activityLinks.css';

export default function ActivityLinksModal({ onClose, clientsOnly = false }) {
  const [busy, setBusy] = useState(false);

  return <ModalFrame onClose={busy ? undefined : onClose} label={clientsOnly ? 'Link projects and clients' : 'Link projects, clients and tasks'}>
    <div className="employee-modal activity-links-modal">
      <div className="employee-modal-header"><div><p className="admin-eyebrow">ACTIVITY LINKS</p><h2>{clientsOnly ? 'Link projects and clients' : 'Link existing tasks'}</h2></div><button type="button" className="modal-close-button" onClick={onClose} disabled={busy} aria-label="Close">×</button></div>
      <ActivityLinksEditor clientsOnly={clientsOnly} onBusyChange={setBusy} />
    </div>
  </ModalFrame>;
}
