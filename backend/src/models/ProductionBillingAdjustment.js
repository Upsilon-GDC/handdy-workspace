const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionBillingBatch', required: true, immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  version: { type: Number, required: true, immutable: true },
  deltas: { type: [new mongoose.Schema({ currency: String, amount: Number }, { _id: false })], required: true, immutable: true },
  resultSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  sourceHash: { type: String, required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'production_billing_adjustments', autoCreate: false, autoIndex: false });
schema.index({ batch: 1, version: -1 }, { unique: true, name: 'production_billing_adjustment_version' });
module.exports = mongoose.model('ProductionBillingAdjustment', schema);
