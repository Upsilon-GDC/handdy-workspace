import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Building2, CalendarDays, ChevronLeft, ClipboardList, Clock3, LayoutDashboard, LogOut, Menu, Search, Settings2, Users, WalletCards, X } from "lucide-react";
import useAuth from "../../context/useAuth";
import { navigationForRole } from "./workspaceNavigation";
import { decideLoginRequest, getPendingLoginRequest } from "../../api/authApi";

const icons = { Workspace: LayoutDashboard, "Time & attendance": Clock3, Finance: WalletCards, System: Settings2 };

export default function AppShell({ children }) {
  const { user, isAuthenticated, isAuthLoading, logout, clearAuth, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [pendingLoginRequest, setPendingLoginRequest] = useState(null);
  const [deviceDecisionError, setDeviceDecisionError] = useState("");
  const [savingDeviceDecision, setSavingDeviceDecision] = useState(false);

  useEffect(() => { setMobileOpen(false); setSearch(""); }, [location.pathname]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (mobileOpen) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileOpen]);
  useEffect(() => {
    if (!isAuthenticated || isAuthLoading || pendingLoginRequest) return undefined;
    let active = true;
    const controller = new AbortController();
    const monitor = async () => {
      while (active) {
        try {
          const response = await getPendingLoginRequest(controller.signal);
          if (active && response?.loginRequest) {
            setPendingLoginRequest(response.loginRequest);
            return;
          }
          // Hidden tabs only need revocation detection, not a fast re-poll.
          await new Promise((resolve) => setTimeout(resolve, document.visibilityState === "hidden" ? 15000 : 1000));
        } catch (error) {
          if (!active || controller.signal.aborted) return;
          if ([401, 403].includes(error?.response?.status)) return;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    };
    void monitor();
    return () => { active = false; controller.abort(); };
  }, [isAuthenticated, isAuthLoading, pendingLoginRequest]);
  if (!isAuthenticated || isAuthLoading || /login|password/.test(location.pathname)) return children;

  // Navigation is role-driven (managers have a complete admin-equivalent set),
  // then narrowed to the items whose permissions the role holds.
  const hasDelegatedEmployeeAccess = ["create_employees", "edit_employees"].some(
    (key) => (user?.permissions || []).includes(key),
  );
  const navigation = [
    ...navigationForRole(user?.role, hasPermission),
    ...(user?.role === "team_lead" ? [{ path: "/employees", title: "Team members", group: "Workspace" }] : []),
    // Admin already has this from workspaceNavigation; anyone else only gets
    // it when specifically granted the delegated permission.
    ...(hasDelegatedEmployeeAccess && !["admin", "alpha", "manager"].includes(user?.role)
      ? [{ path: "/admin/employees", title: "Employees", group: "Workspace" }]
      : []),
  ];
  const current = navigation.find((item) => item.path === location.pathname);
  const name = user?.fullName || user?.name || "Your account";
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
  const groups = ["Workspace", "Time & attendance", "Finance", "System"].filter((group) => navigation.some((item) => item.group === group));
  const results = search.trim() ? navigation.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())) : [];
  const closeNavigation = () => { setMobileOpen(false); setSearch(""); };
  const signOut = async () => {
    setSigningOut(true);
    setSignOutError("");
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch {
      setSignOutError("Unable to sign out. Check your connection and try again.");
    } finally { setSigningOut(false); }
  };
  const decideDevice = async (decision) => {
    setSavingDeviceDecision(true);
    setDeviceDecisionError("");
    try {
      await decideLoginRequest(pendingLoginRequest.requestId, decision);
      if (decision === "allow") {
        sessionStorage.setItem("sessionEndedMessage", "You allowed this account to continue on the new device.");
        clearAuth();
        navigate("/login", { replace: true });
      } else {
        setPendingLoginRequest(null);
      }
    } catch (error) {
      setDeviceDecisionError(error?.response?.data?.message || "Unable to save your decision.");
    } finally {
      setSavingDeviceDecision(false);
    }
  };

  return (
    <div className={`crm-workspace${collapsed ? " is-compact" : ""}`}>
      {pendingLoginRequest && <div className="crm-device-modal" role="dialog" aria-modal="true" aria-labelledby="crm-device-title"><section><p className="crm-auth-kicker">SECURITY CHECK</p><h2 id="crm-device-title">Another device is trying to sign in</h2><p><strong>{pendingLoginRequest.deviceName}</strong> requested access to this account.</p><p>Keep this device to reject that login, or allow the new device and end this session. A running timer will continue.</p>{deviceDecisionError && <p className="crm-device-error" role="alert">{deviceDecisionError}</p>}<div><button disabled={savingDeviceDecision} onClick={() => decideDevice("deny")}>Keep This Device</button><button disabled={savingDeviceDecision} onClick={() => decideDevice("allow")}>Allow New Device</button></div></section></div>}
      <a className="crm-skip-link" href="#workspace-content">Skip to content</a>
      {mobileOpen && <button className="crm-nav-scrim" aria-label="Close navigation" onClick={closeNavigation} />}
      <aside className={`crm-nav${mobileOpen ? " is-open" : ""}`} aria-label="Workspace navigation">
        <Link className="crm-brand" to={navigation[0]?.path || "/login"} onClick={closeNavigation}><span className="crm-brand-mark"><Building2 size={20} /></span><strong>CRM<span>Employee workspace</span></strong></Link>
        <button className="crm-nav-close" onClick={closeNavigation} aria-label="Close navigation"><X size={18} /></button>
        <div className="crm-workspace-label"><span className="crm-workspace-initial">{initials}</span><span>{user?.companyName || "Your workspace"}<small>{user?.role?.replaceAll("_", " ")}</small></span></div>
        <nav>
          {groups.map((group) => {
            const Icon = icons[group] || ClipboardList;
            return <details key={group} open={group === "Workspace" || group === "Time & attendance" || current?.group === group}>
              <summary title={group === "Time & attendance" ? "Time & reports" : group}><Icon size={15} /><span>{group === "Time & attendance" ? "Time & reports" : group}</span></summary>
              {navigation.filter((item) => item.group === group).map((item) => <NavLink key={item.path} to={item.path} end title={item.title} onClick={closeNavigation}><span className="crm-nav-dash" /><span>{item.title}</span></NavLink>)}
            </details>;
          })}
        </nav>
        <div className="crm-nav-bottom">
          <NavLink to="/profile" onClick={closeNavigation}><Users size={17} /><span>My profile</span></NavLink>
          <button onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}><ChevronLeft size={17} /><span>Collapse navigation</span></button>
        </div>
      </aside>
      <div className="crm-stage">
        <header className="crm-topbar">
          <button className="crm-mobile-toggle" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <div className="crm-breadcrumb"><span>Workspace</span><span>/</span><strong>{current?.title || "Details"}</strong></div>
          <div className="crm-route-search"><Search size={16} /><input aria-label="Find a page" placeholder="Find a page…" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} />{search && <div className="crm-search-results">{results.length ? results.map((item) => <Link key={item.path} to={item.path} onClick={closeNavigation}>{item.title}<span>Open</span></Link>) : <p>No matching pages</p>}</div>}</div>
          <div className="crm-account"><span className="crm-avatar">{initials}</span><span><strong>{name}</strong><small>{user?.role?.replaceAll("_", " ")}</small></span></div>
          {signOutError && <span className="crm-signout-error" role="alert">{signOutError}</span>}
          <button className="crm-signout" aria-label="Log out" title="Log out" disabled={signingOut} onClick={signOut}><LogOut size={17} /></button>
        </header>
        <main id="workspace-content" className="crm-content">
          <div className="crm-context-line"><span><CalendarDays size={14} />{new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span><span>CRM / Workspace</span></div>
          {children}
        </main>
        <footer className="crm-footer"><span>CRM · Employee workspace</span><span>Time. People. Progress.</span></footer>
      </div>
    </div>
  );
}
