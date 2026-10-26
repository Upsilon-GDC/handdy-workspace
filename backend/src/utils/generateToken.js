const jwt = require("jsonwebtoken");

const generateToken = (employeeId, tokenVersion = 0, session) => {
  if (!session?.sessionId || !session?.deviceId) {
    throw new Error("An active authentication session is required to issue a token.");
  }

  return jwt.sign(
    {
      employeeId,
      tokenVersion,
      sessionId: session.sessionId,
      deviceId: session.deviceId,
    },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
};

module.exports = generateToken;
