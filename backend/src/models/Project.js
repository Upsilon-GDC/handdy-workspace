const mongoose = require("mongoose");
const { SERVICE_TYPES } = require("../utils/serviceRates");

const projectSchema = new mongoose.Schema(
  {
    projectCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    projectName: {
      type: String,
      required: true,
      trim: true,
    },

    // Retained only for backward compatibility with existing project data.
    // Employee rates and billing are linked by project ID instead.
    serviceType: {
      type: String,
      enum: {
        values: [...SERVICE_TYPES, null],
        message: "Select a valid service type",
      },
      trim: true,
      default: null,
    },

    description: {
      type: String,
      default: "",
    },

    clientName: {
      type: String,
      default: "",
    },

    // Existing records use clientName. This reference enables a reliable
    // client → project relationship without invalidating older projects.
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },

    // A shared service project (for example Audit) can be available to
    // several clients. `client` remains as the primary legacy reference.
    clients: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
    }],

    // Optimistic concurrency for website activity-link edits.
    activityLinksVersion: { type: Number, default: 0, min: 0 },
    // Explicit per-project rollout; removing the last mapping must not reopen legacy access.
    activityMappingEnabled: { type: Boolean, default: false },
    // Reuse task IDs without moving tasks or rewriting historical time logs.
    linkedTasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],

    // Projects can be shared by several teams. An empty array is retained for
    // legacy records and means the project has not yet been restricted.
    teams: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
    }],

    status: {
      type: String,
      enum: ["Active", "Completed", "On Hold"],
      default: "Active",
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    startDate: {
      type: Date,
      default: null,
    },

    endDate: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Speed up project filtering by team assignment and by client (task/project
// scoping checks, client-facing project lists).
projectSchema.index({ teams: 1 });
projectSchema.index({ client: 1 });

projectSchema.plugin(require("../services/readRevisions").readRevisionPlugin);
module.exports = mongoose.model("Project", projectSchema);
