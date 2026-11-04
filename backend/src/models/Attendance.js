const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    date: {
      type: String,
      required: true,
    },

    checkIn: {
      type: Date,
      default: null,
    },

    checkOut: {
      type: Date,
      default: null,
    },

    totalHours: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["Present", "Absent"],
      default: "Present",
    },

    // "timer": maintained automatically from timer activity
    // (services/attendanceService.js). "check_in": created by the older
    // check-in/check-out endpoints, which no current screen calls.
    source: {
      type: String,
      enum: ["check_in", "timer"],
      default: "check_in",
    },
    // Productivity-only exceptions. Timer-derived presence is never replaced.
    workingHoursAdjustments: { type: [new mongoose.Schema({
      type: { type: String, enum: ['normal', 'half_day', 'leave', 'absent'], required: true },
      reason: { type: String, required: true, maxlength: 500 },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
      changedAt: { type: Date, required: true },
    }, { _id: false })], default: undefined },
  },
  {
    timestamps: true,
  }
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ employee: 1, updatedAt: 1 });
attendanceSchema.index({ updatedAt: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
