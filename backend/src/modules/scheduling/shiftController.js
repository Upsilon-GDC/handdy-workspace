const Shift = require("../../models/Shift");
const { escapeRegExp, getPagination } = require("../../utils/requestUtils");
const sendErrorResponse = require("../../utils/sendErrorResponse");

// ==============================
// CREATE SHIFT
// ==============================
const createShift = async (
  req,
  res
) => {
  try {
    const shift =
      await Shift.create({
        ...req.body,

        createdBy:
          req.user._id,
      });

    return res
      .status(201)
      .json({
        success: true,

        message:
          "Shift created successfully.",

        shift,
      });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to create shift.");
  }
};

// ==============================
// GET ALL SHIFTS
// ==============================
const getAllShifts = async (
  req,
  res
) => {
  try {
    const { page, limit, skip } = getPagination(req.query);

    const search =
      req.query.search || "";

    const status =
      req.query.status || "";

    const filter = {};

    if (search) {
      const safeSearch = escapeRegExp(search);
      filter.$or = [
        {
          title: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          shiftType: {
            $regex: safeSearch,
            $options: "i",
          },
        },
      ];
    }

    if (
      status &&
      status !== "All"
    ) {
      filter.status = status;
    }

    const totalShifts =
      await Shift.countDocuments(
        filter
      );

    const shifts =
      await Shift.find(filter)
        .populate(
          "createdBy",
          "fullName employeeId"
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit);

    return res
      .status(200)
      .json({
        success: true,

        page,

        limit,

        totalPages:
          Math.ceil(
            totalShifts / limit
          ),

        count:
          shifts.length,

        totalShifts,

        shifts,
      });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch shifts.");
  }
};

// ==============================
// GET SHIFT BY ID
// ==============================
const getShiftById = async (
  req,
  res
) => {
  try {
    const shift =
      await Shift.findById(
        req.params.id
      ).populate(
        "createdBy",
        "fullName employeeId"
      );

    if (!shift) {
      return res
        .status(404)
        .json({
          success: false,

          message:
            "Shift not found.",
        });
    }

    return res
      .status(200)
      .json({
        success: true,

        shift,
      });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch shift.");
  }
};

// ==============================
// UPDATE SHIFT
// ==============================
const updateShift = async (
  req,
  res
) => {
  try {
    const shift =
      await Shift.findById(
        req.params.id
      );

    if (!shift) {
      return res
        .status(404)
        .json({
          success: false,

          message:
            "Shift not found.",
        });
    }

    const updatedShift =
      await Shift.findByIdAndUpdate(
        req.params.id,
        req.body,
        {
          returnDocument: "after",
          runValidators: true,
        }
      ).populate(
        "createdBy",
        "fullName employeeId"
      );

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Shift updated successfully.",

        shift:
          updatedShift,
      });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to update shift.");
  }
};

// ==============================
// DELETE SHIFT
// ==============================
const deleteShift = async (
  req,
  res
) => {
  try {
    const shift =
      await Shift.findById(
        req.params.id
      );

    if (!shift) {
      return res
        .status(404)
        .json({
          success: false,

          message:
            "Shift not found.",
        });
    }

    shift.status = "Inactive";
    await shift.save();

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Shift deactivated successfully.",
      });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to deactivate shift.");
  }
};

module.exports = {
  createShift,
  getAllShifts,
  getShiftById,
  updateShift,
  deleteShift,
};
