const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");

const fixture = path.join(os.tmpdir(), `zyngram-auth-rate-limit-${crypto.randomUUID()}.json`);
fs.writeFileSync(fixture, JSON.stringify({ Users: [], AuthAccounts: [], AuthSessions: [], AuditLogs: [] }));
process.env.ZYNGRAM_DATA_FILE = fixture;

const app = express();
app.use(express.json());
app.use("/api/auth", require("../src/routes/authRoutes"));
const server = http.createServer(app);

test.before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
});

test("login attempts from one client are rate limited", async () => {
  const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "missing@example.invalid", password: "incorrect-password" })
    });
    assert.equal(response.status, 401);
  }

  const limitedResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "missing@example.invalid", password: "incorrect-password" })
  });
  assert.equal(limitedResponse.status, 429);
  assert.deepEqual(await limitedResponse.json(), {
    success: false,
    message: "Too many login attempts. Please try again later."
  });
});

test("registration attempts from one client are rate limited", async () => {
  const url = `http://127.0.0.1:${server.address().port}/api/auth/register`;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
  }

  const limitedResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(limitedResponse.status, 429);
  assert.deepEqual(await limitedResponse.json(), {
    success: false,
    message: "Too many registration attempts. Please try again later."
  });
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
  delete process.env.ZYNGRAM_DATA_FILE;
});
