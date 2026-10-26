// Personal exceptions to a role's permissions (Permissions page, "By
// employee"); mirrors getEffectivePermissionsSync in the backend's
// services/permissionService.js. A person has a permission when they have a
// personal "on", or when their role grants it and they have no personal "off".
// Only permissions that can apply to the person's role count.

export const NO_OVERRIDES = Object.freeze({ granted: [], revoked: [] });

export const overrideState = (overrides, key) => {
  if ((overrides?.granted || []).includes(key)) return "on";
  if ((overrides?.revoked || []).includes(key)) return "off";
  return null;
};

export const effectivePersonPermissions = (roleGrants, overrides, applicableKeys) => applicableKeys
  .filter((key) => {
    const state = overrideState(overrides, key);
    return state ? state === "on" : roleGrants.includes(key);
  });

// Sets one switch. A value equal to the role's leaves no exception behind, so
// switching back and forth never creates a "personal" setting that changes
// nothing.
export const setPersonPermission = (overrides, key, on, roleGrants) => {
  const granted = (overrides?.granted || []).filter((item) => item !== key);
  const revoked = (overrides?.revoked || []).filter((item) => item !== key);
  if (on !== roleGrants.includes(key)) (on ? granted : revoked).push(key);
  return { granted, revoked };
};

export const clearPersonPermission = (overrides, key) => ({
  granted: (overrides?.granted || []).filter((item) => item !== key),
  revoked: (overrides?.revoked || []).filter((item) => item !== key),
});

export const overrideCount = (overrides) =>
  (overrides?.granted || []).length + (overrides?.revoked || []).length;

// Number of switches whose personal setting differs between two versions.
export const countOverrideChanges = (before, after) => {
  const keys = new Set([...(before?.granted || []), ...(before?.revoked || []),
    ...(after?.granted || []), ...(after?.revoked || [])]);
  return [...keys].filter((key) => overrideState(before, key) !== overrideState(after, key)).length;
};
