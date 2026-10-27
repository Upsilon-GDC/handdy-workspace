import axios from "axios";
import { API_BASE_URL } from "./apiConfig";
import { notePermissionVersion } from "./permissionVersion";

export { API_BASE_URL } from "./apiConfig";

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

axiosInstance.interceptors.response.use(
  (response) => {
    notePermissionVersion(response.headers);
    return response;
  },
  (error) => {
    notePermissionVersion(error.response?.headers);
    if (error.response?.status === 401 || error.response?.data?.code === "ACCOUNT_INACTIVE") {
      if (error.response?.data?.code === "SESSION_REVOKED") {
        sessionStorage.setItem("sessionEndedMessage", error.response.data.message || "This account is now active on another device.");
      } else if (error.response?.data?.code === "ACCOUNT_INACTIVE") {
        sessionStorage.setItem("sessionEndedMessage", "Your account is inactive. Please contact the administrator.");
      }
      localStorage.removeItem("user");
      localStorage.removeItem("token");

      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
