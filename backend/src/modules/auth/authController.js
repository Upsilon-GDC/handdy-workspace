const crypto = require("crypto");
const { createLoginWaiter } = require("../../services/loginNotifications");
const Employee = require("../../models/Employee");
const { getFrontendUrl } = require("../../config/productionConfig");
const generateToken = require("../../utils/generateToken");
const Team = require("../../models/Team");
const { syncEmployeeTeam } = require("../../services/teamAssignmentService");
const { sendPasswordResetEmail } = require("../../utils/mailer");
const { countEvent } = require("../../monitoring/trafficMetrics");
const { isOn } = require("../../config/optimizations");

// How often a waiting long-poll re-reads MongoDB without a change notification.
// Writes on this (single) server wake waiters at once, so with the optimization
// on the database is read only at the start and when something changed; the
// 20 s long-poll itself is the fallback for writes made elsewhere.
const LONG_POLL_MS = 20_000;
const longPollRecheckMs = () => (isOn("longPollEvents") ? LONG_POLL_MS : 5_000);
const { validateProjectRates, projectRatesRequiredForRole } = require("../../services/projectRateService");
const {
  generatePasswordResetToken,
  hashResetToken,
} = require("../../utils/passwordResetUtils");
const {
  createRememberedSession,
  hashRememberedSession,
  revokeRememberedSession,
} = require("../../utils/rememberedSessionUtils");
const AuthSession = require("../../models/AuthSession");
const DeviceLoginRequest = require("../../models/DeviceLoginRequest");
const { isAdminRole } = require("../../utils/roles");
const {
  normalizeDevice,
  beginLoginSession,
  findRequestForRequester,
  findPendingForSession,
  decideLoginRequest,
  revokeEmployeeSessions,
  hashSecret,
} = require("../../services/authSessionService");

const issueRememberedSession = (employee) => {
  const session = createRememberedSession();
  const now = new Date();
  employee.rememberedSessions = (employee.rememberedSessions || [])
    .filter((item) => item.expiresAt > now)
    .slice(-9);
  employee.rememberedSessions.push({ tokenHash: session.tokenHash, expiresAt: session.expiresAt });
  return session.token;
};

const buildSessionResponse = (session) => ({
  sessionId: session.sessionId,
  deviceId: session.deviceId,
  deviceName: session.deviceName,
  clientType: session.clientType,
  loginAt: session.loginAt,
  expiresAt: session.expiresAt,
});

const completeLogin = async (employee, session, { consumedRememberedHash } = {}) => {
  if (consumedRememberedHash) {
    employee.rememberedSessions = (employee.rememberedSessions || [])
      .filter((item) => item.tokenHash !== consumedRememberedHash);
    if (employee.rememberedSessionTokenHash === consumedRememberedHash) {
      employee.rememberedSessionTokenHash = null;
      employee.rememberedSessionExpires = null;
    }
  }
  employee.lastLoginAt = new Date();
  const rememberedSessionToken = issueRememberedSession(employee);
  await employee.save();
  return {
    success: true,
    message: "Login successful.",
    token: generateToken(employee._id, employee.tokenVersion, session),
    rememberedSessionToken,
    session: buildSessionResponse(session),
    user: buildUserResponse(employee),
  };
};

const pendingLoginResponse = (res, result) => res.status(409).json({
  success: false,
  code: "DEVICE_APPROVAL_REQUIRED",
  message: `Approval is required on ${result.activeSession.deviceName}.`,
  loginRequest: {
    requestId: result.request.requestId,
    requestToken: result.requestToken,
    expiresAt: result.request.expiresAt,
    activeDevice: {
      deviceName: result.activeSession.deviceName,
      lastActivity: result.activeSession.lastActivity,
    },
  },
});

// ======================================================
// BUILD SAFE USER RESPONSE
// ======================================================
const buildUserResponse = (employee) => {
  return {
    id: employee._id,

    employeeId: employee.employeeId,

    fullName: employee.fullName,

    firstName: employee.firstName || "",
    lastName: employee.lastName || "",

    email: employee.email,

    role: employee.role,
    permissions: employee.permissions || [],

    department: employee.department || "",
    designation: employee.designation || "",
    team: employee.team || null,

    companyName: employee.companyName || "",

    address1: employee.address1 || "",
    address2: employee.address2 || "",

    city: employee.city || "",
    state: employee.state || "",
    postalCode: employee.postalCode || "",

    country: employee.country || "",
    phoneNumber: employee.phoneNumber || "",

    projectRates: employee.projectRates || [],

    isActive: employee.isActive,

    lastLoginAt: employee.lastLoginAt,

    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
};

// ======================================================
// ERROR HANDLER
// ======================================================
const handleControllerError = (res, error) => {
  console.error("Auth Controller Error:", error);

  if (error.statusCode >= 400 && error.statusCode < 500) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }

  if (error.code === 11000) {
    const duplicateField =
      Object.keys(error.keyPattern || {})[0] || "field";

    return res.status(400).json({
      success: false,
      message: `${duplicateField} already exists.`,
    });
  }

  if (error.name === "ValidationError") {
    const message = Object.values(error.errors)
      .map((item) => item.message)
      .join(" ");

    return res.status(400).json({
      success: false,
      message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Unable to process the authentication request.",
  });
};

// ======================================================
// REGISTER EMPLOYEE
// ======================================================
const register = async (req, res) => {
  try {
    const {
      employeeId,
      fullName,
      email,
      password,
      role,
      department,
      designation,
      team,
      projectRates,
    } = req.body;

    if (
      !employeeId ||
      !fullName ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Employee ID, Full Name, Email and Password are required.",
      });
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    const normalizedEmployeeId =
      employeeId.trim().toUpperCase();

    const normalizedFullName =
      fullName.trim();

    // A delegated (non-admin) creator can only ever create plain employee
    // accounts — this is what closes off the "create_employees" permission
    // from being used to mint another admin, manager, hr, or team lead.
    const requestedRole = role || "employee";
    const API_CREATABLE_ROLES = new Set(["admin", "team_lead", "hr", "manager", "employee"]);
    if (requestedRole === "alpha") {
      return res.status(403).json({
        success: false,
        message: "Alpha accounts can only be created from the server terminal.",
      });
    }
    const normalizedRole = isAdminRole(req.user.role) && API_CREATABLE_ROLES.has(requestedRole)
      ? requestedRole
      : "employee";
    const normalizedProjectRates = await validateProjectRates(projectRates, {
      required: projectRatesRequiredForRole(normalizedRole),
    });
    if (["employee", "team_lead"].includes(normalizedRole)) {
      const validTeam = team && await Team.exists({ _id: team, isActive: true });
      if (!validTeam) {
        return res.status(400).json({ success: false, message: "An active team is required for employees and Team Leads." });
      }
    }

    const employeeExists =
      await Employee.findOne({
        email: normalizedEmail,
      });

    if (employeeExists) {
      return res.status(400).json({
        success: false,
        message:
          "An employee with this email already exists.",
      });
    }

    const employeeIdExists =
      await Employee.findOne({
        employeeId: normalizedEmployeeId,
      });

    if (employeeIdExists) {
      return res.status(400).json({
        success: false,
        message:
          "An employee with this Employee ID already exists.",
      });
    }

    const nameParts =
      normalizedFullName.split(/\s+/);

    const employee =
      await Employee.create({
        employeeId: normalizedEmployeeId,

        fullName: normalizedFullName,

        firstName:
          nameParts[0] || "",

        lastName:
          nameParts.slice(1).join(" "),

        email: normalizedEmail,

        password,

        role: normalizedRole,

        department:
          department?.trim() || "",

        designation:
          designation?.trim() || "",

        projectRates: normalizedProjectRates,
      });

    await syncEmployeeTeam(employee, team);

    return res.status(201).json({
      success: true,

      message:
        "Employee registered successfully.",

      user:
        buildUserResponse(employee),
    });
  } catch (error) {
    return handleControllerError(
      res,
      error
    );
  }
};

// ======================================================
// LOGIN EMPLOYEE
// ======================================================
const login = async (req, res) => {
  try {
    const {
      email,
      password,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,

        message:
          "Email and password are required.",
      });
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    const employee =
      await Employee.findOne({
        email: normalizedEmail,
      }).select("+password +tokenVersion +rememberedSessionTokenHash +rememberedSessionExpires +rememberedSessions");

    if (!employee) {
      return res.status(401).json({
        success: false,

        message:
          "Invalid email or password.",
      });
    }

    if (!employee.isActive) {
      return res.status(403).json({
        success: false,

        message:
          "Your account is inactive. Please contact the administrator.",
      });
    }

    const passwordMatches =
      await employee.comparePassword(
        password
      );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,

        message:
          "Invalid email or password.",
      });
    }

    const sessionResult = await beginLoginSession(employee._id, normalizeDevice(req.body, req), {
      tokenVersion: employee.tokenVersion ?? 0,
    });
    if (sessionResult.kind === "pending") return pendingLoginResponse(res, sessionResult);

    return res.status(200).json(await completeLogin(employee, sessionResult.session));
  } catch (error) {
    return handleControllerError(
      res,
      error
    );
  }
};

// Password-free return on a previously authenticated device. The opaque token
// is stored only as a SHA-256 hash in MongoDB and rotates after every use.
const quickLogin = async (req, res) => {
  try {
    const rememberedSessionToken = req.body?.rememberedSessionToken;
    if (!rememberedSessionToken || typeof rememberedSessionToken !== "string") {
      return res.status(401).json({ success: false, message: "Remembered session is required." });
    }
    const tokenHash = hashRememberedSession(rememberedSessionToken);
    const now = new Date();
    const employee = await Employee.findOne({
      $or: [
        { rememberedSessions: { $elemMatch: { tokenHash, expiresAt: { $gt: now } } } },
        { rememberedSessionTokenHash: tokenHash, rememberedSessionExpires: { $gt: now } },
      ],
    }).select("+tokenVersion +rememberedSessionTokenHash +rememberedSessionExpires +rememberedSessions");
    if (!employee || !employee.isActive) {
      return res.status(employee && !employee.isActive ? 403 : 401).json({ success: false, message: "Your remembered session is no longer valid." });
    }
    const sessionResult = await beginLoginSession(employee._id, normalizeDevice(req.body, req), {
      tokenVersion: employee.tokenVersion ?? 0,
      rememberedTokenHash: tokenHash,
    });
    if (sessionResult.kind === "pending") return pendingLoginResponse(res, sessionResult);

    return res.status(200).json(await completeLogin(employee, sessionResult.session, {
      consumedRememberedHash: tokenHash,
    }));
  } catch (error) {
    return handleControllerError(res, error);
  }
};

// A requesting device holds this authenticated-by-secret request open, avoiding
// rapid polling while the current device's user decides.
const waitForLoginRequest = async (req, res) => {
  const waiter = createLoginWaiter(req, res, ["requests", `request:${req.params.requestId}`]);
  try {
    const { requestId } = req.params;
    const requestToken = req.body?.requestToken;
    const deadline = Date.now() + LONG_POLL_MS;
    let request;

    do {
      if (waiter.closed) return;
      countEvent("longpoll.wait.check");
      request = await findRequestForRequester(requestId, requestToken);
      if (waiter.closed) return;
      if (!request) {
        return res.status(404).json({ success: false, code: "LOGIN_REQUEST_NOT_FOUND", message: "This login request is not valid." });
      }
      if (request.status !== "pending" && request.status !== "approving") break;
      await waiter.wait(Math.min(longPollRecheckMs(), deadline - Date.now(), Math.max(0, new Date(request.expiresAt).getTime() - Date.now())));
    } while (!waiter.closed && Date.now() < deadline);
    if (waiter.closed) return;

    if (request.status === "pending" || request.status === "approving") {
      return res.status(202).json({ success: false, code: "DEVICE_APPROVAL_PENDING", status: request.status, expiresAt: request.expiresAt });
    }
    if (request.status !== "approved") {
      const expired = request.status === "expired";
      return res.status(expired ? 410 : 403).json({
        success: false,
        code: expired ? "DEVICE_APPROVAL_EXPIRED" : "DEVICE_LOGIN_DENIED",
        status: request.status,
        message: expired ? "The login request expired. Please try again." : "The current device kept the active session.",
      });
    }

    const [employee, session] = await Promise.all([
      Employee.findById(request.employee).select("+tokenVersion +rememberedSessionTokenHash +rememberedSessionExpires +rememberedSessions"),
      AuthSession.findOne({ _id: request.requestedSession, status: "active", expiresAt: { $gt: new Date() } }),
    ]);
    if (!employee?.isActive || !session || (employee.tokenVersion ?? 0) !== (request.tokenVersion ?? 0)) {
      return res.status(403).json({ success: false, code: "DEVICE_LOGIN_UNAVAILABLE", message: "The approved session is no longer available." });
    }

    // Only one waiter may exchange this short-lived approval for credentials.
    // A password change also invalidates outstanding, unconsumed approvals.
    const consumed = await DeviceLoginRequest.findOneAndUpdate(
      {
        _id: request._id,
        status: "approved",
        requestTokenHash: hashSecret(requestToken),
        expiresAt: { $gt: new Date() },
      },
      { $set: { status: "consumed", requestTokenHash: crypto.randomBytes(32).toString("hex"), resolvedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!consumed) {
      return res.status(410).json({ success: false, code: "DEVICE_APPROVAL_EXPIRED", message: "This login approval has expired or was already used. Please log in again." });
    }
    return res.status(200).json(await completeLogin(employee, session, {
      consumedRememberedHash: request.rememberedTokenHash,
    }));
  } catch (error) {
    if (!waiter.closed) return handleControllerError(res, error);
  } finally {
    waiter.dispose();
  }
};

const getPendingLoginRequest = async (req, res) => {
  const waiter = createLoginWaiter(req, res, [`session:${req.authSession._id}`, `employee:${req.authSession.employee}`]);
  try {
    const deadline = Date.now() + LONG_POLL_MS;
    do {
      if (waiter.closed) return;
      countEvent(`longpoll.pending.check.${req.authSession.clientType || "unknown"}`);
      const activeSession = await AuthSession.findOne({ _id: req.authSession._id, status: "active" });
      if (waiter.closed) return;
      if (!activeSession) {
        return res.status(401).json({ success: false, code: "SESSION_REVOKED", message: "This device session is no longer active." });
      }
      // Browser sessions do not participate in desktop approval. Retain the
      // held request/session checks for older web clients and revocation.
      const request = activeSession.clientType === "web" ? null : await findPendingForSession(activeSession);
      if (waiter.closed) return;
      if (request) {
        return res.status(200).json({
          success: true,
          loginRequest: {
            requestId: request.requestId,
            deviceId: request.deviceId,
            deviceName: request.deviceName,
            clientType: request.clientType,
            requestedAt: request.createdAt,
            expiresAt: request.expiresAt,
          },
        });
      }
      await waiter.wait(Math.min(longPollRecheckMs(), deadline - Date.now()));
    } while (!waiter.closed && Date.now() < deadline);
    if (waiter.closed) return;

    return res.status(200).json({ success: true, loginRequest: null });
  } catch (error) {
    if (!waiter.closed) return handleControllerError(res, error);
  } finally {
    waiter.dispose();
  }
};

const decidePendingLoginRequest = async (req, res) => {
  try {
    const decision = req.body?.decision;
    if (!["allow", "deny"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Decision must be allow or deny." });
    }
    const request = await decideLoginRequest({
      requestId: req.params.requestId,
      currentSession: req.authSession,
      decision: decision === "allow" ? "allow" : "deny",
    });
    if (!request) {
      return res.status(404).json({ success: false, code: "LOGIN_REQUEST_NOT_FOUND", message: "This login request has expired or was already handled." });
    }
    return res.status(200).json({
      success: true,
      decision,
      sessionEnded: decision === "allow",
      message: decision === "allow" ? "The new device is now authorized." : "The new device login was denied.",
    });
  } catch (error) {
    return handleControllerError(res, error);
  }
};

const cancelLoginRequest = async (req, res) => {
  try {
    const request = await findRequestForRequester(req.params.requestId, req.body?.requestToken);
    if (!request) return res.status(404).json({ success: false, message: "Login request not found." });
    if (request.status === "pending") {
      request.status = "cancelled";
      request.resolvedAt = new Date();
      await request.save();
      await AuthSession.updateOne(
        { _id: request.requestedSession, status: "pending" },
        { $set: { status: "denied", revokedAt: new Date(), revokeReason: "request_cancelled" } },
      );
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    return handleControllerError(res, error);
  }
};

// ======================================================
// GET CURRENT USER PROFILE
// GET /api/auth/me
// ======================================================
const getProfile = async (req, res) => {
  try {
    const employee = req.user;

    if (!employee) {
      return res.status(404).json({
        success: false,

        message:
          "Employee not found.",
      });
    }

    return res.status(200).json({
      success: true,

      user:
        buildUserResponse(employee),
    });
  } catch (error) {
    return handleControllerError(
      res,
      error
    );
  }
};

// ======================================================
// UPDATE CURRENT USER PROFILE
// PUT /api/auth/profile
// ======================================================
const updateProfile = async (
  req,
  res
) => {
  try {
    const employee =
      await Employee.findById(
        req.user._id
      );

    if (!employee) {
      return res.status(404).json({
        success: false,

        message:
          "Employee not found.",
      });
    }

    const {
      companyName,
      firstName,
      lastName,
      fullName,
      email,
      address1,
      address2,
      city,
      state,
      postalCode,
      country,
      phoneNumber,
    } = req.body;

    // ==================================================
    // EMAIL
    // ==================================================

    if (email !== undefined) {
      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      if (!normalizedEmail) {
        return res.status(400).json({
          success: false,

          message:
            "Email cannot be empty.",
        });
      }

      if (
        normalizedEmail !==
        employee.email
      ) {
        const existingEmployee =
          await Employee.findOne({
            email: normalizedEmail,

            _id: {
              $ne: employee._id,
            },
          });

        if (existingEmployee) {
          return res.status(400).json({
            success: false,

            message:
              "An employee with this email already exists.",
          });
        }

        employee.email =
          normalizedEmail;
      }
    }

    // ==================================================
    // PROFILE FIELDS
    // ==================================================

    if (companyName !== undefined) {
      employee.companyName =
        String(companyName).trim();
    }

    if (firstName !== undefined) {
      employee.firstName =
        String(firstName).trim();
    }

    if (lastName !== undefined) {
      employee.lastName =
        String(lastName).trim();
    }

    if (address1 !== undefined) {
      employee.address1 =
        String(address1).trim();
    }

    if (address2 !== undefined) {
      employee.address2 =
        String(address2).trim();
    }

    if (city !== undefined) {
      employee.city =
        String(city).trim();
    }

    if (state !== undefined) {
      employee.state =
        String(state).trim();
    }

    if (postalCode !== undefined) {
      employee.postalCode =
        String(postalCode).trim();
    }

    if (country !== undefined) {
      employee.country =
        String(country).trim();
    }

    if (phoneNumber !== undefined) {
      employee.phoneNumber =
        String(phoneNumber).trim();
    }

    // ==================================================
    // FULL NAME
    // ==================================================

    if (
      fullName !== undefined &&
      String(fullName).trim()
    ) {
      employee.fullName =
        String(fullName).trim();
    } else {
      const generatedFullName = [
        employee.firstName,
        employee.lastName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (generatedFullName) {
        employee.fullName =
          generatedFullName;
      }
    }

    await employee.save();

    return res.status(200).json({
      success: true,

      message:
        "Profile updated successfully.",

      user:
        buildUserResponse(employee),
    });
  } catch (error) {
    return handleControllerError(
      res,
      error
    );
  }
};

// ======================================================
// FORGOT PASSWORD - request a reset link by email
// ======================================================
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Always respond the same way whether or not the email exists, so this
    // endpoint can't be used to discover which emails have accounts.
    const genericResponse = () =>
      res.status(200).json({
        success: true,
        message:
          "If an account exists for that email, a password reset link has been sent.",
      });

    if (!email || typeof email !== "string") {
      return genericResponse();
    }

    const normalizedEmail = email.trim().toLowerCase();

    const employee = await Employee.findOne({
      email: normalizedEmail,
      isActive: true,
    }).select("_id email");

    if (!employee) {
      return genericResponse();
    }

    const { rawToken, tokenHash, expiresAt } = generatePasswordResetToken();

    // findByIdAndUpdate (not .save()) avoids re-validating the full document
    // against a partially-selected employee record.
    await Employee.findByIdAndUpdate(employee._id, {
      $set: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: expiresAt,
      },
    });

    const frontendUrl = getFrontendUrl();
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    try {
      await sendPasswordResetEmail({ to: employee.email, resetUrl });
    } catch (mailError) {
      // Log what failed, never the message or link, which carry the token.
      console.error("Unable to send password reset email:", JSON.stringify({
        code: mailError.code,
        responseCode: mailError.responseCode,
        command: mailError.command,
        message: String(mailError.message || "").replaceAll(rawToken, "[redacted]"),
      }));
    }

    return genericResponse();
  } catch (error) {
    return handleControllerError(res, error);
  }
};

// ======================================================
// RESET PASSWORD - consume a reset token
// ======================================================
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        success: false,
        message: "A valid reset token is required.",
      });
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters.",
      });
    }

    const employee = await Employee.findOne({
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpires: { $gt: new Date() },
    }).select("+tokenVersion +passwordResetTokenHash +passwordResetExpires +rememberedSessionTokenHash +rememberedSessionExpires");

    if (!employee) {
      return res.status(400).json({
        success: false,
        message: "This password reset link is invalid or has expired.",
      });
    }

    employee.password = password;
    employee.passwordResetTokenHash = null;
    employee.passwordResetExpires = null;
    employee.tokenVersion = (employee.tokenVersion || 0) + 1;
    employee.rememberedSessionTokenHash = null;
    employee.rememberedSessionExpires = null;
    employee.rememberedSessions = [];

    await employee.save();
    await revokeEmployeeSessions(employee._id, "password_reset");

    return res.status(200).json({
      success: true,
      message: "Your password has been reset. You can now log in.",
    });
  } catch (error) {
    return handleControllerError(res, error);
  }
};

// ======================================================
// CHANGE PASSWORD - logged-in user changes their own password
// ======================================================
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required.",
      });
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must contain at least 8 characters.",
      });
    }

    const employee = await Employee.findById(req.user._id).select(
      "+password +tokenVersion +rememberedSessionTokenHash +rememberedSessionExpires"
    );

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    const passwordMatches = await employee.comparePassword(currentPassword);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    employee.password = newPassword;
    employee.tokenVersion = (employee.tokenVersion || 0) + 1;
    employee.rememberedSessionTokenHash = null;
    employee.rememberedSessionExpires = null;
    employee.rememberedSessions = [];

    await employee.save();

    // Bumping tokenVersion invalidates other sessions; issue this session a
    // fresh token in the same response so the caller isn't logged out too.
    await AuthSession.updateMany(
      { employee: employee._id, _id: { $ne: req.authSession._id }, status: { $in: ["active", "pending"] } },
      { $set: { status: "revoked", revokedAt: new Date(), revokeReason: "password_changed" } },
    );
    await DeviceLoginRequest.updateMany(
      { employee: employee._id, status: { $in: ["pending", "approving", "approved"] } },
      { $set: { status: "cancelled", resolvedAt: new Date() } },
    );
    const token = generateToken(employee._id, employee.tokenVersion, req.authSession);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully.",
      token,
    });
  } catch (error) {
    return handleControllerError(res, error);
  }
};

// ======================================================
// LOGOUT EMPLOYEE
// ======================================================
const logout = async (req, res) => {
  // End the device session first, so a failure while revoking the remembered
  // credential can never leave this session active.
  await AuthSession.updateOne(
    { _id: req.authSession._id, status: "active" },
    { $set: { status: "logged_out", revokedAt: new Date(), revokeReason: "user_logout" } },
  );
  await DeviceLoginRequest.updateMany(
    { existingSession: req.authSession._id, status: { $in: ["pending", "approving"] } },
    { $set: { status: "cancelled", resolvedAt: new Date() } },
  );

  const rememberedSessionToken = req.body?.rememberedSessionToken;
  if (typeof rememberedSessionToken === "string" && rememberedSessionToken) {
    await revokeRememberedSession(Employee, req.user._id, rememberedSessionToken);
  }

  return res.status(200).json({
    success: true,

    message:
      "Logout successful.",
  });
};

// ======================================================
// EXPORTS
// ======================================================
module.exports = {
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
};
