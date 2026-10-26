const express = require("express");
const Client = require("../../models/Client");
const { protect } = require("../../middleware/authMiddleware");
const { requirePermission } = require("../../middleware/authorizeRoles");
const { userHasPermission } = require("../../services/permissionService");
const { escapeRegExp } = require("../../utils/requestUtils");
const sendErrorResponse = require("../../utils/sendErrorResponse");

const router = express.Router();
const catalogCache = require("../../middleware/catalogCache");

// Employees use this list to choose a client when starting desktop work.
// Creating, changing, and deactivating clients remains administrative.
router.get("/", protect, catalogCache([Client], { shared: true }), async (req, res) => {
  try {
    const filter = { status: { $ne: "Inactive" } };
    if (req.query.search) {
      filter.clientName = { $regex: escapeRegExp(req.query.search), $options: "i" };
    }
    const query = Client.find(filter).sort({ createdAt: -1 });
    if (["employee", "team_lead"].includes(req.user.role) && !userHasPermission(req.user, "manage_clients")) {
      query.select("clientName status");
    }
    const clients = await query;
    return res.json({ success: true, count: clients.length, clients });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to load clients.");
  }
});

router.use(protect, requirePermission("manage_clients"));

router.post("/", async (req, res) => {
  try {
    const { clientName } = req.body;
    if (typeof clientName !== "string" || !clientName.trim()) return res.status(400).json({ success: false, message: "Client name is required." });
    const client = await Client.create({ clientName: clientName.trim(), createdBy: req.user._id });
    return res.status(201).json({ success: true, message: "Client created successfully.", client });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to create client.");
  }
});

router.put("/:id", async (req, res) => {
  try {
    const clientName = typeof req.body.clientName === "string" ? req.body.clientName.trim() : "";
    if (!clientName) return res.status(400).json({ success: false, message: "Client name is required." });
    const updates = { clientName };
    const client = await Client.findByIdAndUpdate(req.params.id, updates, { returnDocument: "after", runValidators: true });
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });
    return res.json({ success: true, message: "Client updated successfully.", client });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to update client.");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, { status: "Inactive" }, { returnDocument: "after" });
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });
    return res.json({ success: true, message: "Client deactivated successfully.", client });
  } catch (error) {
    return res.status(error.name === "CastError" ? 400 : 500).json({ success: false, message: "Unable to deactivate client." });
  }
});

module.exports = router;
