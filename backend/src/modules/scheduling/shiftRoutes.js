const express =
  require("express");

const {
  createShift,
  getAllShifts,
  getShiftById,
  updateShift,
  deleteShift,
} = require(
  "./shiftController"
);

const {
  protect,
} = require(
  "../../middleware/authMiddleware"
);

const {
  authorizeRoles,
} = require(
  "../../middleware/authorizeRoles"
);

const router =
  express.Router();

// ==============================
// CREATE SHIFT
// ==============================
router.post(
  "/",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  createShift
);

// ==============================
// GET ALL SHIFTS
// ==============================
router.get(
  "/",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  getAllShifts
);

// ==============================
// GET ONE SHIFT
// ==============================
router.get(
  "/:id",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  getShiftById
);

// ==============================
// UPDATE SHIFT
// ==============================
router.put(
  "/:id",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  updateShift
);

// ==============================
// DELETE SHIFT
// ==============================
router.delete(
  "/:id",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  deleteShift
);

module.exports = router;