import { useEffect, useMemo, useState } from "react";

import ModalFrame from "../layout/ModalFrame";
import SearchableSelect from "./SearchableSelect";
import { createManualEntry, getManualEntryOptions } from "../../api/manualEntryApi";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import { APP_TIMEZONE } from "../../utils/appDate";
import {
  emptyEntryForm,
  formatEntryDuration,
  projectsForClient,
  tasksForProject,
  validateEntryForm,
} from "../../utils/manualEntry";

import "../../styles/addEntryModal.css";

// Manual timesheet entry for one employee. Everything shown is loaded in a
// single request; the server re-checks permission, assignment and overlap.
export default function AddEntryModal({ employee, onClose, onSaved }) {
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(() => emptyEntryForm());
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let active = true;
    getManualEntryOptions(employee.id)
      .then((data) => { if (active) setOptions(data); })
      .catch((error) => { if (active) setLoadError(getApiErrorMessage(error, "Unable to load clients, projects and tasks.")); });
    return () => { active = false; };
  }, [employee.id]);

  const set = (field) => (value) => {
    setSubmitError("");
    setConfirming(false);
    setForm((previous) => {
      const next = { ...previous, [field]: value };
      // Changing a parent clears children that no longer belong to it.
      if (field === "client" && next.project && !projectsForClient(options, value).some((project) => project._id === next.project)) {
        next.project = "";
        next.task = "";
      }
      if (field === 'client') next.task = '';
      if (field === "project") {
        next.task = "";
        const project = options?.projects.find(project => project._id === value);
        if (!(project?.clientIds || []).includes(next.client)) next.client = project?.clientIds?.length === 1 ? project.clientIds[0] : '';
      }
      return next;
    });
  };

  const clientOptions = useMemo(() => (options?.clients || []).filter(client => {
    const project = options?.projects.find(project => project._id === form.project);
    return !project || !Array.isArray(project.clientIds) || project.clientIds.includes(client._id);
  }).map((client) => ({ value: client._id, label: client.clientName })), [options, form.project]);
  const projectOptions = useMemo(() => projectsForClient(options, '')
    .map((project) => ({ value: project._id, label: `${project.projectName}${project.projectCode ? ` (${project.projectCode})` : ""}` })), [options]);
  const taskOptions = useMemo(() => tasksForProject(options, form.project, form.client)
    .map((task) => ({ value: task._id, label: `${task.taskName}${task.taskCode ? ` (${task.taskCode})` : ""}` })), [options, form.project, form.client]);

  const result = useMemo(() => validateEntryForm(form, options, employee.id), [form, options, employee.id]);
  const errors = touched ? result.errors : {};
  const labelOf = (list, value) => list.find((item) => item.value === value)?.label || "—";

  const review = (event) => {
    event.preventDefault();
    setTouched(true);
    if (result.payload) setConfirming(true);
  };

  const save = async () => {
    setSaving(true);
    setSubmitError("");
    try {
      const response = await createManualEntry(result.payload);
      onSaved?.(response.timeLog, form);
      onClose();
    } catch (error) {
      setConfirming(false);
      setSubmitError(getApiErrorMessage(error, "Unable to save the entry."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame onClose={saving ? undefined : onClose} label="Add timesheet entry">
      <div className="employee-modal add-entry-modal">
        <div className="employee-modal-header">
          <div>
            <p className="admin-eyebrow">MANUAL TIMESHEET ENTRY</p>
            <h2>Add entry</h2>
            <p className="add-entry-subtitle">For {employee.name}. Manual entries are labelled and audited; existing timer sessions are never changed.</p>
          </div>
          <button type="button" className="modal-close-button" onClick={onClose} disabled={saving} aria-label="Close">×</button>
        </div>

        {loadError && <p className="add-entry-alert" role="alert">{loadError}</p>}
        {!options && !loadError && <p role="status">Loading clients, projects and tasks…</p>}

        {options && !confirming && (
          <form className="employee-form" onSubmit={review} noValidate>
            <div className="employee-form-grid">
              <div><label>Employee</label><input type="text" value={`${options.employee.fullName} (${options.employee.employeeId})`} readOnly /></div>
              <SearchableSelect label="Project" options={projectOptions} value={form.project} onChange={set("project")} placeholder="Search projects" error={errors.project} emptyText="No assigned projects" />
              <SearchableSelect label={options.projects.find(project => project._id === form.project)?.mappingEnabled ? 'Client' : 'Client (optional)'} options={clientOptions} value={form.client} onChange={set("client")} placeholder="Select client" error={errors.client} emptyText="No linked clients" />
              <SearchableSelect label="Task" options={taskOptions} value={form.task} onChange={set("task")} placeholder={form.project ? "Search tasks" : "Select a project first"} disabled={!form.project} error={errors.task} emptyText="No tasks assigned for this project" />
              <div><label htmlFor="entry-date">Date</label><input id="entry-date" type="date" value={form.date} onChange={(event) => set("date")(event.target.value)} />{errors.date && <small className="field-error" role="alert">{errors.date}</small>}</div>
              <div className="add-entry-times">
                <div><label htmlFor="entry-start">Start time</label><input id="entry-start" type="time" value={form.startTime} onChange={(event) => set("startTime")(event.target.value)} />{errors.startTime && <small className="field-error" role="alert">{errors.startTime}</small>}</div>
                <div><label htmlFor="entry-end">End time</label><input id="entry-end" type="time" value={form.endTime} onChange={(event) => set("endTime")(event.target.value)} />{errors.endTime && <small className="field-error" role="alert">{errors.endTime}</small>}</div>
              </div>
            </div>
            <p className="add-entry-hint">Times use the company timezone ({APP_TIMEZONE}). Duration: <strong>{result.seconds > 0 ? formatEntryDuration(result.seconds) : "—"}</strong></p>
            <div>
              <label htmlFor="entry-reason">Reason for manual entry</label>
              <textarea id="entry-reason" rows={3} maxLength={500} value={form.reason} onChange={(event) => set("reason")(event.target.value)} placeholder="Why is this time being added manually?" />
              {errors.reason && <small className="field-error" role="alert">{errors.reason}</small>}
            </div>
            {submitError && <p className="add-entry-alert" role="alert">{submitError}</p>}
            <div className="employee-form-actions">
              <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
              <button type="submit" className="primary-button">Review entry</button>
            </div>
          </form>
        )}

        {options && confirming && (
          <div className="add-entry-confirm">
            <h3>Confirm manual entry</h3>
            <dl>
              <dt>Employee</dt><dd>{options.employee.fullName}</dd>
              <dt>Client</dt><dd>{form.client ? labelOf(clientOptions, form.client) : "—"}</dd>
              <dt>Project</dt><dd>{labelOf(projectOptions, form.project)}</dd>
              <dt>Task</dt><dd>{labelOf(taskOptions, form.task)}</dd>
              <dt>Date</dt><dd>{form.date}</dd>
              <dt>Time</dt><dd>{form.startTime} – {form.endTime} ({formatEntryDuration(result.seconds)})</dd>
              <dt>Reason</dt><dd>{form.reason.trim()}</dd>
            </dl>
            <p className="add-entry-hint">This will be recorded as a manual entry under your name and cannot overlap an existing record.</p>
            <div className="employee-form-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirming(false)} disabled={saving}>Back</button>
              <button type="button" className="primary-button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Confirm and save"}</button>
            </div>
          </div>
        )}
      </div>
    </ModalFrame>
  );
}
