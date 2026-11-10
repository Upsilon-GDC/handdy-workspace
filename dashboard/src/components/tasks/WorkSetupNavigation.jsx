import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import '../../styles/workSetup.css';

export default function WorkSetupNavigation({ busy = false }) {
  return <Link className="work-setup-back" to="/admin/project-client-links" aria-disabled={busy || undefined}
    onClick={event => { if (busy) event.preventDefault(); }}><ArrowLeft size={16} />Back to work setup</Link>;
}
