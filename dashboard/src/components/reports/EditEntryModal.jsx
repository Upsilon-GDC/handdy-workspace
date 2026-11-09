import { useEffect, useState } from 'react';
import ModalFrame from '../layout/ModalFrame';
import SearchableSelect from './SearchableSelect';
import { getEntryForEdit, saveEntryEdit } from '../../api/timeEntryEditApi';
import { buildTimeLogTimeline } from '../../utils/timeLogTimeline';
import { editEntryPayload, localEntryTime, entryTimeIso, selectedEntrySegment } from '../../utils/timeEntryEditing';
import { APP_TIMEZONE } from '../../utils/appDate';
import getApiErrorMessage from '../../utils/getApiErrorMessage';
import '../../styles/addEntryModal.css';
import '../../styles/editEntryModal.css';
const id = value => String(value?._id || value || '');
export default function EditEntryModal({ entry, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    let active = true;
    getEntryForEdit(entry.record._id).then(data => {
      if (!active) return;
      let selected;
      try { selected = selectedEntrySegment(data.record, entry.entry); }
      catch (error) { setError(error.message); return; }
      setSelection(selected);
      setData(data);
      setForm({ project: id(data.record.project), client: id(data.record.client), task: id(data.record.task), note: data.record.note || '', reason: '',
        segments: buildTimeLogTimeline(data.record).map(segment => ({ type: segment.type, start: localEntryTime(segment.start), end: localEntryTime(segment.end) })) });
    }).catch(error => { if (active) setError(getApiErrorMessage(error, 'Unable to load the entry.')); });
    return () => { active = false; };
  }, [entry.record._id, entry.entry]);
  const set = (field, value) => {
    setError(''); setReviewing(false);
    setForm(previous => {
      const next = { ...previous, [field]: value };
      if (field === 'project') {
        const project = data.options.projects.find(project => id(project) === value);
        next.client = project?.clientIds?.length === 1 ? project.clientIds[0] : '';
        next.task = '';
      }
      if (field === 'client') next.task = '';
      if (field === 'task' && value) {
        const oldType = (data.options.tasks.find(task => id(task) === previous.task)?.taskType || data.record.task.taskType) === 'break' ? 'break' : 'work';
        const newType = data.options.tasks.find(task => id(task) === value)?.taskType === 'break' ? 'break' : 'work';
        if (oldType !== newType) next.segments = previous.segments.map(segment => segment.type === oldType ? { ...segment, type: newType } : segment);
      }
      return next;
    });
  };
  const setSegment = (index, field, value) => {
    setError(''); setReviewing(false);
    setForm(previous => {
      const segments = previous.segments.map(segment => ({ ...segment }));
      segments[index][field] = value;
      if (field === 'start' && index > 0) segments[index - 1].end = value;
      if (field === 'end' && index < segments.length - 1) segments[index + 1].start = value;
      return { ...previous, segments };
    });
  };
  const project = data?.options.projects.find(project => id(project) === form?.project);
  const keepsOriginalActivity = !!data && form?.project === id(data.record.project) && form?.client === id(data.record.client) && form?.task === id(data.record.task);
  const clients = (data?.options.clients || []).filter(client => !Array.isArray(project?.clientIds) || project.clientIds.includes(id(client)));
  const tasks = (data?.options.tasks || []).filter(task => id(task.project) === form?.project
    && (!project?.mappingEnabled || (form?.client && task.clientIds?.includes(form.client))
      || (id(task) === id(data.record.task) && form?.project === id(data.record.project) && form?.client === id(data.record.client))));
  const taskType = tasks.find(task => id(task) === form?.task)?.taskType === 'break' ? 'break' : 'work';
  const selectedSegment = form?.segments[selection?.index];
  const gapError = () => selection?.gap && +new Date(entryTimeIso(selectedSegment.end)) >= +new Date(selection.end)
    ? 'The gap must start before the following entry starts.' : '';
  const review = event => {
    event.preventDefault();
    const result = editEntryPayload(form, data.record);
    if (result.error) { setError(result.error); return; }
    if (gapError()) { setError(gapError()); return; }
    if (project?.mappingEnabled && !form.client && !keepsOriginalActivity) { setError('Select a linked client.'); return; }
    setError(''); setReviewing(true);
  };
  const save = async () => {
    const result = editEntryPayload(form, data.record);
    if (!result.payload) { setError(result.error); setReviewing(false); return; }
    if (gapError()) { setError(gapError()); setReviewing(false); return; }
    setSaving(true);
    try { await saveEntryEdit(data.record._id, result.payload); onSaved?.(); onClose(); }
    catch (error) { setError(getApiErrorMessage(error, 'Unable to save the correction.')); setReviewing(false); }
    finally { setSaving(false); }
  };
  const options = (list, field) => list.map(value => ({ value: id(value), label: value[field] }));
  return <ModalFrame onClose={saving ? undefined : onClose} label="Edit time entry">
    <div className="employee-modal add-entry-modal edit-entry-modal">
      <div className="employee-modal-header"><div><p className="admin-eyebrow">ADMINISTRATIVE CORRECTION</p><h2>{selection?.gap ? 'Edit between-task gap' : 'Edit selected segment'}</h2>
        <p>{data?.employee.fullName || 'Loading entry…'}</p></div><button type="button" aria-label="Close" className="modal-close-button" disabled={saving} onClick={onClose}>×</button></div>
      {error && <p className="add-entry-alert" role="alert">{error}</p>}
      {selection?.gap && <p className="add-entry-hint">This gap is calculated between two entries. Change its start to adjust the preceding entry’s finish. Its finish is the following entry’s start; edit that entry separately to change it.</p>}
      {form && !reviewing && <form onSubmit={review} className="employee-form">
        {!selection.gap && <p className="add-entry-hint">Only the segment you clicked is shown. A shared boundary also updates the adjacent segment’s boundary. Project, client, task and note belong to the whole saved entry. Times use {APP_TIMEZONE}.</p>}
        {selection.gap ? <p className="add-entry-hint">Preceding activity: {project?.projectName} · {tasks.find(task => id(task) === form.task)?.taskName}. Times use {APP_TIMEZONE}.</p> : <>
        <div className="employee-form-grid">
          <SearchableSelect label="Project" value={form.project} options={options(data.options.projects, 'projectName')} onChange={value => set('project', value)} />
          <SearchableSelect label={project?.mappingEnabled && !keepsOriginalActivity ? 'Client' : 'Client (original or optional)'} value={form.client} options={options(clients, 'clientName')} onChange={value => set('client', value)} />
          <SearchableSelect label="Task" value={form.task} options={options(tasks, 'taskName')} onChange={value => set('task', value)} />
        </div>
        </>}
        <div className="edit-entry-segments">{selection.gap ? <fieldset className="edit-entry-selected-segment edit-entry-gap"><legend>Between tasks</legend>
          <label>Started<input aria-label="Gap started" type="datetime-local" step="0.001" required value={selectedSegment.end} onChange={event => setSegment(selection.index, 'end', event.target.value)} /></label>
          <label>Finished (following entry starts)<input aria-label="Gap finished" type="datetime-local" step="0.001" readOnly value={localEntryTime(selection.end)} /></label>
        </fieldset> : form.segments.map((segment, index) => index === selection.index && <fieldset key={index} className="edit-entry-selected-segment">
          <legend>Selected segment</legend>
          <label>Type<select aria-label={`Segment ${index + 1} type`} value={segment.type} onChange={event => setSegment(index, 'type', event.target.value)}>
            {taskType !== 'break' && <option value="work">Work</option>}<option value="break">Break</option><option value="idle">Idle</option></select></label>
          <label>Started<input aria-label={`Segment ${index + 1} started`} type="datetime-local" step="0.001" required value={segment.start} onChange={event => setSegment(index, 'start', event.target.value)} /></label>
          <label>Finished<input aria-label={`Segment ${index + 1} finished`} type="datetime-local" step="0.001" required value={segment.end} onChange={event => setSegment(index, 'end', event.target.value)} /></label>
        </fieldset>)}</div>
        {!selection.gap && <label>Note<textarea aria-label="Entry note" maxLength={2000} value={form.note} onChange={event => set('note', event.target.value)} /></label>}
        <label>Reason for correction<textarea aria-label="Reason for correction" required minLength={5} maxLength={500} value={form.reason} onChange={event => set('reason', event.target.value)} /></label>
        <div className="employee-form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Review correction</button></div>
      </form>}
      {reviewing && <div className="edit-entry-review"><h3>Confirm correction</h3><p>{selection.gap ? 'This adjusts the preceding entry’s finish and recalculates the gap.' : 'This updates the selected segment’s timing. Shared boundaries remain connected; activity and note changes apply to the whole entry.'} The original and corrected values are retained in the audit history.</p>
        <dl><dt>Project</dt><dd>{project?.projectName}</dd><dt>Task</dt><dd>{tasks.find(task => id(task) === form.task)?.taskName}</dd><dt>Start</dt><dd>{(selection.gap ? selectedSegment.end : selectedSegment.start).replace('T', ' ')}</dd><dt>Finish</dt><dd>{(selection.gap ? localEntryTime(selection.end) : selectedSegment.end).replace('T', ' ')}</dd><dt>Reason</dt><dd>{form.reason}</dd></dl>
        <div className="employee-form-actions"><button type="button" disabled={saving} onClick={() => setReviewing(false)} className="secondary-button">Back</button><button type="button" disabled={saving} onClick={save} className="primary-button">{saving ? 'Saving…' : 'Confirm and save correction'}</button></div>
      </div>}
      {data && <details className="edit-entry-history"><summary>Correction history ({data.history.length}{data.history.length === 20 ? '+' : ''})</summary>
        {data.history.length === 0 ? <p>No previous corrections.</p> : <ol>{data.history.map(edit => <li key={edit._id}>Revision {edit.revision} · {edit.editedBy?.fullName || 'Administrator'} · {localEntryTime(edit.createdAt).replace('T', ' ')}<p>{edit.reason}</p></li>)}</ol>}
      </details>}
    </div>
  </ModalFrame>;
}
