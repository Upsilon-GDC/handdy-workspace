import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Lock, RotateCcw, Save, Search, ShieldCheck, UserRound } from "lucide-react";

import DashboardLayout from "../../components/layout/DashboardLayout";
import useAuth from "../../context/useAuth";
import {
  getEmployeePermissions,
  getPermissionConfig,
  saveEmployeePermissions,
  saveRolePermissions,
} from "../../api/permissionApi";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import {
  NO_OVERRIDES,
  clearPersonPermission,
  countOverrideChanges,
  effectivePersonPermissions,
  overrideCount,
  overrideState,
  setPersonPermission,
} from "../../utils/personPermissions";

import "../../styles/adminPermissions.css";

const ENFORCEMENT_LABELS = {
  backend: "Enforced by the server",
  frontend: "Screen only",
  none: "Not used yet",
};

// A permission without `roles` applies to every configurable role.
const appliesTo = (permission, role) => !permission.roles || permission.roles.includes(role);

const MODES = [
  { key: "role", label: "By role", icon: ShieldCheck },
  { key: "employee", label: "By employee", icon: UserRound },
];

const FILTERS = [
  { key: "all", label: "All" },
  { key: "enabled", label: "Enabled" },
  { key: "disabled", label: "Disabled" },
  { key: "sensitive", label: "Sensitive" },
];
const PERSON_FILTERS = [...FILTERS, { key: "personal", label: "Personal" }];

const sameSet = (a, b) => a.length === b.length && a.every((key) => b.includes(key));
const overridesOf = (person) => ({ granted: person?.granted || [], revoked: person?.revoked || [] });
const sameOverrides = (a, b) => sameSet(a.granted, b.granted) && sameSet(a.revoked, b.revoked);
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";

function AdminPermissions() {
  const { user } = useAuth();
  const canManage = ["admin", "alpha", "manager"].includes(user?.role);
  const [mode, setMode] = useState("role");
  const [config, setConfig] = useState(null);
  const [activeRole, setActiveRole] = useState("");
  // Saved (server) grants per role, and the unsaved checkbox state per role.
  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});
  // "By employee": people as last saved (with their personal exceptions) and
  // the unsaved exceptions per person.
  const [people, setPeople] = useState([]);
  const [peopleError, setPeopleError] = useState("");
  const [personId, setPersonId] = useState("");
  const [personDraft, setPersonDraft] = useState({});
  const [personQuery, setPersonQuery] = useState("");
  const [personRole, setPersonRole] = useState("all");
  const [loading, setLoading] = useState(canManage);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setPeopleError("");
    const [configResult, peopleResult] = await Promise.allSettled([getPermissionConfig(), getEmployeePermissions()]);
    if (configResult.status === "fulfilled") {
      const data = configResult.value;
      const grants = Object.fromEntries(data.roles.map((role) => [role.role, role.permissions]));
      setConfig(data);
      setSaved(grants);
      setDraft(grants);
      setActiveRole((current) => current || data.roles[0]?.role || "");
    } else {
      setError(getApiErrorMessage(configResult.reason, "Unable to load permissions."));
    }
    if (peopleResult.status === "fulfilled") setPeople(peopleResult.value);
    else setPeopleError(getApiErrorMessage(peopleResult.reason, "Unable to load employees."));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  const roleLabel = (role) => config?.roles.find((item) => item.role === role)?.label || role;
  // Switches that can have an effect for a role; the server ignores the rest.
  const applicableKeys = (role) => (config?.categories || [])
    .flatMap((category) => category.permissions.filter((permission) => appliesTo(permission, role)))
    .map((permission) => permission.key);
  const sensitiveKeys = new Set((config?.categories || [])
    .flatMap((category) => category.permissions.filter((permission) => permission.sensitive).map((permission) => permission.key)));

  // The subject being edited: a role, or one person (who starts from their role).
  const person = mode === "employee" ? people.find((item) => item.id === personId) || null : null;
  const subjectRole = mode === "role" ? activeRole : person?.role || "";
  const activeLabel = mode === "role"
    ? config?.roles.find((role) => role.role === activeRole)?.label || "this role"
    : person?.fullName || "this employee";
  const personSaved = person ? overridesOf(person) : NO_OVERRIDES;
  const personCurrent = person ? personDraft[person.id] || personSaved : NO_OVERRIDES;
  const personRoleGrants = person ? saved[person.role] || [] : [];

  const current = mode === "role"
    ? draft[activeRole] || []
    : person ? effectivePersonPermissions(personRoleGrants, personCurrent, applicableKeys(person.role)) : [];
  const isDirty = (role) => !sameSet(draft[role] || [], saved[role] || []);
  const isPersonDirty = (item) => Boolean(personDraft[item.id]) && !sameOverrides(personDraft[item.id], overridesOf(item));
  const dirty = mode === "role" ? Boolean(activeRole) && isDirty(activeRole) : Boolean(person) && isPersonDirty(person);
  const totalPermissions = applicableKeys(subjectRole).length;
  const changedCount = (() => {
    if (mode === "employee") return countOverrideChanges(personSaved, personCurrent);
    const before = saved[activeRole] || [];
    return current.filter((key) => !before.includes(key)).length + before.filter((key) => !current.includes(key)).length;
  })();
  const personalIn = (role) => people.filter((item) => item.role === role && overrideCount(item) > 0).length;

  // Categories reduced to the permissions that match the search and filter.
  const needle = query.trim().toLowerCase();
  const visibleCategories = (config?.categories || []).map((category) => ({
    ...category,
    shown: category.permissions.filter((permission) => {
      if (needle && !`${permission.label} ${permission.description || ""}`.toLowerCase().includes(needle)) return false;
      if (filter === "enabled") return current.includes(permission.key);
      if (filter === "disabled") return !current.includes(permission.key);
      if (filter === "sensitive") return Boolean(permission.sensitive);
      if (filter === "personal") return Boolean(overrideState(personCurrent, permission.key));
      return true;
    }),
  })).filter((category) => category.shown.length);

  const personNeedle = personQuery.trim().toLowerCase();
  const shownPeople = people.filter((item) => (personRole === "all" || item.role === personRole)
    && (!personNeedle || `${item.fullName} ${item.employeeId} ${item.email} ${item.team} ${roleLabel(item.role)}`
      .toLowerCase().includes(personNeedle)));

  const updatePerson = (change) => {
    setMessage("");
    setPersonDraft((previous) => ({ ...previous, [person.id]: change(previous[person.id] || overridesOf(person)) }));
  };

  const setKeys = (keys, on) => {
    if (mode === "employee") {
      updatePerson((overrides) => keys.reduce((next, key) => setPersonPermission(next, key, on, personRoleGrants), overrides));
      return;
    }
    setMessage("");
    setDraft((previous) => {
      const granted = new Set(previous[activeRole] || []);
      for (const key of keys) { if (on) granted.add(key); else granted.delete(key); }
      return { ...previous, [activeRole]: [...granted] };
    });
  };

  const setMany = (permissions, on) => setKeys(
    permissions.filter((permission) => appliesTo(permission, subjectRole)).map((permission) => permission.key), on);
  const toggle = (key) => setKeys([key], !current.includes(key));

  const toggleCategory = (key) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const switchMode = (next) => {
    setMode(next);
    setMessage("");
    if (filter === "personal") setFilter("all");
  };

  const dropPersonDraft = (id) => setPersonDraft((previous) => {
    const next = { ...previous };
    delete next[id];
    return next;
  });

  const reset = () => {
    if (mode === "role") setDraft((previous) => ({ ...previous, [activeRole]: saved[activeRole] || [] }));
    else if (person) dropPersonDraft(person.id);
    setMessage("");
    setError("");
  };

  const save = async () => {
    const before = mode === "role"
      ? saved[activeRole] || []
      : effectivePersonPermissions(personRoleGrants, personSaved, applicableKeys(person.role));
    const newlySensitive = current.filter((key) => sensitiveKeys.has(key) && !before.includes(key));
    const who = mode === "role" ? `every ${activeLabel} account` : activeLabel;
    if (newlySensitive.length && !window.confirm(
      `You are granting ${newlySensitive.length} sensitive permission(s) to ${who}. Continue?`,
    )) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      if (mode === "role") {
        const response = await saveRolePermissions(activeRole, current);
        setSaved((previous) => ({ ...previous, [activeRole]: response.role.permissions }));
        setDraft((previous) => ({ ...previous, [activeRole]: response.role.permissions }));
      } else {
        const response = await saveEmployeePermissions(person.id, personCurrent);
        setPeople((previous) => previous.map((item) => (item.id === response.employee.id ? response.employee : item)));
        dropPersonDraft(person.id);
      }
      setMessage(`Permissions for ${activeLabel} saved.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to save permissions."));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <DashboardLayout title="Permissions">
        <section className="permissions-page"><p className="card" role="alert">Only an administrator or manager can manage permissions.</p></section>
      </DashboardLayout>
    );
  }

  const filters = mode === "employee" ? PERSON_FILTERS : FILTERS;
  const personalHere = mode === "employee" ? overrideCount(personCurrent) : personalIn(activeRole);

  const editor = (
    <>
      <div className="permissions-toolbar card">
        <label className="permissions-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${activeLabel} permissions…`}
            aria-label="Search permissions"
          />
        </label>
        <div className="permissions-filters" role="group" aria-label="Filter permissions">
          {filters.map((item) => (
            <button key={item.key} type="button" aria-pressed={filter === item.key}
              className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <span className="permissions-summary">
          <strong>{current.length}</strong> of {totalPermissions} enabled for {activeLabel}
          {personalHere > 0 && (mode === "employee"
            ? <> · {personalHere} personal</>
            : <> · {personalHere} {personalHere === 1 ? "person has" : "people have"} personal settings</>)}
        </span>
      </div>

      {!visibleCategories.length && (
        <p className="permissions-empty card" role="status">No permissions match your search or filter.</p>
      )}

      {visibleCategories.map((category) => {
        const enabledHere = category.permissions.filter((permission) => current.includes(permission.key)).length;
        const isCollapsed = collapsed.has(category.key);
        return (
          <section key={category.key} className="permissions-category card">
            <header className="permissions-category-head">
              <button type="button" className="permissions-collapse" aria-expanded={!isCollapsed}
                onClick={() => toggleCategory(category.key)}>
                <ChevronDown size={18} className={isCollapsed ? "is-collapsed" : ""} aria-hidden="true" />
                <h3>{category.label}</h3>
                <span className="permissions-count">{enabledHere}/{category.permissions.length} enabled</span>
              </button>
              <div className="permissions-bulk">
                <button type="button" onClick={() => setMany(category.shown, true)}>Select all</button>
                <button type="button" onClick={() => setMany(category.shown, false)}>Clear</button>
              </div>
            </header>
            {!isCollapsed && (
              <ul className="permissions-grid">
                {category.shown.map((permission) => {
                  const available = appliesTo(permission, subjectRole);
                  const on = available && current.includes(permission.key);
                  const weak = permission.enforcement !== "backend";
                  const personal = mode === "employee" && available ? overrideState(personCurrent, permission.key) : null;
                  return (
                    <li key={permission.key}>
                      <label className={`permissions-item${on ? " is-on" : ""}${available ? "" : " is-unavailable"}`}>
                        <input type="checkbox" role="switch" className="permissions-switch" checked={on}
                          disabled={!available} onChange={() => toggle(permission.key)} />
                        <span className="permissions-item-text">
                          <strong>{permission.label}</strong>
                          {permission.description && <span className="permissions-description">{permission.description}</span>}
                          <span className="permissions-tags">
                            {personal && (
                              <em className="permissions-tag is-personal"
                                title={`${roleLabel(subjectRole)} role: ${personRoleGrants.includes(permission.key) ? "on" : "off"}`}>
                                Personal · {personal}
                                <button type="button" className="permissions-tag-reset"
                                  onClick={(event) => { event.preventDefault(); updatePerson((overrides) => clearPersonPermission(overrides, permission.key)); }}>
                                  Use role setting
                                </button>
                              </em>
                            )}
                            {!available && <em className="permissions-tag is-none">Not available for {roleLabel(subjectRole)}</em>}
                            {permission.sensitive && <em className="permissions-tag is-sensitive"><AlertTriangle size={11} aria-hidden="true" />Sensitive</em>}
                            {weak
                              ? <em className={`permissions-tag is-${permission.enforcement}`}>{ENFORCEMENT_LABELS[permission.enforcement]}</em>
                              : <em className="permissions-ok" title={ENFORCEMENT_LABELS.backend}><CheckCircle2 size={13} aria-hidden="true" />Server enforced</em>}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <div className="permissions-actions card">
        <span role="status" className={dirty ? "permissions-dirty" : ""}>{message || (dirty ? `${changedCount} unsaved change${changedCount === 1 ? "" : "s"} for ${activeLabel}.` : "No unsaved changes.")}</span>
        <div>
          <button type="button" className="permissions-reset" onClick={reset} disabled={!dirty || saving}><RotateCcw size={16} />Discard changes</button>
          <button type="button" className="permissions-save" onClick={save} disabled={!dirty || saving}><Save size={16} />{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </>
  );

  return (
    <DashboardLayout title="Permissions">
      <section className="permissions-page">
        <header className="permissions-hero card">
          <div>
            <span className="permissions-kicker">Access control</span>
            <h2>{mode === "role" ? "Role permissions" : "Employee permissions"}</h2>
            <p>
              {mode === "role"
                ? "Choose what each role can do. Changes apply to every account with that role, except where a person has their own setting. Administrators, managers and the alpha role always keep full access."
                : "Give one person more or less access than their role. Everything you don't change here keeps following the role. Administrators, managers and the alpha role always keep full access."}
            </p>
          </div>
          <div className="permissions-modes" role="tablist" aria-label="Set permissions">
            {MODES.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.key} type="button" role="tab" aria-selected={mode === item.key}
                  className={mode === item.key ? "is-active" : ""} onClick={() => switchMode(item.key)}>
                  <Icon size={16} aria-hidden="true" />{item.label}
                </button>
              );
            })}
          </div>
        </header>

        {loading && <p role="status">Loading permissions…</p>}
        {error && <p className="permissions-message is-error" role="alert">{error}</p>}

        {config && mode === "role" && (
          <>
            <div className="permissions-roles card">
              <div className="permissions-tabs" role="tablist" aria-label="Role">
                {config.roles.map((role) => (
                  <button
                    key={role.role}
                    type="button"
                    role="tab"
                    aria-selected={activeRole === role.role}
                    className={activeRole === role.role ? "is-active" : ""}
                    onClick={() => { setActiveRole(role.role); setMessage(""); }}
                  >
                    <span className="permissions-tab-name">{role.label}{isDirty(role.role) && <span className="permissions-unsaved" title="Unsaved changes" />}</span>
                    <small>{(draft[role.role] || []).length} of {applicableKeys(role.role).length} enabled</small>
                  </button>
                ))}
              </div>
              <span className="permissions-fixed"><Lock size={14} /> Admin and Manager keep full access (not editable)</span>
            </div>
            {editor}
          </>
        )}

        {config && mode === "employee" && (
          <>
            {peopleError && <p className="permissions-message is-error" role="alert">{peopleError}</p>}
            <div className="permissions-people card">
              <div className="permissions-people-tools">
                <label className="permissions-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={personQuery}
                    onChange={(event) => setPersonQuery(event.target.value)}
                    placeholder="Search by name, employee ID, email or team…"
                    aria-label="Search employees"
                  />
                </label>
                <div className="permissions-filters" role="group" aria-label="Filter employees by role">
                  {[{ key: "all", label: "All roles" }, ...config.roles.map((role) => ({ key: role.role, label: role.label }))].map((item) => (
                    <button key={item.key} type="button" aria-pressed={personRole === item.key}
                      className={personRole === item.key ? "is-active" : ""} onClick={() => setPersonRole(item.key)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <span className="permissions-fixed"><Lock size={14} /> Admins and managers are not listed (full access)</span>
              </div>
              {shownPeople.length ? (
                <ul className="permissions-people-list" aria-label="Employees">
                  {shownPeople.map((item) => {
                    const personal = overrideCount(personDraft[item.id] || item);
                    return (
                      <li key={item.id}>
                        <button type="button" aria-pressed={item.id === personId}
                          className={item.id === personId ? "is-active" : ""}
                          onClick={() => { setPersonId(item.id); setMessage(""); }}>
                          <span className="permissions-tab-name">{item.fullName}{isPersonDirty(item) && <span className="permissions-unsaved" title="Unsaved changes" />}</span>
                          <small>{roleLabel(item.role)}{item.team ? ` · ${item.team}` : ""}</small>
                          {personal > 0 && <em className="permissions-tag is-personal">{personal} personal</em>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="permissions-people-empty" role="status">
                  {people.length ? "No employees match your search." : "No active employees to show."}
                </p>
              )}
            </div>

            {!person && (
              <p className="permissions-empty card" role="status">Choose an employee to see and change their permissions.</p>
            )}

            {person && (
              <>
                <div className="permissions-person card">
                  <span className="permissions-avatar" aria-hidden="true">{initials(person.fullName)}</span>
                  <div className="permissions-person-text">
                    <strong>{person.fullName}</strong>
                    <span>{[roleLabel(person.role), person.team, person.employeeId, person.email].filter(Boolean).join(" · ")}</span>
                    <p>
                      Switches follow the {roleLabel(person.role)} role unless you change them here. Changed switches are
                      marked “Personal” and stay until you reset them, even if the role changes later.
                    </p>
                  </div>
                  <button type="button" className="permissions-reset" onClick={() => updatePerson(() => ({ granted: [], revoked: [] }))}
                    disabled={!overrideCount(personCurrent) || saving}>
                    <RotateCcw size={16} />Use role settings for all
                  </button>
                </div>
                {editor}
              </>
            )}
          </>
        )}
      </section>
    </DashboardLayout>
  );
}

export default AdminPermissions;
