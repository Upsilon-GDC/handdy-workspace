import axiosInstance from "./axiosInstance";
import { PERMISSION_VERSION_HEADER } from "./permissionVersion";

export const getPermissionConfig = async () => (await axiosInstance.get("/permissions")).data;

export const saveRolePermissions = async (role, permissions) =>
  (await axiosInstance.put(`/permissions/roles/${role}`, { permissions })).data;

// Active employees in configurable roles with their personal exceptions
// (`granted` / `revoked`) to the role's permissions.
export const getEmployeePermissions = async () =>
  (await axiosInstance.get("/permissions/employees")).data.employees || [];

export const saveEmployeePermissions = async (employeeId, { granted, revoked }) =>
  (await axiosInstance.put(`/permissions/employees/${employeeId}`, { granted, revoked })).data;

// Effective permission keys for the signed-in user, with their fingerprint
// (see permissionVersion.js). Used only to show or hide controls; the API
// enforces every action regardless.
export const getMyPermissions = async () => {
  const response = await axiosInstance.get("/permissions/me");
  return {
    keys: response.data.permissions || [],
    version: response.headers?.[PERMISSION_VERSION_HEADER] || "",
  };
};
