export function normalizeRole(role = "") {
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

// The API sends the signed-in account's id as `id` (buildUserResponse in the
// backend's authController.js); the dashboard reads `user._id`, so both are
// kept.
export function normalizeUser(user) {
  if (!user) {
    return null;
  }

  const id = user._id || user.id;
  return {
    ...user,
    ...(id ? { _id: id, id } : {}),
    role: normalizeRole(user.role),
  };
}

// Which session a permission list belongs to; empty while signed out.
export const permissionOwnerFor = (user, token) => (token && user?._id ? `${user._id}:${token}` : "");
