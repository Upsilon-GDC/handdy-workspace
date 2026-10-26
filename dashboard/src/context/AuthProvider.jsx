import {
  useCallback,
  useEffect,
  useState,
} from "react";

import AuthContext from "./authContextInstance";

import {
  loginUser,
  quickLoginUser,
  getCurrentUser,
  logoutUser,
  waitForLoginApproval,
} from "../api/authApi";
import { getMyPermissions } from "../api/permissionApi";
import { isAdminRole } from "../utils/permissions";

const NO_PERMISSIONS = [];

function normalizeRole(role = "") {
  const normalized = String(role)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (
    normalized === "tl" ||
    normalized === "teamlead" ||
    normalized === "team_lead"
  ) {
    return "team_lead";
  }

  if (normalized === "administrator") {
    return "admin";
  }

  return normalized;
}

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    ...user,
    role: normalizeRole(user.role),
  };
}

function AuthProvider({ children }) {
  const [token, setToken] = useState(() =>
    localStorage.getItem("token")
  );

  const [user, setUser] = useState(() => {
    try {
      const savedUser =
        localStorage.getItem("user");

      if (!savedUser) {
        return null;
      }

      return normalizeUser(
        JSON.parse(savedUser)
      );
    } catch {
      return null;
    }
  });

  const [isAuthLoading, setIsAuthLoading] =
    useState(true);
  const [loginApprovalMessage, setLoginApprovalMessage] = useState("");

  const [rememberedUser, setRememberedUser] = useState(() => {
    try { return normalizeUser(JSON.parse(localStorage.getItem("rememberedUser"))); } catch { return null; }
  });

  // ==========================================
  // CLEAR AUTH
  // ==========================================

  // Keeps the remembered login: an expired or revoked session is exactly when
  // "Continue as" should be offered. Only an explicit sign-out removes it.
  const clearAuth = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    setToken(null);
    setUser(null);
  }, []);

  const clearRememberedLogin = useCallback(() => {
    localStorage.removeItem("rememberedSessionToken");
    localStorage.removeItem("rememberedUser");
    setRememberedUser(null);
  }, []);

  // ==========================================
  // RESTORE SESSION
  // ==========================================

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const savedToken =
        localStorage.getItem("token");

      if (!savedToken) {
        if (active) {
          setIsAuthLoading(false);
        }

        return;
      }

      try {
        const response =
          await getCurrentUser();

        const currentUser =
          normalizeUser(
            response?.user || response
          );

        if (!currentUser) {
          throw new Error(
            "User information was not returned."
          );
        }

        if (!active) {
          return;
        }

        setToken(savedToken);
        setUser(currentUser);

        localStorage.setItem(
          "user",
          JSON.stringify(currentUser)
        );
      } catch (error) {
        console.error(
          "Session validation failed:",
          error
        );

        if (active) {
          clearAuth();
        }
      } finally {
        if (active) {
          setIsAuthLoading(false);
        }
      }
    };

    restoreSession();

    return () => {
      active = false;
    };
  }, [clearAuth]);

  // ==========================================
  // EFFECTIVE PERMISSIONS
  // ==========================================

  // Role grants plus delegations, as the API computes them. They decide which
  // menus, pages and buttons the dashboard offers; the API still enforces
  // every action on its own. Results are tied to the session that requested
  // them, so a different sign-in never sees another account's grants.
  const permissionOwner = token && user?._id ? `${user._id}:${token}` : "";
  const [permissionResult, setPermissionResult] = useState({ owner: "", keys: [], failed: false });

  useEffect(() => {
    if (!permissionOwner) return undefined;
    let active = true;
    const load = () => getMyPermissions()
      .then((keys) => { if (active) setPermissionResult({ owner: permissionOwner, keys, failed: false }); })
      .catch(() => {
        if (!active) return;
        // Keep grants that already loaded; otherwise offer nothing extra
        // until a later attempt succeeds.
        setPermissionResult((current) => (current.owner === permissionOwner && !current.failed
          ? current
          : { owner: permissionOwner, keys: [], failed: true }));
      });
    void load();
    // An administrator may change a role while this tab is open; pick the
    // change up when the person returns to the tab.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [permissionOwner]);

  const hasFullAccess = isAdminRole(user?.role);
  const permissionsLoaded = permissionResult.owner === permissionOwner;
  const permissions = permissionsLoaded ? permissionResult.keys : NO_PERMISSIONS;
  // True when the user holds every named permission. Admin-level roles always
  // do, matching the API.
  const hasPermission = useCallback(
    (...keys) => hasFullAccess || keys.every((key) => permissions.includes(key)),
    [hasFullAccess, permissions],
  );

  // ==========================================
  // LOGIN
  // ==========================================

  const resolveLoginAttempt = async (attempt) => {
    setLoginApprovalMessage("");
    try {
      return await attempt();
    } catch (error) {
      const pending = error?.response?.status === 409
        && error?.response?.data?.code === "DEVICE_APPROVAL_REQUIRED"
        && error?.response?.data?.loginRequest;
      if (!pending) throw error;
      setLoginApprovalMessage(`Waiting for approval on ${pending.activeDevice?.deviceName || "the active device"}...`);
      while (true) {
        const response = await waitForLoginApproval(pending);
        if (response?.code === "DEVICE_APPROVAL_PENDING") continue;
        setLoginApprovalMessage("");
        return response;
      }
    }
  };

  const login = async (
    email,
    password
  ) => {
    const response = await resolveLoginAttempt(() => loginUser({
      email,
      password,
    }));

    const newToken =
      response?.token;

    const loggedInUser =
      normalizeUser(response?.user);

    if (
      !newToken ||
      !loggedInUser
    ) {
      throw new Error(
        "Invalid login response from server."
      );
    }

    localStorage.setItem(
      "token",
      newToken
    );

    localStorage.setItem(
      "user",
      JSON.stringify(loggedInUser)
    );

    if (response.rememberedSessionToken) {
      localStorage.setItem("rememberedSessionToken", response.rememberedSessionToken);
      localStorage.setItem("rememberedUser", JSON.stringify(loggedInUser));
      setRememberedUser(loggedInUser);
    }

    setToken(newToken);
    setUser(loggedInUser);

    return loggedInUser;
  };

  const quickLogin = async () => {
    const rememberedSessionToken = localStorage.getItem("rememberedSessionToken");
    if (!rememberedSessionToken) throw new Error("No remembered session is available.");
    try {
      const response = await resolveLoginAttempt(() => quickLoginUser(rememberedSessionToken));
      const loggedInUser = normalizeUser(response?.user);
      if (!response?.token || !response?.rememberedSessionToken || !loggedInUser) throw new Error("Invalid quick login response from server.");
      localStorage.setItem("token", response.token);
      localStorage.setItem("user", JSON.stringify(loggedInUser));
      localStorage.setItem("rememberedSessionToken", response.rememberedSessionToken);
      localStorage.setItem("rememberedUser", JSON.stringify(loggedInUser));
      setToken(response.token);
      setUser(loggedInUser);
      setRememberedUser(loggedInUser);
      return loggedInUser;
    } catch (error) {
      if ([401, 410].includes(error?.response?.status)) {
        localStorage.removeItem("rememberedSessionToken");
        localStorage.removeItem("rememberedUser");
        setRememberedUser(null);
      }
      throw error;
    }
  };

  // ==========================================
  // LOGOUT
  // ==========================================

  const logout = async () => {
    try {
      if (
        localStorage.getItem("token")
      ) {
        await logoutUser(localStorage.getItem("rememberedSessionToken"));
      }
    } catch (error) {
      if ([401, 403].includes(error?.response?.status)) {
        clearAuth();
        clearRememberedLogin();
        return;
      }
      console.error("Unable to end the web session:", error);
      throw error;
    }
    clearAuth();
    clearRememberedLogin();
  };

  const value = {
    user,
    token,

    isAuthenticated: Boolean(
      token && user
    ),

    isAuthLoading,

    permissions,
    permissionsReady: hasFullAccess || permissionsLoaded,
    permissionsFailed: !hasFullAccess && permissionsLoaded && permissionResult.failed,
    hasPermission,

    login,
    quickLogin,
    rememberedUser,
    loginApprovalMessage,
    logout,
    clearAuth,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthProvider };
