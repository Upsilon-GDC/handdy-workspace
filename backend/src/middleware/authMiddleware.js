const jwt = require("jsonwebtoken");
const Employee = require("../models/Employee");
const AuthSession = require("../models/AuthSession");
const { getAuthEntry, setAuthEntry } = require("../services/authCache");
const { PERMISSION_VERSION_HEADER, getPermissionVersion } = require("../services/permissionService");

const protect = async (req, res, next) => {
  try {
    const authorizationHeader = req.headers.authorization;

    if (
      !authorizationHeader ||
      !authorizationHeader.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required.",
      });
    }

    const token = authorizationHeader.split(" ")[1];

    // Only the method tokens are issued with (utils/generateToken.js).
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });

    // Served from a short-lived cache (cleared on any Employee/AuthSession
    // write) so routine polling does not hit Atlas twice per request.
    const cached = decoded.sessionId && decoded.deviceId
      ? getAuthEntry(decoded.employeeId, decoded.sessionId, decoded.deviceId)
      : null;

    const employee = cached?.employee ?? await Employee.findById(decoded.employeeId).select(
      "+tokenVersion +idleTrackingExempt +idlePolicyOverride.idleThresholdMinutes +idlePolicyOverride.autoLogoutMinutes"
      + " +permissionOverrides.granted +permissionOverrides.revoked"
    );

    if (!employee) {
      return res.status(401).json({
        success: false,
        message: "The user associated with this token no longer exists.",
      });
    }

    if (!employee.isActive) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_INACTIVE",
        message: "Your account is inactive.",
      });
    }

    if ((decoded.tokenVersion ?? 0) !== (employee.tokenVersion ?? 0)) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_REVOKED",
        message: "Authentication token has been revoked.",
      });
    }

    if (!decoded.sessionId || !decoded.deviceId) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REQUIRED",
        message: "Please log in again to create a secure device session.",
      });
    }

    const authSession = cached?.authSession ?? await AuthSession.findOne({
      employee: employee._id,
      sessionId: decoded.sessionId,
      deviceId: decoded.deviceId,
      status: "active",
      expiresAt: { $gt: new Date() },
    });

    if (!authSession || (cached && authSession.expiresAt <= new Date())) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "This device session is no longer active.",
      });
    }

    const entry = cached ?? setAuthEntry(decoded.employeeId, decoded.sessionId, decoded.deviceId, {
      employee,
      authSession,
      touchedAt: authSession.lastActivity ? authSession.lastActivity.getTime() : 0,
    });

    req.user = employee;
    req.authSession = authSession;
    // Lets an open dashboard pick up permission changes (AuthProvider).
    res.setHeader(PERMISSION_VERSION_HEADER, getPermissionVersion(employee));

    if (Date.now() - entry.touchedAt > 60_000) {
      entry.touchedAt = Date.now();
      // Native update: a Mongoose update would clear the auth cache every minute.
      const activity = { _id: authSession._id, status: "active" };
      const touch = { $set: { lastActivity: new Date() } };
      Promise.resolve(AuthSession.collection.updateOne(activity, touch))
        .catch((updateError) => console.error("Unable to update session activity:", updateError));
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Authentication token has expired.",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Authentication token is invalid.",
      });
    }

    console.error("Authentication middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify your session. Please try again.",
    });
  }
};

module.exports = {
  protect,
};
