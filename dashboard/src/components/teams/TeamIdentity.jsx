import { CodeXml, FileSearch, ReceiptText, UsersRound } from 'lucide-react';
import '../../styles/teamIdentity.css';

const identities = {
  audit: { Icon: FileSearch, service: 'Audit team' },
  tax: { Icon: ReceiptText, service: 'Tax team' },
  software: { Icon: CodeXml, service: 'Software team' },
  general: { Icon: UsersRound, service: 'Team' },
};
function identityFor(name) {
  const value = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/\b(software|development|engineering)\b/.test(value)) return 'software';
  if (/\b(renau|renan|rena|tax)\b/.test(value)) return 'tax';
  if (/\b(wcpa|wcap|audit)\b/.test(value)) return 'audit';
  return 'general';
}

export function TeamLogo({ name, small = false }) {
  const kind = identityFor(name);
  const { Icon, service } = identities[kind];
  return <span className={`team-logo team-logo--${kind}${small ? ' team-logo--small' : ''}`} data-team-service={kind}
    title={`${name || 'Team'} - ${service}`} aria-hidden="true"><Icon size={small ? 16 : 22} strokeWidth={1.8} /><i /></span>;
}

export default function TeamIdentity({ name, showService = false, small = true }) {
  return <span className="team-identity"><TeamLogo name={name} small={small} /><span className="team-identity-copy"><span>{name || 'Team'}</span>
    {showService && <small>{identities[identityFor(name)].service}</small>}</span></span>;
}

export function TeamList({ teams = [], emptyLabel = 'All teams' }) {
  const rows = (Array.isArray(teams) ? teams : []).filter(Boolean);
  return rows.length ? <span className="team-identity-list">{rows.map((team, index) => <TeamIdentity key={team?._id || team?.teamName || index}
    name={typeof team === 'string' ? team : team.teamName || 'Team'} />)}</span> : emptyLabel;
}
