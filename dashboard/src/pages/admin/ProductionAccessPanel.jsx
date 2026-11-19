import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { getProductionAccessAccounts, saveProductionAccess } from "../../api/permissionApi";
import getApiErrorMessage from "../../utils/getApiErrorMessage";

export default function ProductionAccessPanel() {
  const [accounts, setAccounts] = useState(null);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    getProductionAccessAccounts()
      .then((rows) => { if (active) setAccounts(rows); })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, "Unable to load Production access."));
      });
    return () => { active = false; };
  }, []);

  const changeAccess = async (account, enabled) => {
    setSavingId(account.id);
    setError("");
    setMessage("");
    try {
      const saved = await saveProductionAccess(account.id, enabled);
      setAccounts((rows) => rows.map((row) => row.id === saved.id ? saved : row));
      setMessage(`Production access ${saved.enabled ? "enabled" : "disabled"} for ${saved.fullName}.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to save Production access."));
    } finally {
      setSavingId(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const shown = accounts?.filter((account) =>
    [account.fullName, account.employeeId, account.email, account.role].join(" ").toLowerCase().includes(needle));

  return (
    <section className="permissions-people card" aria-label="Production access by account">
      <label className="permissions-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label="Search Admin and Manager accounts"
          placeholder="Search Admins and Managers" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {error && <p className="permissions-message is-error" role="alert">{error}</p>}
      {message && <p className="permissions-message" role="status">{message}</p>}
      {!accounts && !error && <p role="status">Loading accounts…</p>}
      {shown?.length === 0 && <p role="status">{needle ? "No matching accounts." : "No active Admin or Manager accounts."}</p>}
      {!!shown?.length && (
        <ul className="permissions-grid" aria-label="Admin and Manager accounts">
          {shown.map((account) => (
            <li key={account.id}>
              <label className={`permissions-item${account.enabled ? " is-on" : ""}`}>
                <input type="checkbox" role="switch" className="permissions-switch"
                  aria-label={`Production access for ${account.fullName || account.email}`}
                  checked={account.enabled} disabled={savingId !== null}
                  onChange={(event) => { void changeAccess(account, event.target.checked); }} />
                <span className="permissions-item-text">
                  <strong>{account.fullName || account.email}</strong>
                  <span className="permissions-description">
                    {[account.role === "admin" ? "Admin" : "Manager", account.employeeId, account.email].filter(Boolean).join(" · ")}
                  </span>
                  <span className="permissions-description">
                    {savingId === account.id ? "Saving…" : account.enabled ? "Enabled" : "Disabled"}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
