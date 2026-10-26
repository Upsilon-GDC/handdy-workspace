import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Lock, RotateCcw, Save, Search, ShieldCheck } from "lucide-react";

import DashboardLayout from "../../components/layout/DashboardLayout";
import useAuth from "../../context/useAuth";
import { getPermissionConfig, saveRolePermissions } from "../../api/permissionApi";
import getApiErrorMessage from "../../utils/getApiErrorMessage";

import "../../styles/adminPermissions.css";

const ENFORCEMENT_LABELS = {
  backend: "Enforced by the server",
  frontend: "Screen only",
  none: "Not used yet",
};

// A permission without `roles` applies to every configurable role.
const appliesTo = (permission, role) => !permission.roles || permission.roles.includes(role);

const FILTERS = [
  { key: "all", label: "All" },
  { key: "enabled", label: "Enabled" },
  { key: "disabled", label: "Disabled" },
  { key: "sensitive", label: "Sensitive" },
];

const sameSet = (a, b) => a.length === b.length && a.every((key) => b.includes(key));

function AdminPermissions() {
  const { user } = useAuth();
  const canManage = ["admin", "alpha"].includes(user?.role);
  const [config, setConfig] = useState(null);
  const [activeRole, setActiveRole] = useState("");
  // Saved (server) grants per role, and the unsaved checkbox state per role.
  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});
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
    try {
      const data = await getPermissionConfig();
      const grants = Object.fromEntries(data.roles.map((role) => [role.role, role.permissions]));
      setConfig(data);
      setSaved(grants);
      setDraft(grants);
      setActiveRole((current) => current || data.roles[0]?.role || "");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to load permissions."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  const sensitiveKeys = useMemo(() => new Set((config?.categories || [])
    .flatMap((category) => category.permissions.filter((permission) => permission.sensitive).map((permission) => permission.key))), [config]);
  const current = useMemo(() => draft[activeRole] || [], [draft, activeRole]);
  const dirty = Boolean(activeRole) && !sameSet(current, saved[activeRole] || []);
  const isDirty = (role) => !sameSet(draft[role] || [], saved[role] || []);
  const activeLabel = config?.roles.find((role) => role.role === activeRole)?.label || "this role";

  // Switches that can have an effect for a role; the server ignores the rest.
  const availableCount = useCallback((role) => (config?.categories || [])
    .reduce((sum, category) => sum + category.permissions.filter((permission) => appliesTo(permission, role)).length, 0), [config]);
  const totalPermissions = availableCount(activeRole);
  const changedCount = useMemo(() => {
    const before = saved[activeRole] || [];
    return current.filter((key) => !before.includes(key)).length + before.filter((key) => !current.includes(key)).length;
  }, [current, saved, activeRole]);

  // Categories reduced to the permissions that match the search and filter.
  const visibleCategories = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (config?.categories || []).map((category) => ({
      ...category,
      shown: category.permissions.filter((permission) => {
        if (needle && !`${permission.label} ${permission.description || ""}`.toLowerCase().includes(needle)) return false;
        if (filter === "enabled") return current.includes(permission.key);
        if (filter === "disabled") return !current.includes(permission.key);
        if (filter === "sensitive") return Boolean(permission.sensitive);
        return true;
      }),
    })).filter((category) => category.shown.length);
  }, [config, query, filter, current]);

  const setMany = (permissions, on) => {
    const keys = permissions.filter((permission) => appliesTo(permission, activeRole)).map((permission) => permission.key);
    setMessage("");
    setDraft((previous) => {
      const granted = new Set(previous[activeRole] || []);
      for (const key of keys) { if (on) granted.add(key); else granted.delete(key); }
      return { ...previous, [activeRole]: [...granted] };
    });
  };

  const toggleCategory = (key) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const toggle = (key) => {
    setMessage("");
    setDraft((previous) => {
      const granted = previous[activeRole] || [];
      return { ...previous, [activeRole]: granted.includes(key) ? granted.filter((item) => item !== key) : [...granted, key] };
    });
  };

  const reset = () => {
    setDraft((previous) => ({ ...previous, [activeRole]: saved[activeRole] || [] }));
    setMessage("");
    setError("");
  };

  const save = async () => {
    const newlySensitive = current.filter((key) => sensitiveKeys.has(key) && !(saved[activeRole] || []).includes(key));
    if (newlySensitive.length && !window.confirm(
      `You are granting ${newlySensitive.length} sensitive permission(s) to every ${activeLabel} account. Continue?`,
    )) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await saveRolePermissions(activeRole, current);
      setSaved((previous) => ({ ...previous, [activeRole]: response.role.permissions }));
      setDraft((previous) => ({ ...previous, [activeRole]: response.role.permissions }));
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
        <section className="permissions-page"><p className="card" role="alert">Only an administrator can manage permissions.</p></section>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Permissions">
      <section className="permissions-page">
        <header className="permissions-hero card">
          <div>
            <span className="permissions-kicker">Access control</span>
            <h2>Role permissions</h2>
            <p>Choose what each role can do. Changes apply to every account with that role. Administrators, managers and the alpha role always keep full access.</p>
          </div>
          <ShieldCheck size={34} aria-hidden="true" />
        </header>

        {loading && <p role="status">Loading permissions…</p>}
        {error && <p className="permissions-message is-error" role="alert">{error}</p>}

        {config && (
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
                    <small>{(draft[role.role] || []).length} of {availableCount(role.role)} enabled</small>
                  </button>
                ))}
              </div>
              <span className="permissions-fixed"><Lock size={14} /> Admin and Manager keep full access (not editable)</span>
            </div>

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
                {FILTERS.map((item) => (
                  <button key={item.key} type="button" aria-pressed={filter === item.key}
                    className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}>
                    {item.label}
                  </button>
                ))}
              </div>
              <span className="permissions-summary">
                <strong>{current.length}</strong> of {totalPermissions} enabled for {activeLabel}
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
                        const available = appliesTo(permission, activeRole);
                        const on = available && current.includes(permission.key);
                        const weak = permission.enforcement !== "backend";
                        return (
                          <li key={permission.key}>
                            <label className={`permissions-item${on ? " is-on" : ""}${available ? "" : " is-unavailable"}`}>
                              <input type="checkbox" role="switch" className="permissions-switch" checked={on}
                                disabled={!available} onChange={() => toggle(permission.key)} />
                              <span className="permissions-item-text">
                                <strong>{permission.label}</strong>
                                {permission.description && <span className="permissions-description">{permission.description}</span>}
                                <span className="permissions-tags">
                                  {!available && <em className="permissions-tag is-none">Not available for {activeLabel}</em>}
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
        )}
      </section>
    </DashboardLayout>
  );
}

export default AdminPermissions;
