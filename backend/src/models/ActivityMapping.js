const mongoose = require('mongoose');

// Additive catalog only. Existing timer selection/enforcement is unchanged until
// the API/UI rollout. Retain mappings referenced by historical time entries.
const activityMappingSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: undefined },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: undefined },
  migrationId: { type: String, immutable: true, default: undefined },
}, { timestamps: true, collection: 'activity_mappings', autoCreate: false, autoIndex: false });

activityMappingSchema.index({ project: 1, client: 1, task: 1 }, { unique: true, name: 'activity_tuple_unique' });
activityMappingSchema.index({ project: 1, client: 1, isActive: 1 }, { name: 'activity_picker' });
activityMappingSchema.index({ task: 1, isActive: 1 }, { name: 'activity_task' });
activityMappingSchema.plugin(require('../services/readRevisions').readRevisionPlugin);
module.exports = mongoose.model('ActivityMapping', activityMappingSchema);
