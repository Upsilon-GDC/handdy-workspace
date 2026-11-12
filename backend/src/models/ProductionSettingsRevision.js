const mongoose = require('mongoose');

// Append-only, effective-dated settings. A new revision supersedes a setting;
// existing revisions are never rewritten by the Production API.
const schema = new mongoose.Schema({
  kind: { type: String, enum: ['team-billing', 'classification', 'rate', 'access'], required: true, immutable: true },
  key: { type: String, required: true, immutable: true },
  version: { type: Number, required: true, min: 1, immutable: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, immutable: true },
  effectiveFrom: { type: String, required: true, immutable: true },
  values: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  historicalCorrection: { type: Boolean, default: false, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'production_settings_revisions', autoCreate: false, autoIndex: false });
schema.index({ kind: 1, key: 1, version: 1 }, { unique: true, name: 'production_setting_version' });
schema.index({ kind: 1, team: 1, effectiveFrom: 1, version: 1 }, { name: 'production_setting_effective' });
schema.index({ kind: 1, 'values.employee': 1, effectiveFrom: 1 }, { name: 'production_employee_access' });
module.exports = mongoose.model('ProductionSettingsRevision', schema);
