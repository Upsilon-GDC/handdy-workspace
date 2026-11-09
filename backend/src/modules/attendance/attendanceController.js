const Attendance = require("../../models/Attendance");
const Employee = require("../../models/Employee");
const { getDateKey, getPagination } = require("../../utils/requestUtils");
const sendErrorResponse = require("../../utils/sendErrorResponse");
const { beginReportSync, deltaRows, reportChecksum, wantsChecksum } = require("../../services/reportSync");
const { teamMemberFilter } = require("../../services/teamScope");

async function prepareAttendanceSync(req, res, filter, includeEmployee = false) {
    const sync = await beginReportSync(req, filter, [Employee]);
    if (!sync?.delta) return { sync, handled: false };
    const { status: _status, ...scope } = filter;
    let query = Attendance.find({ ...scope, updatedAt: { $gte: new Date(sync.previous.getTime() - 1_000) } });
    if (includeEmployee) query = query.populate("employee", "employeeId fullName email department designation");
    const [rows, checksum] = await Promise.all([
        query.sort("-date").limit(101).lean(),
        wantsChecksum(req) ? reportChecksum(Attendance, filter) : null,
    ]);
    if (rows.length > 100) return { sync, handled: false };
    const { records, removedIds } = deltaRows(rows, (row) => filter.status && row.status !== filter.status ? null : row);
    res.status(200).json({ success: true, delta: true, attendance: records, removedIds, sync: sync.marker,
        ...(checksum ? { checksum } : {}) });
    return { sync, handled: true };
}

// These authenticated compatibility URLs no longer write attendance. New
// presence and checkout come only from time-entry activity; a legacy request
// must never create presence or overwrite a timer-owned day.
const timerManagedAttendance = (_req, res) => res.status(410).json({
    success: false,
    code: "ATTENDANCE_TIMER_MANAGED",
    message: "Attendance is recorded automatically from time entries. Use the timer to start and stop work.",
});
const checkIn = timerManagedAttendance;
const checkOut = timerManagedAttendance;

// Get today's attendance
const getTodayAttendance = async (req, res) => {
    try {
        const employeeId = req.user._id;
        const today = getDateKey();

        const attendance = await Attendance.findOne({
            employee: employeeId,
            $or: [
                { date: today },
                { checkIn: { $ne: null }, checkOut: null },
            ],
        }).sort({ checkIn: -1 });

        return res.status(200).json({
            success: true,
            attendance: attendance || null,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch today's attendance.");
    }
};
// Get attendance history
const getAttendanceHistory = async (req, res) => {
    try {
        const employeeId = req.user._id;

        const { page, limit, skip } = getPagination(req.query);

        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const sort = req.query.sort === "date" ? "date" : "-date";

        const filter = {
            employee: employeeId,
        };

        if (startDate && endDate) {
            filter.date = {
                $gte: startDate,
                $lte: endDate,
            };
        }

        const { sync, handled } = await prepareAttendanceSync(req, res, filter);
        if (handled) return;
        const totalRecords = await Attendance.countDocuments(filter);

        const attendance = await Attendance.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit);

        return res.status(200).json({
            success: true,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit),
            count: attendance.length,
            totalRecords,
            ...(sync ? { sync: sync.marker } : {}),
            attendance,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch attendance history.");
    }
};
// Get today's attendance for employees assigned to the logged-in Team Lead
const getMyTeamTodayAttendance = async (req, res) => {
    try {
        const today = getDateKey();

        const teamMembers = await Employee.find(await teamMemberFilter(req.user))
            .select("_id employeeId fullName email department designation");

        const teamMemberIds = teamMembers.map((employee) => employee._id);

        const attendanceRecords = await Attendance.find({
            employee: { $in: teamMemberIds },
            date: today,
        });

        const attendanceByEmployee = new Map(
            attendanceRecords.map((record) => [
                record.employee.toString(),
                record,
            ])
        );

        const teamAttendance = teamMembers.map((employee) => ({
            employee,
            attendance:
                attendanceByEmployee.get(employee._id.toString()) || null,
        }));

        return res.status(200).json({
            success: true,
            date: today,
            count: teamAttendance.length,
            teamAttendance,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch team attendance.");
    }
};
// Team Lead - attendance history for assigned team only
const getMyTeamAttendanceHistory = async (req, res) => {
    try {
        const { page, limit, skip } = getPagination(req.query);

        const {
            startDate,
            endDate,
            employee,
            status,
        } = req.query;

        const teamMembers = await Employee.find(await teamMemberFilter(req.user)).select("_id");

        const teamMemberIds = teamMembers.map((member) => member._id);

        const filter = {
            employee: { $in: teamMemberIds },
        };

        if (employee) {
            if (
                !teamMemberIds.some(
                    (id) => id.toString() === employee.toString()
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message: "You cannot view attendance for this employee.",
                });
            }

            filter.employee = employee;
        }

        if (startDate || endDate) {
            filter.date = {};

            if (startDate) {
                filter.date.$gte = startDate;
            }

            if (endDate) {
                filter.date.$lte = endDate;
            }
        }

        if (status) {
            filter.status = status;
        }

        const { sync, handled } = await prepareAttendanceSync(req, res, filter, true);
        if (handled) return;
        const totalRecords = await Attendance.countDocuments(filter);

        const attendance = await Attendance.find(filter)
            .populate(
                "employee",
                "employeeId fullName email department designation"
            )
            .sort("-date")
            .skip(skip)
            .limit(limit);

        return res.status(200).json({
            success: true,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit),
            count: attendance.length,
            totalRecords,
            ...(sync ? { sync: sync.marker } : {}),
            attendance,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch team attendance history.");
    }
};
// Admin - Get company-wide attendance history
const getAllAttendanceHistory = async (req, res) => {
    try {
        const { page, limit, skip } = getPagination(req.query);

        const {
            startDate,
            endDate,
            employee,
            status,
        } = req.query;

        const filter = {};

        // Date filter
        if (startDate || endDate) {
            filter.date = {};

            if (startDate) {
                filter.date.$gte = startDate;
            }

            if (endDate) {
                filter.date.$lte = endDate;
            }
        }

        // Employee filter
        if (employee) {
            filter.employee = employee;
        }

        // Attendance status filter
        if (status) {
            filter.status = status;
        }

        const { sync, handled } = await prepareAttendanceSync(req, res, filter, true);
        if (handled) return;
        const totalRecords = await Attendance.countDocuments(filter);

        const attendance = await Attendance.find(filter)
            .populate(
                "employee",
                "employeeId fullName email department designation role"
            )
            .sort("-date")
            .skip(skip)
            .limit(limit);

        return res.status(200).json({
            success: true,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit),
            count: attendance.length,
            totalRecords,
            ...(sync ? { sync: sync.marker } : {}),
            attendance,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch attendance history.");
    }
};

module.exports = {
    checkIn,
    checkOut,
    getTodayAttendance,
    getAllAttendanceHistory,
    getAttendanceHistory,
    getMyTeamTodayAttendance,
    getMyTeamAttendanceHistory,
};
   
