// The API sends a fingerprint of the signed-in person's permissions with
// every response (backend middleware/authMiddleware.js). When an
// administrator or manager changes them, the next response carries a new
// fingerprint and AuthProvider reloads the permissions, so open pages show
// the new menus and buttons without a reload.
export const PERMISSION_VERSION_HEADER = "x-permissions-version";

const listeners = new Set();

export const notePermissionVersion = (headers) => {
  const version = headers?.[PERMISSION_VERSION_HEADER];
  if (version) for (const listener of listeners) listener(version);
};

export const onPermissionVersion = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Calls `reload` once per change. Fingerprints are ignored until the first
// load reports one, and a change is remembered before reloading, so the
// reload's own response (or a failed reload) never triggers another.
export const createPermissionVersionTracker = (reload) => {
  let current = "";
  return {
    loaded(version) { if (version) current = version; },
    seen(version) {
      if (!current || !version || version === current) return;
      current = version;
      reload();
    },
  };
};
