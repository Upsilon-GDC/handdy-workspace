const mongoose = require('mongoose');

// Additive employee quotas; shifts/schedules still control their existing flows.
const revision = new mongoose.Schema({
  effectiveFrom: { type: String, required: true },
  requiredSeconds: { type: Number, required: true, min: 0, max: 86400 },
  halfDayPercent: { type: Number, required: true, min: 1, max: 100 },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  changedAt: { type: Date, required: true },
}, { _id: false });
const schema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  version: { type: Number, default: 0 },
  revisions: { type: [revision], default: [] },
}, { timestamps: true, autoCreate: false, autoIndex: false });
schema.index({ employee: 1 }, { unique: true });
module.exports = mongoose.model('WorkingHoursPolicy', schema);
