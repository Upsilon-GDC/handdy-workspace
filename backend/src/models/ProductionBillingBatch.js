const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, immutable: true },
  startDate: { type: String, required: true, immutable: true },
  endDate: { type: String, required: true, immutable: true },
  timezone: { type: String, required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  requestId: { type: String, required: true, immutable: true },
  status: { type: String, enum: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Finalized'], required: true, default: 'Draft' },
  version: { type: Number, required: true, default: 1, min: 1 },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  sourceHash: { type: String, required: true },
  lastAdjustment: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionBillingAdjustment', default: null },
}, { timestamps: true, collection: 'production_billing_batches', autoCreate: false, autoIndex: false });
schema.index({ employee: 1, team: 1, startDate: 1, endDate: 1 }, { unique: true, name: 'production_billing_period' });
schema.index({ createdBy: 1, requestId: 1 }, { unique: true, name: 'production_billing_create_request' });
schema.index({ team: 1, employee: 1, createdAt: -1 }, { name: 'production_billing_scope' });
schema.index({ employee: 1, createdAt: -1, _id: -1 }, { name: 'production_billing_employee_list' });
schema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'production_billing_status_list' });
schema.index({ createdAt: -1, _id: -1 }, { name: 'production_billing_recent' });
schema.index({ status: 1, 'snapshot.lines.timeLogIds': 1 }, { name: 'production_finalized_log' });
module.exports = mongoose.model('ProductionBillingBatch', schema);
