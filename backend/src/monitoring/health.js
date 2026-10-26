const mongoose = require("mongoose");

// Render calls GET /health to decide whether the service is healthy (and
// whether a new deploy is ready). Without MongoDB nothing works, so that is
// reported as 503; HEALTH_CHECK_DATABASE=false restores the old always-200
// answer. The answer contains no secrets.
function healthCheck(req, res) {
  const databaseUp = mongoose.connection.readyState === 1;
  if (!databaseUp && process.env.HEALTH_CHECK_DATABASE !== "false") {
    return res.status(503).json({ success: false, message: "Database unavailable", database: "disconnected" });
  }
  return res.status(200).json({
    success: true,
    message: "Employee Time & Attendance Backend is Running",
    database: databaseUp ? "connected" : "disconnected",
  });
}

module.exports = { healthCheck };
