const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  action: { type: String, enum: ['setting-created', 'setting-revised'], required: true, immutable: true },
  revision: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionSettingsRevision', required: true, immutable: true },
  previousRevision: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionSettingsRevision', default: null, immutable: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  historicalCorrection: { type: Boolean, default: false, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'production_audit_events', autoCreate: false, autoIndex: false });
schema.index({ revision: 1 }, { unique: true, name: 'production_revision_audit' });
schema.index({ team: 1, createdAt: -1, _id: -1 }, { name: 'production_team_audit' });
module.exports = mongoose.model('ProductionAuditEvent', schema);
