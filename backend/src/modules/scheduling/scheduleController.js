const Schedule = require("../../models/Schedule");
const Team = require("../../models/Team");
const Employee = require("../../models/Employee");
const Shift = require("../../models/Shift");
const { getPagination } = require("../../utils/requestUtils");
const { getBillingDateRange, getDateKeyInTimezone } = require("../../utils/billingUtils");
const sendErrorResponse = require("../../utils/sendErrorResponse");

const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

const validateScheduleRelations = async ({ team, employee, shift }) => {
  const [validTeam, validEmployee, validShift] = await Promise.all([
    Team.exists({ _id: team, isActive: true }),
    Employee.exists({ _id: employee, isActive: true }),
    Shift.exists({ _id: shift, status: "Active" }),
  ]);
  if (!validTeam) return "Selected team is invalid or inactive.";
  if (!validEmployee) return "Selected employee is invalid or inactive.";
  if (!validShift) return "Selected shift is invalid or inactive.";
  return null;
};

// Guards against creating two active schedules for the same employee on the
// same calendar day. Application-level only (no unique index), so it can't
// conflict with any duplicates that already exist in the database.
const hasConflictingSchedule = async ({ employee, date, excludeId }) => {
  const dateKey = date instanceof Date ? getDateKeyInTimezone(date, APP_TIMEZONE) : date;
  const { start, endExclusive } = getBillingDateRange(dateKey, dateKey, APP_TIMEZONE);

  const filter = {
    employee,
    status: "Active",
    date: { $gte: start, $lt: endExclusive },
  };
  if (excludeId) filter._id = { $ne: excludeId };

  return Boolean(await Schedule.exists(filter));
};

const sendScheduleError = (res, error, fallbackMessage) => {
  if (error?.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "This employee already has an active schedule for that date.",
    });
  }
  if (error?.name === "ValidationError" || error?.name === "RangeError") {
    return res.status(400).json({
      success: false,
      message: "Schedule date and fields must be valid.",
    });
  }
  return sendErrorResponse(res, error, fallbackMessage);
};

// ======================================
// CREATE SCHEDULE
// ======================================
const createSchedule = async (req, res) => {
  try {
    const relationError = await validateScheduleRelations(req.body);
    if (relationError) {
      return res.status(400).json({ success: false, message: relationError });
    }

    if (await hasConflictingSchedule({ employee: req.body.employee, date: req.body.date })) {
      return res.status(400).json({
        success: false,
        message: "This employee already has an active schedule for that date.",
      });
    }

    const schedule = await Schedule.create({
      ...req.body,
      scheduleDateKey: getDateKeyInTimezone(new Date(req.body.date), APP_TIMEZONE),
      createdBy: req.user._id,
    });

    const populatedSchedule = await Schedule.findById(
      schedule._id
    )
      .populate("team")
      .populate("employee", "employeeId fullName")
      .populate("shift")
      .populate("createdBy", "fullName");

    return res.status(201).json({
      success: true,
      message: "Schedule created successfully.",
      schedule: populatedSchedule,
    });
  } catch (error) {
    return sendScheduleError(res, error, "Unable to create schedule.");
  }
};

// ======================================
// GET ALL SCHEDULES
// ======================================
const getAllSchedules = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);

    const team = req.query.team || "";
    const employee = req.query.employee || "";
    const shift = req.query.shift || "";
    const status = req.query.status || "";
    const date = req.query.date || "";

    const filter = {};

    if (team) {
      filter.team = team;
    }

    if (employee) {
      filter.employee = employee;
    }

    if (shift) {
      filter.shift = shift;
    }

    if (status) {
      filter.status = status;
    }

    if (date) {
      const { start, endExclusive } = getBillingDateRange(date, date, APP_TIMEZONE);

      filter.date = {
        $gte: start,
        $lt: endExclusive,
      };
    }

    const totalSchedules =
      await Schedule.countDocuments(filter);

    const schedules = await Schedule.find(filter)
      .populate("team")
      .populate("employee", "employeeId fullName")
      .populate("shift")
      .populate("createdBy", "fullName")
      .sort({
        date: -1,
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      page,
      limit,
      count: schedules.length,
      totalSchedules,
      totalPages: Math.ceil(
        totalSchedules / limit
      ),
      schedules,
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch schedules.");
  }
};

// ======================================
// GET SCHEDULE BY ID
// ======================================
const getScheduleById = async (req, res) => {
  try {
    const schedule = await Schedule.findById(
      req.params.id
    )
      .populate("team")
      .populate("employee", "employeeId fullName")
      .populate("shift")
      .populate("createdBy", "fullName");

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Schedule not found.",
      });
    }

    return res.status(200).json({
      success: true,
      schedule,
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch schedule.");
  }
};

// ======================================
// UPDATE SCHEDULE
// ======================================
const updateSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findById(
      req.params.id
    );

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Schedule not found.",
      });
    }

    const relationError = await validateScheduleRelations({
      team: req.body.team ?? schedule.team,
      employee: req.body.employee ?? schedule.employee,
      shift: req.body.shift ?? schedule.shift,
    });
    if (relationError) {
      return res.status(400).json({ success: false, message: relationError });
    }

    if (await hasConflictingSchedule({
      employee: req.body.employee ?? schedule.employee,
      date: req.body.date ?? schedule.date,
      excludeId: schedule._id,
    })) {
      return res.status(400).json({
        success: false,
        message: "This employee already has an active schedule for that date.",
      });
    }

    const nextDate = new Date(req.body.date ?? schedule.date);
    const update = {
      ...req.body,
      scheduleDateKey: getDateKeyInTimezone(nextDate, APP_TIMEZONE),
    };

    const updatedSchedule =
      await Schedule.findByIdAndUpdate(
        req.params.id,
        update,
        {
          returnDocument: "after",
          runValidators: true,
        }
      )
        .populate("team")
        .populate(
          "employee",
          "employeeId fullName"
        )
        .populate("shift")
        .populate("createdBy", "fullName");

    return res.status(200).json({
      success: true,
      message: "Schedule updated successfully.",
      schedule: updatedSchedule,
    });
  } catch (error) {
    return sendScheduleError(res, error, "Unable to update schedule.");
  }
};

// ======================================
// DELETE SCHEDULE
// ======================================
const deleteSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findById(
      req.params.id
    );

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Schedule not found.",
      });
    }

    schedule.status = "Inactive";
    await schedule.save();

    return res.status(200).json({
      success: true,
      message: "Schedule deactivated successfully.",
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to deactivate schedule.");
  }
};

module.exports = {
  createSchedule,
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
};
