const mongoose = require('mongoose');
// One active/finalized billing period per employee/team/day, including periods
// with different start/end dates. This prevents overlapping invoices.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionBillingBatch', required: true },
}, { collection: 'production_billing_claims', autoCreate: false, autoIndex: false });
schema.index({ batch: 1 }, { name: 'production_claim_batch' });
module.exports = mongoose.model('ProductionBillingClaim', schema);
