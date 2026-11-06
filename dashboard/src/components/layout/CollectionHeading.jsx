import { Building2, Check, ClipboardCheck, FolderKanban, Layers3, UsersRound } from 'lucide-react';
import '../../styles/collectionHeading.css';

const collections = {
  clients: { Icon: Building2, label: 'CLIENT MANAGEMENT', art: 'Client records', tone: 'violet' },
  projects: { Icon: FolderKanban, label: 'PROJECT MANAGEMENT', art: 'Connected work', tone: 'blue' },
  tasks: { Icon: ClipboardCheck, label: 'TASK MANAGEMENT', art: 'Work in motion', tone: 'teal' },
  teams: { Icon: UsersRound, label: 'TEAM MANAGEMENT', art: 'Better together', tone: 'amber' },
  employees: { Icon: UsersRound, label: 'EMPLOYEE MANAGEMENT', art: 'People & teams', tone: 'rose' },
};

// Illustrations are composed from local SVG icons and CSS, with no image requests.
export default function CollectionHeading({ kind, title, description, detail, notice, children }) {
  const { Icon, label, art, tone } = collections[kind];
  return <header className={`collection-heading collection-tone-${tone}`}>
    <div className="collection-heading-content">
      <div className="collection-heading-title"><span className="collection-heading-icon" aria-hidden="true"><Icon size={25} strokeWidth={1.8} /></span>
        <div><p className="collection-eyebrow">{label}</p><h2>{title}</h2></div>
      </div>
      <p className="collection-description">{description}</p>
      {detail && <span className="collection-count"><Layers3 size={13} aria-hidden="true" />{detail}</span>}
      {notice}
    </div>
    <div className="collection-heading-actions">{children}</div>
    <div className="collection-art" aria-hidden="true">
      <div className="collection-art-orbit" />
      <div className="collection-art-back"><span /><span /><span /></div>
      <div className="collection-art-front"><span className="collection-art-symbol"><Icon size={26} strokeWidth={1.6} /></span><b>{art}</b><div className="collection-art-lines"><i /><i /></div></div>
      <span className="collection-art-check"><Check size={17} strokeWidth={2.5} /></span>
      <span className="collection-art-dot" />
    </div>
  </header>;
}

export function CollectionIdentity({ kind, children }) {
  const { Icon, tone } = collections[kind];
  return <span className={`collection-identity collection-tone-${tone}`}><span className="collection-row-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></span><span>{children}</span></span>;
}
