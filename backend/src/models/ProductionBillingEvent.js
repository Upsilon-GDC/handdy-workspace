const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionBillingBatch', required: true, immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  action: { type: String, enum: ['create', 'refresh', 'submit', 'approve', 'reject', 'finalize', 'verify-allocations', 'recalculate'], required: true, immutable: true },
  from: { type: String, required: true, immutable: true },
  to: { type: String, required: true, immutable: true },
  version: { type: Number, required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  requestId: { type: String, required: true, immutable: true },
  requestHash: { type: String, required: true, immutable: true },
  sourceHash: { type: String, required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'production_billing_events', autoCreate: false, autoIndex: false });
schema.index({ batch: 1, requestId: 1 }, { unique: true, name: 'production_billing_action_request' });
schema.index({ batch: 1, version: -1 }, { unique: true, name: 'production_billing_event_version' });
module.exports = mongoose.model('ProductionBillingEvent', schema);
