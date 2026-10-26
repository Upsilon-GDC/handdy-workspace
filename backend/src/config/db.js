const mongoose = require("mongoose");

const connectDatabase = async () => {
  try {
    const connection = await mongoose.connect(process.env.MONGODB_URI, {
      // Compress the wire traffic to Atlas (zlib is built into Node, so no
      // extra package is needed). Any compressors=... in MONGODB_URI are
      // combined with this one; the server picks the first both sides support.
      compressors: ["zlib"],
      // One small server with ~15 desktop clients needs few connections. A
      // bounded pool avoids bursts of new TLS connections (each one costs a
      // handshake to Atlas). Override with MONGODB_MAX_POOL_SIZE.
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 10,
      // Command events feed the traffic metrics (services/trafficMetrics.js).
      ...(process.env.METRICS_ENABLED === "true" ? { monitorCommands: true } : {}),
    });

    console.log(
      `MongoDB connected successfully: ${connection.connection.host}`
    );
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDatabase;