const mongoose = require('mongoose');
const reference = new mongoose.Schema({ id: { type: mongoose.Schema.Types.ObjectId, required: true }, name: { type: String, required: true } }, { _id: false });
const schema = new mongoose.Schema({
  action: { type: String, enum: ['link', 'unlink'], required: true },
  mode: { type: String, enum: ['tasks', 'clients'], required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  actorName: { type: String, required: true },
  projects: { type: [reference], required: true },
  clients: { type: [reference], required: true },
  tasks: { type: [reference], default: [] },
  combinationCount: { type: Number, required: true, min: 1 },
}, { timestamps: true, collection: 'activity_link_changes', autoCreate: false, autoIndex: false });
schema.index({ mode: 1, createdAt: -1, _id: -1 });
schema.index({ actor: 1, mode: 1, createdAt: -1, _id: -1 });
module.exports = mongoose.model('ActivityLinkChange', schema);
