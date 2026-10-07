const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-commission-${crypto.randomUUID()}.json`);
const previousEnvironment = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "commission-admin@example.invalid";
process.env.ADMIN_PASSWORD = "safe-test-password";
fs.writeFileSync(fixture, JSON.stringify({
  Users: [],
  AuthAccounts: [],
  AuditLogs: [],
  Franchises: [],
  GeoBoundaries: [],
  UserLocations: [],
  Orders: [],
  OrderAttribution: [],
  CommissionRules: [],
  CommissionLedger: [{
    id: "COM-SETTLE-1",
    order_id: "ORDER-SETTLE-1",
    owner_id: "OWNER-SETTLE-1",
    level: "Point",
    rule_id: "RULE-SETTLE-1",
    rule_version: "settlement-v1",
    rate: 10,
    amount: 125,
    status: "Calculated",
    lifecycle_status: "CALCULATED",
    calculation_status: "Calculated",
    settlement_status: "Pending",
    created_at: "2026-09-01T00:00:00.000Z"
  }, {
    id: "COM-REVERSE-1",
    order_id: "ORDER-REVERSE-1",
    owner_id: "OWNER-SETTLE-1",
    level: "Center",
    amount: 40,
    status: "Calculated",
    lifecycle_status: "CALCULATED",
    calculation_status: "Calculated",
    settlement_status: "Pending",
    created_at: "2026-09-02T00:00:00.000Z"
  }],
  WalletLedger: []
}));

const app = require("../server");
const server = app.listen(0, "127.0.0.1");
const commissionService = require("../src/services/commissionService");

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

test("commission rules select the effective version and settlement credits wallet once", async t => {
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
  const adminLogin = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.body.token;

  const olderRule = commissionService.createRule({
    service_id: "SERVICE-001",
    level: "Point",
    rate: 5,
    type: "percentage",
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: "2026-05-31T23:59:59.999Z",
    version: "date-v1",
    status: "ACTIVE"
  });
  const currentRule = commissionService.createRule({
    service_id: "SERVICE-001",
    level: "Point",
    rate: 8,
    type: "percentage",
    effective_from: "2026-06-01T00:00:00.000Z",
    version: "date-v2",
    status: "ACTIVE"
  });
  assert.equal(commissionService.findActiveRule("SERVICE-001", "Point", "2026-03-01T00:00:00.000Z").rule_id, olderRule.rule_id);
  assert.equal(commissionService.findActiveRule("SERVICE-001", "Point", "2026-10-01T00:00:00.000Z").rule_id, currentRule.rule_id);
  assert.deepEqual(commissionService.getApplicableRules("SERVICE-001", "2026-10-01T00:00:00.000Z").map(rule => rule.version), ["date-v2"]);
  assert.throws(() => commissionService.createRule({
    service_id: "SERVICE-001",
    level: "Point",
    rate: 1,
    type: "percentage",
    effective_from: "2026-10-01",
    version: "   ",
    status: "ACTIVE"
  }), /valid commission rule version/);

  const owner = await request(baseUrl, "/auth/admins", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Wallet Owner",
      email: "wallet-owner@example.invalid",
      mobile: "15550001040",
      password: "safe-test-password",
      role: "HQ"
    }
  });
  assert.equal(owner.status, 201);
  const walletOwnerId = owner.body.user.id;
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  data.CommissionLedger.forEach(entry => { entry.owner_id = walletOwnerId; });
  fs.writeFileSync(fixture, JSON.stringify(data));

  const ownerLogin = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: "wallet-owner@example.invalid", password: "safe-test-password" }
  });
  assert.equal(ownerLogin.status, 200);
  const ownerToken = ownerLogin.body.token;

  const pendingWallet = await request(baseUrl, "/wallet", { token: ownerToken });
  assert.equal(pendingWallet.status, 200);
  assert.equal(pendingWallet.body.wallet.balance, 0);
  assert.equal(pendingWallet.body.wallet.count, 0);

  const ownerCannotSettle = await request(baseUrl, "/commissions/COM-SETTLE-1/settle", {
    method: "POST",
    token: ownerToken
  });
  assert.equal(ownerCannotSettle.status, 403);
  const ownerCannotApprove = await request(baseUrl, "/commissions/COM-SETTLE-1/approve", {
    method: "POST",
    token: ownerToken
  });
  assert.equal(ownerCannotApprove.status, 403);

  const unauthorizedWallet = await request(baseUrl, "/wallet?owner_id=OTHER-OWNER", { token: ownerToken });
  assert.equal(unauthorizedWallet.status, 403);

  const invalidReason = await request(baseUrl, "/commissions/COM-REVERSE-1/reverse", {
    method: "POST",
    token: adminToken,
    body: { reason: "bad" }
  });
  assert.equal(invalidReason.status, 400);
  const reverseBeforeSettlement = await request(baseUrl, "/commissions/COM-REVERSE-1/reverse", {
    method: "POST",
    token: adminToken,
    body: { reason: "Duplicate commission calculation identified." }
  });
  assert.equal(reverseBeforeSettlement.status, 200);
  assert.equal(reverseBeforeSettlement.body.entry.lifecycle_status, "REVERSED");
  assert.equal(reverseBeforeSettlement.body.wallet_entry, null);

  const prematureSettlement = await request(baseUrl, "/commissions/COM-SETTLE-1/settle", {
    method: "POST",
    token: adminToken
  });
  assert.equal(prematureSettlement.status, 409);
  assert.equal(prematureSettlement.body.message, "Cannot settle a commission in CALCULATED state");

  const eligible = await request(baseUrl, "/commissions/COM-SETTLE-1/eligible", {
    method: "POST",
    token: adminToken
  });
  assert.equal(eligible.status, 200);
  assert.equal(eligible.body.entry.lifecycle_status, "ELIGIBLE");
  const eligibleAgain = await request(baseUrl, "/commissions/COM-SETTLE-1/eligible", {
    method: "POST",
    token: adminToken
  });
  assert.equal(eligibleAgain.status, 409);

  const approved = await request(baseUrl, "/commissions/COM-SETTLE-1/approve", {
    method: "POST",
    token: adminToken
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.entry.lifecycle_status, "APPROVED");

  const settled = await request(baseUrl, "/commissions/COM-SETTLE-1/settle", {
    method: "POST",
    token: adminToken
  });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.entry.calculation_status, "Calculated");
  assert.equal(settled.body.entry.settlement_status, "SETTLED");
  assert.equal(settled.body.entry.status, "Settled");
  assert.equal(settled.body.wallet_entry.entry, "credit");
  assert.equal(settled.body.wallet_entry.amount, 125);

  const settledAgain = await request(baseUrl, "/commissions/COM-SETTLE-1/settle", {
    method: "POST",
    token: adminToken
  });
  assert.equal(settledAgain.status, 200);
  assert.match(settledAgain.body.message, /already settled/);
  assert.equal(settledAgain.body.wallet_entry.id, settled.body.wallet_entry.id);

  const wallet = await request(baseUrl, "/wallet", { token: ownerToken });
  assert.equal(wallet.body.wallet.balance, 125);
  assert.equal(wallet.body.wallet.credits, 125);
  assert.equal(wallet.body.wallet.debits, 0);
  assert.equal(wallet.body.wallet.count, 1);
  assert.equal(wallet.body.wallet.entries[0].reference, "COM-SETTLE-1");

  const reversed = await request(baseUrl, "/commissions/COM-SETTLE-1/reverse", {
    method: "POST",
    token: adminToken,
    body: { reason: "Order cancelled after commission payout." }
  });
  assert.equal(reversed.status, 200);
  assert.equal(reversed.body.entry.lifecycle_status, "REVERSED");
  assert.equal(reversed.body.entry.settlement_status, "REVERSED");
  assert.equal(reversed.body.wallet_entry.entry, "debit");
  assert.equal(reversed.body.wallet_entry.amount, 125);

  const reversedAgain = await request(baseUrl, "/commissions/COM-SETTLE-1/reverse", {
    method: "POST",
    token: adminToken,
    body: { reason: "Repeated reversal request with a valid reason." }
  });
  assert.equal(reversedAgain.status, 200);
  assert.match(reversedAgain.body.message, /already reversed/);
  assert.equal(reversedAgain.body.wallet_entry.id, reversed.body.wallet_entry.id);
  const reversedWallet = await request(baseUrl, "/wallet", { token: ownerToken });
  assert.equal(reversedWallet.body.wallet.balance, 0);
  assert.equal(reversedWallet.body.wallet.credits, 125);
  assert.equal(reversedWallet.body.wallet.debits, 125);

  const saved = JSON.parse(fs.readFileSync(fixture, "utf8"));
  assert.equal(saved.WalletLedger.length, 2);
  assert.deepEqual(saved.WalletLedger.map(entry => entry.entry), ["credit", "debit"]);
  assert.equal(saved.WalletLedger.filter(entry => entry.reference === "COM-REVERSE-1").length, 0);
  assert.equal(saved.AuditLogs.filter(log => log.action === "COMMISSION_SETTLED").length, 1);
  assert.equal(saved.AuditLogs.filter(log => log.action === "COMMISSION_ELIGIBLE").length, 1);
  assert.equal(saved.AuditLogs.filter(log => log.action === "COMMISSION_APPROVED").length, 1);
  assert.equal(saved.AuditLogs.filter(log => log.action === "COMMISSION_REVERSED").length, 2);
  assert.equal(saved.AuditLogs.find(log => log.action === "COMMISSION_REVERSED" && log.entity_id === "COM-SETTLE-1").metadata.reason, "Order cancelled after commission payout.");
});
