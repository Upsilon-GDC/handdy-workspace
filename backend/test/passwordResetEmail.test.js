const test = require("node:test");
const assert = require("node:assert/strict");
const Employee = require("../src/models/Employee");
const { forgotPassword } = require("../src/controllers/authController");

const response = () => ({
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("production without SMTP still answers generically and logs the failure without the reset link", async (t) => {
  const saved = { NODE_ENV: process.env.NODE_ENV, FRONTEND_URL: process.env.FRONTEND_URL, SMTP_HOST: process.env.SMTP_HOST };
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = "https://crm.example.test";
  delete process.env.SMTP_HOST;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  t.mock.method(Employee, "findOne", () => ({ select: async () => ({ _id: "employee-1", email: "person@example.test" }) }));
  let stored;
  t.mock.method(Employee, "findByIdAndUpdate", async (id, update) => { stored = update.$set; return {}; });
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", (...args) => logged.push(args.map(String).join(" ")));

  const res = response();
  await forgotPassword({ body: { email: "person@example.test" } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /If an account exists/);
  assert.ok(stored.passwordResetTokenHash, "a reset token was issued");
  const failure = logged.find((line) => line.includes("Unable to send password reset email"));
  assert.ok(failure, "the delivery failure is logged");
  assert.match(failure, /SMTP is not configured/);
  assert.equal(logged.some((line) => /reset-password\?token=/.test(line)), false, "no reset link in the logs");
});
