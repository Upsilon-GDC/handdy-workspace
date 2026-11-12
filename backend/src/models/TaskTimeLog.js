const mongoose = require("mongoose");

const pauseSchema = new mongoose.Schema(
  {
    pausedAt: {
      type: Date,
      required: true,
    },

    resumedAt: {
      type: Date,
      default: null,
    },

    reason: {
      type: String,
      enum: ["manual", "idle", "break"],
      default: "manual",
    },
  },
  {
    _id: false,
  }
);

const taskTimeLogSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },

    // Optional for additive rollout; never backfill or rewrite historical tuples.
    activityMapping: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ActivityMapping',
      default: undefined,
    },

    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },

    startedAt: {
      type: Date,
      required: true,
    },

    stoppedAt: {
      type: Date,
      default: null,
    },

    note: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    pauses: {
      type: [pauseSchema],
      default: [],
    },

    totalPausedSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalIdleSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalWorkedSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["running", "paused", "stopped"],
      default: "running",
    },

    isActiveTimer: {
      type: Boolean,
      default: true,
    },
    // Set by the server for every new live start. Null remains valid for
    // historical records and completed manual entries; do not backfill it.
    desktopHeartbeatAt: { type: Date, default: null },
    // Last OS-idle sample only; no input contents or activity history.
    desktopIdleSample: { type: new mongoose.Schema({ seconds: Number, observedAt: Date, appVersion: String }, { _id: false }), default: undefined },
    stopReason: { type: String, enum: ["desktop_disconnected"], default: null },

    // Records created by an authorized manager/admin instead of a live timer.
    // Absent on every pre-existing log, which is treated as "timer".
    entrySource: { type: String, enum: ["timer", "manual"], default: "timer" },
    editVersion: { type: Number, default: 0, min: 0 },
    manualEntry: {
      type: new mongoose.Schema(
        {
          createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
          createdAt: { type: Date, required: true },
          reason: { type: String, required: true, trim: true, maxlength: 500 },
          deletedAt: { type: Date, default: null },
          deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },

    autoLogoutAt: {
      type: Date,
      default: null,
    },

    logoutReason: {
      type: String,
      enum: ["manual", "inactivity"],
      default: null,
    },

    // IDs chosen by the desktop for one start or stop action. A retry with the
    // same ID (for example after a lost response) returns the first result
    // instead of acting twice. Absent on older records and older clients.
    startOperationId: { type: String, default: undefined },
    stopOperationId: { type: String, default: undefined },
    // Immutable identity of a manual-create request, retained through edits
    // and soft deletion so a lost-response retry cannot create another entry.
    manualOperationId: { type: String, default: undefined },
    manualRequestHash: { type: String, default: undefined },
  },
  {
    timestamps: true,
    collection: "task_time_logs",
  }
);

taskTimeLogSchema.index(
  { employee: 1, isActiveTimer: 1 },
  {
    unique: true,
    partialFilterExpression: { isActiveTimer: true },
  }
);

// One start per operation ID, even for two identical requests at once.
taskTimeLogSchema.index(
  { employee: 1, startOperationId: 1 },
  { unique: true, partialFilterExpression: { startOperationId: { $type: "string" } } }
);
taskTimeLogSchema.index(
  { employee: 1, stopOperationId: 1 },
  { partialFilterExpression: { stopOperationId: { $type: "string" } } }
);

taskTimeLogSchema.index({ employee: 1, status: 1, startedAt: 1, stoppedAt: 1 });
taskTimeLogSchema.index(
  { employee: 1, 'manualEntry.createdBy': 1, manualOperationId: 1 },
  { name: 'manual_entry_operation', unique: true, partialFilterExpression: { manualOperationId: { $type: 'string' } } }
);
taskTimeLogSchema.index({ isActiveTimer: 1, desktopHeartbeatAt: 1 });
taskTimeLogSchema.index({ employee: 1, updatedAt: 1 });
taskTimeLogSchema.index({ updatedAt: 1 });
taskTimeLogSchema.index({ status: 1 });

module.exports = mongoose.model("TaskTimeLog", taskTimeLogSchema);
