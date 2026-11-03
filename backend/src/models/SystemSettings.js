const mongoose = require("mongoose");
const { defaults, normalizeIdlePolicy, validateIdlePolicy } = require("../utils/idlePolicy");

const systemSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: ["global"],
      default: "global",
    },
    idleThresholdMinutes: {
      type: Number,
      min: 1,
      max: 240,
      default: defaults.idleThresholdMinutes,
      validate: Number.isInteger,
    },
    autoLogoutMinutes: {
      type: Number,
      min: defaults.minLogoutMinutes,
      max: defaults.maxLogoutMinutes,
      validate: Number.isInteger,
    },
    // Absent on existing settings. Phase 2 stores structure only; selecting or
    // starting a default activity remains disabled until explicitly configured.
    defaultActivity: {
      type: new mongoose.Schema({
        mapping: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivityMapping', required: true },
        enabled: { type: Boolean, default: false },
        mode: { type: String, enum: ['selection_only'], default: 'selection_only' },
      }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true }
);

systemSettingsSchema.pre("validate", function () {
  const error = validateIdlePolicy(normalizeIdlePolicy(this));
  if (error) this.invalidate("autoLogoutMinutes", error);
});

module.exports = mongoose.model("SystemSettings", systemSettingsSchema);
