const SystemSettings = require("../../models/SystemSettings");
const Employee = require("../../models/Employee");
const sendErrorResponse = require("../../utils/sendErrorResponse");

const { normalizeIdlePolicy, resolveIdlePolicy, validateIdlePolicy } = require("../../utils/idlePolicy");

// Missing/legacy documents already resolve to safe defaults. A GET does not
// initialize or touch updatedAt; only an administrator's save writes settings.
let settingsCache;
let settingsExpiresAt = 0;
let settingsGeneration = 0;
let settingsRead;
const getSettings = () => {
  if (settingsExpiresAt > Date.now()) return Promise.resolve(settingsCache);
  if (settingsRead?.generation === settingsGeneration) return settingsRead.promise;
  const generation = settingsGeneration;
  const promise = Promise.resolve(SystemSettings.findOne({ key: "global" })).then((settings) => {
    if (settingsGeneration === generation) {
      settingsCache = settings;
      settingsExpiresAt = Date.now() + 5_000;
    }
    return settings;
  }).finally(() => { if (settingsRead?.promise === promise) settingsRead = null; });
  settingsRead = { generation, promise };
  return promise;
};

const getIdlePolicy = async (req, res) => {
  try {
    const settings = await getSettings();

    return res.status(200).json({
      success: true,
      idlePolicy: {
        ...resolveIdlePolicy(settings, req.user),
        idleTrackingExempt: Boolean(req.user.idleTrackingExempt),
      },
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to load idle settings.");
  }
};

const getEmployeeIdlePolicies = async (req, res) => {
  try {
    const employees = await Employee.find({ role: { $ne: "alpha" } })
      .select("employeeId fullName email role isActive +idlePolicyOverride.idleThresholdMinutes +idlePolicyOverride.autoLogoutMinutes +idlePolicyOverride.updatedAt")
      .sort("fullName")
      .lean();
    return res.status(200).json({ success: true, employees });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load employee inactivity policies." });
  }
};

const updateEmployeeIdlePolicy = async (req, res) => {
  try {
    const employee = await Employee.findOne({ _id: req.params.employeeId, role: { $ne: "alpha" } })
      .select("employeeId fullName email role isActive +idlePolicyOverride.idleThresholdMinutes +idlePolicyOverride.autoLogoutMinutes +idlePolicyOverride.updatedBy +idlePolicyOverride.updatedAt");
    if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });

    if (req.body.useGlobalPolicy === true) {
      employee.idlePolicyOverride = {
        idleThresholdMinutes: null,
        autoLogoutMinutes: null,
        updatedBy: req.user._id,
        updatedAt: new Date(),
      };
    } else {
      const policy = {
        idleThresholdMinutes: Number(req.body.idleThresholdMinutes),
        autoLogoutMinutes: Number(req.body.autoLogoutMinutes),
      };
      const validationError = validateIdlePolicy(policy);
      if (validationError) return res.status(400).json({ success: false, message: validationError });
      employee.idlePolicyOverride = { ...policy, updatedBy: req.user._id, updatedAt: new Date() };
    }
    await employee.save();
    return res.status(200).json({
      success: true,
      message: req.body.useGlobalPolicy === true
        ? "Employee now uses the company inactivity policy."
        : "Employee inactivity override saved.",
      employee,
    });
  } catch (error) {
    return res.status(error.name === "CastError" ? 400 : 500).json({
      success: false,
      message: error.name === "CastError" ? "Invalid employee ID." : "Unable to save employee inactivity policy.",
    });
  }
};

const updateIdlePolicy = async (req, res) => {
  try {
    const idleThresholdMinutes = Number(req.body.idleThresholdMinutes);
    const existing = await getSettings();
    const policy = {
      idleThresholdMinutes,
      autoLogoutMinutes: req.body.autoLogoutMinutes === undefined
        ? Math.max(normalizeIdlePolicy(existing).autoLogoutMinutes, idleThresholdMinutes + 1)
        : Number(req.body.autoLogoutMinutes),
    };
    const validationError = validateIdlePolicy(policy);

    if (
      validationError
    ) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const settings = await SystemSettings.findOneAndUpdate(
      { key: "global" },
      { $set: policy },
      { returnDocument: "after", upsert: true, runValidators: true }
    );
    settingsGeneration += 1;
    settingsExpiresAt = 0;

    return res.status(200).json({
      success: true,
      message: "Idle settings saved successfully.",
      idlePolicy: {
        ...normalizeIdlePolicy(settings),
      },
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to save idle settings.");
  }
};

module.exports = {
  getIdlePolicy,
  updateIdlePolicy,
  getEmployeeIdlePolicies,
  updateEmployeeIdlePolicy,
};
