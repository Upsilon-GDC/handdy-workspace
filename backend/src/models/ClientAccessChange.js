const mongoose = require('mongoose');
const client = new mongoose.Schema({ id: mongoose.Schema.Types.ObjectId, name: String }, { _id: false });
const target = new mongoose.Schema({
  subjectType: { type: String, enum: ['team', 'employee'], required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true }, name: { type: String, required: true },
  beforeEnabled: { type: Boolean, required: true }, afterEnabled: { type: Boolean, required: true },
  beforeOverrideTeam: { type: Boolean, default: false }, afterOverrideTeam: { type: Boolean, default: false },
  beforeWorkTeams: [client], afterWorkTeams: [client],
  beforeWorkProjects: [client], afterWorkProjects: [client],
  beforeClients: [client], afterClients: [client], version: { type: Number, required: true },
}, { _id: false });
const schema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  actorName: { type: String, required: true },
  team: { type: mongoose.Schema.Types.ObjectId, default: null }, teamName: { type: String, required: true },
  targets: { type: [target], required: true },
}, { timestamps: true, autoCreate: false, autoIndex: false });
schema.index({ createdAt: -1, _id: -1 });
module.exports = mongoose.model('ClientAccessChange', schema);
