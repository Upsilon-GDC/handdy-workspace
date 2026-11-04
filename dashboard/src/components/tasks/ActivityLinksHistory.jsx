import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import axiosInstance from '../../api/axiosInstance';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import { APP_TIMEZONE } from '../../utils/appDate';

function Names({ entries = [] }) {
  if (!entries.length) return '—';
  if (entries.length <= 2) return entries.map(entry => entry.name).join(', ');
  return <details><summary>{entries.length} selected</summary><span>{entries.map(entry => entry.name).join(', ')}</span></details>;
}

export default function ActivityLinksHistory({ mode, refreshKey, latest, page, onPageChange }) {
  const [records, setRecords] = useState([]), [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    axiosInstance.get('/projects/activity-links/history', { params: { mode, page, limit: 10 } })
      .then(({ data }) => {
        if (!active) return;
        setRecords(data.history || []); setTotalPages(data.totalPages || 1); setError('');
      })
      .catch(reason => { if (active) setError(getApiErrorMessage(reason, 'Unable to load link history.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, page, refreshKey, attempt]);
  const rows = [...new Map([...(page === 1 && latest?.mode === mode ? [latest] : []), ...records].map(row => [String(row._id), row])).values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b._id).localeCompare(String(a._id))).slice(0, 10);
  return <section className="activity-links-history" aria-label="Link history">
    <header><div><h3><History size={18} aria-hidden="true" />History</h3><p>Completed link and unlink actions, newest first.</p></div></header>
    {error && <div role="alert" className="admin-error-box"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Retry history</button></div>}
    {loading && <p role="status">Loading history…</p>}
    {!loading && !rows.length && !error && <p className="activity-history-empty">No completed changes recorded yet. Your next successful save will appear here.</p>}
    {rows.length > 0 && <div className="activity-history-table"><table><thead><tr><th>When</th><th>Action</th><th>Projects</th><th>Clients</th>{mode === 'tasks' && <th>Tasks</th>}<th>Connections</th><th>By</th></tr></thead><tbody>{rows.map(row => <tr key={row._id}>
      <td><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('en-IN', { timeZone: APP_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' })}</time></td>
      <td><span className={`activity-history-action ${row.action}`}>{row.action === 'link' ? 'Linked' : 'Unlinked'}</span></td>
      <td><Names entries={row.projects} /></td><td><Names entries={row.clients} /></td>{mode === 'tasks' && <td><Names entries={row.tasks} /></td>}<td>{row.combinationCount}</td><td>{row.actorName || 'User'}</td>
    </tr>)}</tbody></table></div>}
    {totalPages > 1 && <nav className="activity-history-pagination" aria-label="History pages"><button type="button" disabled={loading || page <= 1} onClick={() => { setLoading(true); onPageChange(page - 1); }}>Previous</button><span>Page {page} of {totalPages}</span><button type="button" disabled={loading || page >= totalPages} onClick={() => { setLoading(true); onPageChange(page + 1); }}>Next</button></nav>}
  </section>;
}
