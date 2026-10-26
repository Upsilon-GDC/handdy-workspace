import {
  Navigate,
  useLocation,
} from "react-router-dom";

import useAuth from "../context/useAuth";
import AccessDenied from "../components/layout/AccessDenied";

function ProtectedRoute({
  children,
  allowedRoles = [],
  requiredPermissions = [],
  // Role permissions the page's data needs (all of them). Without them the
  // page explains what is missing instead of failing with API errors.
  needs = [],
}) {
  const location = useLocation();

  const {
    user,
    isAuthenticated,
    isAuthLoading,
    hasPermission,
    permissionsReady,
    permissionsFailed,
  } = useAuth();

  // Wait for existing token/session validation.
  if (isAuthLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Checking authentication...
      </div>
    );
  }

  // No valid session -> MAIN login only.
  if (
    !isAuthenticated ||
    !user
  ) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname,
        }}
      />
    );
  }

  // A route can also be reached via an admin-granted delegated permission
  // (e.g. a specific HR/employee account given "create_employees"),
  // regardless of that account's role.
  const hasRequiredPermission =
    requiredPermissions.length > 0 &&
    requiredPermissions.some((key) => (user.permissions || []).includes(key));
  const hasRoleAccess = allowedRoles.includes(user.role)
    || (["alpha", "manager"].includes(user.role) && allowedRoles.includes("admin"));

  // Logged in but wrong role, and no delegated permission covers this route.
  if (
    allowedRoles.length > 0 &&
    !hasRoleAccess &&
    !hasRequiredPermission
  ) {
    if (["admin", "alpha", "manager"].includes(user.role)) {
      return (
        <Navigate
          to="/admin/dashboard"
          replace
        />
      );
    }

    if (
      user.role === "team_lead"
    ) {
      return (
        <Navigate
          to="/team-lead/dashboard"
          replace
        />
      );
    }

    if (user.role === "employee") {
      return (
        <Navigate
          to="/employee/dashboard"
          replace
        />
      );
    }

    if (user.role === "hr") {
      return (
        <Navigate
          to="/admin/dashboard"
          replace
        />
      );
    }

    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  if (needs.length > 0 && !hasPermission(...needs)) {
    if (!permissionsReady) {
      return <p className="crm-permission-note" role="status">Checking access...</p>;
    }
    return <AccessDenied permissions={needs} failed={permissionsFailed} />;
  }

  return children;
}

export default ProtectedRoute;
