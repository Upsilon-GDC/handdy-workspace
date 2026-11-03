const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  timeLog: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskTimeLog', required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  revision: { type: Number, required: true },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  reason: { type: String, required: true, maxlength: 500 },
  before: { type: mongoose.Schema.Types.Mixed, required: true },
  after: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true, collection: 'time_entry_edits', autoCreate: false, autoIndex: false });
schema.index({ timeLog: 1, revision: 1 }, { unique: true });
module.exports = mongoose.model('TimeEntryEdit', schema);
