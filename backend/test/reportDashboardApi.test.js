const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-report-dashboard-${crypto.randomUUID()}.json`);
const previousEnvironment = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "report-admin@example.invalid";
process.env.ADMIN_PASSWORD = "safe-test-password";
fs.writeFileSync(fixture, JSON.stringify({
  Users: [{ id: "CUSTOMER-1", role: "CUSTOMER" }],
  AuthAccounts: [],
  AuditLogs: [],
  UserLocations: [],
  Franchises: [{ id: "POINT-1", level: "Point", owner_id: "OWNER-1", status: "ACTIVE" }],
  GeoBoundaries: [],
  GeoMappingCorrections: [],
  Orders: [],
  OrderAttribution: [],
  CommissionRules: [],
  CommissionLedger: [
    { id: "COM-1", owner_id: "OWNER-1", level: "Point", amount: 125, settlement_status: "SETTLED", created_at: "2026-05-15T12:00:00.000Z" },
    { id: "COM-2", owner_id: "OWNER-1", level: "Center", amount: 25, settlement_status: "Pending", created_at: "2026-06-15T12:00:00.000Z" },
    { id: "COM-3", owner_id: "OWNER-1", level: "Hub", amount: 50, settlement_status: "Pending", created_at: "2026-07-15T12:00:00.000Z" }
  ],
  WalletLedger: [
    { id: "WALLET-1", owner_id: "OWNER-1", entry: "credit", amount: 125 },
    { id: "WALLET-2", owner_id: "OWNER-1", entry: "debit", amount: 5 }
  ]
}));

const app = require("../server");
const server = app.listen(0, "127.0.0.1");

async function request(baseUrl, endpoint, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

test("dashboard exposes settlement metrics and reports validate/filter commission dates", async t => {
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
    if (previousEnvironment.dataFile === undefined) delete process.env.ZYNGRAM_DATA_FILE;
    else process.env.ZYNGRAM_DATA_FILE = previousEnvironment.dataFile;
    if (previousEnvironment.adminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previousEnvironment.adminEmail;
    if (previousEnvironment.adminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousEnvironment.adminPassword;
  });

  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const login = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
  });
  assert.equal(login.status, 200);

  const dashboard = await request(baseUrl, "/dashboard", { token: login.body.token });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.metrics.commission_total, 200);
  assert.equal(dashboard.body.metrics.settled_commission_total, 125);
  assert.equal(dashboard.body.metrics.pending_commission_total, 75);
  assert.equal(dashboard.body.metrics.wallet_balance, 120);

  const report = await request(baseUrl, "/reports/commissions?start_date=2026-05-01&end_date=2026-06-30", {
    token: login.body.token
  });
  assert.equal(report.status, 200);
  assert.equal(report.body.count, 2);
  assert.equal(report.body.total, 150);
  assert.equal(report.body.settled_total, 125);
  assert.equal(report.body.pending_total, 25);
  assert.deepEqual(report.body.by_level.map(item => [item.level, item.count, item.total]), [
    ["Point", 1, 125],
    ["Center", 1, 25],
    ["Hub", 0, 0],
    ["Command", 0, 0]
  ]);

  const invalidDate = await request(baseUrl, "/reports/commissions?start_date=2026-02-30", {
    token: login.body.token
  });
  assert.equal(invalidDate.status, 400);
  const reversedRange = await request(baseUrl, "/reports/commissions?start_date=2026-06-01&end_date=2026-05-01", {
    token: login.body.token
  });
  assert.equal(reversedRange.status, 400);
});
