const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { SERVICE_TYPES } = require("../utils/serviceRates");

const serviceRateSchema = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      required: [true, "Service type is required"],
      enum: {
        values: SERVICE_TYPES,
        message: "Select a valid service type",
      },
      trim: true,
    },
    chargeRate: {
      type: Number,
      required: [true, "Charge rate is required"],
      min: [0.01, "Charge rate must be greater than zero"],
      max: [1_000_000, "Charge rate is too large"],
    },
  },
  { _id: false }
);

const projectRateSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: [true, "Project is required"],
    },
    chargeRate: {
      type: Number,
      required: [true, "Charge rate is required"],
      min: [0.01, "Charge rate must be greater than zero"],
      max: [1_000_000, "Charge rate is too large"],
    },
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: [true, "Employee ID is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },

    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      minlength: [2, "Full name must contain at least 2 characters"],
      maxlength: [100, "Full name cannot exceed 100 characters"],
    },

    firstName: {
      type: String,
      trim: true,
      default: "",
    },

    lastName: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please enter a valid email address",
      ],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must contain at least 8 characters"],
      select: false,
    },

    role: {
      type: String,
      enum: {
        values: ["alpha", "admin", "team_lead", "hr", "manager", "employee"],
        message: "Role must be alpha, admin, team_lead, hr, manager, or employee",
      },
      default: "employee",
    },

    department: {
      type: String,
      trim: true,
      default: "",
    },

    designation: {
      type: String,
      trim: true,
      default: "",
    },

    companyName: {
      type: String,
      trim: true,
      default: "",
    },

    address1: {
      type: String,
      trim: true,
      default: "",
    },

    address2: {
      type: String,
      trim: true,
      default: "",
    },

    city: {
      type: String,
      trim: true,
      default: "",
    },

    state: {
      type: String,
      trim: true,
      default: "",
    },

    postalCode: {
      type: String,
      trim: true,
      default: "",
    },

    country: {
      type: String,
      trim: true,
      default: "",
    },

    phoneNumber: {
      type: String,
      trim: true,
      default: "",
    },

    serviceRates: {
      type: [serviceRateSchema],
      default: [],
      select: false,
      validate: {
        validator(assignments) {
          const serviceTypes = assignments.map((assignment) => assignment.serviceType);
          return new Set(serviceTypes).size === serviceTypes.length;
        },
        message: "A service type cannot be assigned more than once",
      },
    },

    projectRates: {
      type: [projectRateSchema],
      default: [],
      validate: {
        validator(assignments) {
          const projectIds = assignments.map((assignment) => String(assignment.project));
          return new Set(projectIds).size === projectIds.length;
        },
        message: "The same project cannot be assigned more than once",
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // Admin-granted delegated permissions for non-admin roles. Deliberately a
    // short, explicit allowlist — password reset, deletion, role promotion,
    // and system settings are never delegable through this mechanism, only
    // through the true "admin" role.
    permissions: {
      type: [String],
      enum: {
        values: ["create_employees", "edit_employees"],
        message: "Invalid permission",
      },
      default: [],
    },

    // Personal exceptions to the role's permissions, set on the Permissions
    // page ("By employee"). Keys in `granted` are on and keys in `revoked` are
    // off for this person whatever the role says; every other key follows the
    // role. Validated against the catalog when saved (no enum here, so a key
    // later removed from the catalog cannot block other employee edits).
    permissionOverrides: {
      granted: { type: [String], default: undefined, select: false },
      revoked: { type: [String], default: undefined, select: false },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null, select: false },
      updatedAt: { type: Date, default: null, select: false },
    },

    teamLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },

    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },

    rememberedSessionTokenHash: {
      type: String,
      default: null,
      select: false,
    },

    rememberedSessionExpires: {
      type: Date,
      default: null,
      select: false,
    },

    rememberedSessions: {
      type: [{
        tokenHash: { type: String, required: true },
        expiresAt: { type: Date, required: true },
      }],
      default: [],
      select: false,
    },

    // This operational exemption is intentionally backend-only. It is not
    // included in admin employee forms or ordinary employee API responses.
    idleTrackingExempt: {
      type: Boolean,
      default: false,
      select: false,
    },

    // Per-employee policy managed only by the terminal-provisioned Alpha role.
    // Null values mean the company-wide policy applies.
    idlePolicyOverride: {
      idleThresholdMinutes: { type: Number, default: null, select: false },
      autoLogoutMinutes: { type: Number, default: null, select: false },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null, select: false },
      updatedAt: { type: Date, default: null, select: false },
    },

    passwordResetTokenHash: {
      type: String,
      default: null,
      select: false,
    },

    passwordResetExpires: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// The product supports one locally managed idle-exempt employee.
employeeSchema.index(
  { idleTrackingExempt: 1 },
  {
    unique: true,
    partialFilterExpression: { idleTrackingExempt: true },
  }
);

// Speed up the common employee list/report filters (getAllEmployees,
// getMyTeam, task/schedule relation checks, etc.).
employeeSchema.index({ team: 1 });
employeeSchema.index({ teamLead: 1 });
employeeSchema.index({ role: 1 });

// Previously issued reset links must not survive a password or email change,
// including administrator edits and self-service profile updates.
employeeSchema.pre("validate", function invalidatePasswordReset() {
  if (this.isModified("password") || this.isModified("email")) {
    this.passwordResetTokenHash = null;
    this.passwordResetExpires = null;
  }
});

// Hash password before saving
employeeSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare entered password with stored hash
employeeSchema.methods.comparePassword = async function (
  enteredPassword
) {
  return bcrypt.compare(
    enteredPassword,
    this.password
  );
};

employeeSchema.plugin(require("../services/readRevisions").readRevisionPlugin);
employeeSchema.plugin(require("../services/authCache").authCachePlugin);
const Employee = mongoose.model(
  "Employee",
  employeeSchema
);

module.exports = Employee;
