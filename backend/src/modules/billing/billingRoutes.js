const express = require("express");
const { getBillingEmployees, getBillingReport } = require("./billingController");
const { getReport: getProductionReport } = require('../production/productionReportController');
const { protect } = require("../../middleware/authMiddleware");
const { requirePermission } = require("../../middleware/authorizeRoles");

const router = express.Router();
router.use(protect, requirePermission("view_billing_amounts"));
router.get("/employees", getBillingEmployees);
router.get("/report", getBillingReport);
router.get("/production", getProductionReport);

module.exports = router;
