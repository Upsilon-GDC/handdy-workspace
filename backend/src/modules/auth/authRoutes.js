const express = require("express");

const {
  register,
  login,
  quickLogin,
  waitForLoginRequest,
  getPendingLoginRequest,
  decidePendingLoginRequest,
  cancelLoginRequest,
  getProfile,
  updateProfile,
  forgotPassword,
  resetPassword,
  changePassword,
  logout,
} = require("./authController");

const { protect } = require("../../middleware/authMiddleware");
const { authorizeAccess } = require("../../middleware/authorizeRoles");
const { createRateLimit } = require("../../middleware/rateLimit");

const router = express.Router();

const loginLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again later.",
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || "").trim().toLowerCase() || "unknown"}`,
});

const registrationLimiter = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: "Too many registration attempts. Please try again later.",
});

const passwordResetLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests. Please try again later.",
});

// Admins, or anyone an admin has granted the "create_employees" permission.
router.post(
  "/register",
  protect,
  authorizeAccess("create_employees"),
  registrationLimiter,
  register
);
router.post("/login", loginLimiter, login);
router.post("/quick-login", loginLimiter, quickLogin);
router.post("/login-requests/:requestId/wait", waitForLoginRequest);
router.post("/login-requests/:requestId/cancel", cancelLoginRequest);

router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password", passwordResetLimiter, resetPassword);

// Protected current-user routes
router.post("/logout", protect, logout);
router.get("/login-requests/pending", protect, getPendingLoginRequest);
router.post("/login-requests/:requestId/decision", protect, decidePendingLoginRequest);
router.put("/change-password", protect, changePassword);

router.get("/me", protect, getProfile);

// Update current user's profile
router.put("/profile", protect, updateProfile);

// Keep old GET route temporarily for compatibility
router.get("/profile", protect, getProfile);

module.exports = router;
