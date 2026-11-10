const mongoose = require('mongoose');
const projectClients = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  clients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
}, { _id: false });
const schema = new mongoose.Schema({
  subjectType: { type: String, enum: ['team', 'employee'], required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
  enabled: { type: Boolean, required: true },
  overrideTeam: { type: Boolean, default: false },
  workTeams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  workProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
  clients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
  // Optional employee limits; omitted projects inherit the normal client policy.
  projectClients: { type: [projectClients], default: [] },
  version: { type: Number, default: 0 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
}, { timestamps: true, autoCreate: false, autoIndex: false });
schema.index({ subjectType: 1, subjectId: 1 }, { unique: true });
module.exports = mongoose.model('ClientAccessPolicy', schema);
