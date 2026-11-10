import { useEffect, useState } from 'react';
import axiosInstance from '../../api/axiosInstance';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import BatchActivityLinksForm from './BatchActivityLinksForm';
import ActivityLinksHistory from './ActivityLinksHistory';
import '../../styles/activityLinks.css';

const ignoreBusy = () => {};

export default function ActivityLinksEditor({ clientsOnly = false, onBusyChange = ignoreBusy, allInOne = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [historyPage, setHistoryPage] = useState(1), [historyRevision, setHistoryRevision] = useState(0), [latestHistory, setLatestHistory] = useState(null);
  useEffect(() => {
    let active = true;
    axiosInstance.get('/projects/activity-links')
      .then(response => { if (active) setData(response.data); })
      .catch(reason => { if (active) setError(getApiErrorMessage(reason, 'Unable to load links. Try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  const reload = () => { setData(null); setLoading(true); setError(''); setAttempt(value => value + 1); };
  const history = <ActivityLinksHistory mode={clientsOnly ? 'clients' : 'tasks'} refreshKey={historyRevision} latest={latestHistory} page={historyPage} onPageChange={setHistoryPage} />;
  return <>
    {error && <div role="alert" className="admin-error-box"><p>{error}</p><button type="button" onClick={reload}>Retry loading links</button></div>}
    {loading && <p role="status">Loading activity links…</p>}
    {data && <BatchActivityLinksForm data={data} clientProjectsOnly={clientsOnly} allInOne={allInOne} onBusyChange={onBusyChange} onReload={reload} onSaved={entry => {
      setLatestHistory(entry || null); setHistoryPage(1); setHistoryRevision(value => value + 1);
    }} onRefresh={async () => {
      const response = await axiosInstance.get('/projects/activity-links');
      setData(response.data);
    }} />}
    {allInOne ? <details className="setup-history"><summary>View previous changes</summary>{history}</details> : history}
  </>;
}
