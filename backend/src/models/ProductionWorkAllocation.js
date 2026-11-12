const mongoose = require('mongoose');
// Allocation history references the original log; never copy or move a timer.
// Editing workflow is added with the Production screens/authorization stage.
const schema = new mongoose.Schema({
  timeLog: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskTimeLog', required: true, immutable: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, immutable: true },
  version: { type: Number, min: 1, required: true, immutable: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'production_work_allocations', autoCreate: false, autoIndex: false });
schema.index({ timeLog: 1, version: -1 }, { unique: true, name: 'production_log_allocation_version' });
module.exports = mongoose.model('ProductionWorkAllocation', schema);
