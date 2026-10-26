// Sends a real password-reset email through the mailer (nodemailer 10) to a
// minimal local SMTP server, so a library upgrade cannot silently break resets.
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");

function fakeSmtpServer() {
  const received = { auth: null, from: null, to: [], data: "" };
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let authLogin = 0;
    socket.write("220 test.local ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") { inData = false; socket.write("250 OK queued as test-1\r\n"); } else received.data += `${line}\n`;
          continue;
        }
        if (authLogin === 1) { received.auth = Buffer.from(line, "base64").toString(); authLogin = 2; socket.write("334 UGFzc3dvcmQ6\r\n"); continue; }
        if (authLogin === 2) { authLogin = 0; socket.write("235 Authentication successful\r\n"); continue; }
        const command = line.toUpperCase();
        if (command.startsWith("EHLO") || command.startsWith("HELO")) socket.write("250-test.local\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
        else if (command.startsWith("AUTH PLAIN")) { received.auth = Buffer.from(line.split(" ")[2] || "", "base64").toString().split("\0")[1]; socket.write("235 Authentication successful\r\n"); }
        else if (command.startsWith("AUTH LOGIN")) { authLogin = 1; socket.write("334 VXNlcm5hbWU6\r\n"); }
        else if (command.startsWith("MAIL FROM")) { received.from = line; socket.write("250 OK\r\n"); }
        else if (command.startsWith("RCPT TO")) { received.to.push(line); socket.write("250 OK\r\n"); }
        else if (command === "DATA") { inData = true; socket.write("354 End data with <CR><LF>.<CR><LF>\r\n"); }
        else if (command === "QUIT") { socket.end("221 Bye\r\n"); }
        else socket.write("250 OK\r\n");
      }
    });
  });
  return { server, received };
}

test("password-reset email is delivered over SMTP with login, recipient and link", async (t) => {
  const { server, received } = fakeSmtpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.address().port),
    SMTP_USER: "crm-mailer@example.test", SMTP_PASS: "test-only-password", MAIL_FROM: "CRM <no-reply@example.test>",
  });
  t.mock.method(console, "log", () => {});
  const { sendPasswordResetEmail, verifyEmailTransport } = require("../src/utils/mailer");
  assert.equal(await verifyEmailTransport(), true);
  await sendPasswordResetEmail({ to: "person@example.test", resetUrl: "https://crm.example.test/reset-password?token=abc123" });
  assert.equal(received.auth, "crm-mailer@example.test");
  assert.match(received.from, /no-reply@example\.test/);
  assert.match(received.to.join(), /person@example\.test/);
  assert.match(received.data, /Subject: Reset your CRM password/);
  assert.match(received.data.replace(/=\n/g, "").replace(/=3D/g, "="), /reset-password\?token=abc123/);
});
