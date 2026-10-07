const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-customer-geo-flow-${crypto.randomUUID()}.json`);
const previousEnvironment = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
const polygon = [[83.2, 17.7], [83.24, 17.7], [83.24, 17.67], [83.2, 17.67], [83.2, 17.7]];
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "geo-flow-admin@example.invalid";
process.env.ADMIN_PASSWORD = "safe-test-password";
fs.writeFileSync(fixture, JSON.stringify({
  Users: [],
  AuthAccounts: [],
  AuthSessions: [],
  AuditLogs: [],
  UserLocations: [],
  Franchises: [],
  GeoBoundaries: [],
  GeoMappingCorrections: [],
  Orders: [],
  OrderAttribution: [],
  CommissionRules: [],
  CommissionLedger: [],
  WalletLedger: [],
  Services: []
}));

const app = require("../server");
const server = app.listen(0, "127.0.0.1");
const franchiseService = require("../src/services/franchiseService");
const geoBoundaryService = require("../src/services/geoBoundaryService");
const commissionService = require("../src/services/commissionService");

async function request(baseUrl, endpoint, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(token ? { Authorization: ["Bearer", token].join(" ") } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

test("customer registration, GPS mapping, order attribution, and unmapped rejection are backend-controlled", async t => {
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

  const command = franchiseService.createFranchise({ level: "Command", name: "Approved Command", owner_id: "OWNER-CMD" });
  const hub = franchiseService.createFranchise({ level: "Hub", name: "Approved Hub", owner_id: "OWNER-HUB", parent_id: command.id });
  const center = franchiseService.createFranchise({ level: "Center", name: "Approved Center", owner_id: "OWNER-CENTER", parent_id: hub.id });
  const point = franchiseService.createFranchise({ level: "Point", name: "Approved Point", owner_id: "OWNER-POINT", parent_id: center.id });
  geoBoundaryService.createGeoBoundary({
    franchise_id: point.id,
    version: "approved-geo-v1",
    geometry: { type: "Polygon", coordinates: [polygon] }
  });
  const commissionRates = [
    ["Point", 2, "OWNER-POINT"],
    ["Center", 1, "OWNER-CENTER"],
    ["Hub", 0.5, "OWNER-HUB"],
    ["Command", 0.5, "OWNER-CMD"]
  ];
  for (const [level, rate] of commissionRates) {
    commissionService.createRule({
      service_id: "SERVICE-001",
      level,
      rate,
      type: "percentage",
      effective_from: "2020-01-01T00:00:00.000Z",
      version: "geo-flow-v1",
      status: "ACTIVE"
    });
  }

  const registration = await request(baseUrl, "/auth/register", {
    method: "POST",
    body: {
      name: "Geo Flow Customer",
      email: "geo-flow-customer@example.invalid",
      mobile: "9876501234",
      password: "safe-test-password"
    }
  });
  assert.equal(registration.status, 201);
  const customer = registration.body.user;
  const customerToken = registration.body.token;
  assert.equal(customer.role, "CUSTOMER");
  assert.ok(customer.id);

  const mappedCapture = await request(baseUrl, "/locations/capture", {
    method: "POST",
    token: customerToken,
    body: {
      lat: 17.6868,
      lon: 83.2185,
      accuracy: 12,
      source: "browser",
      franchise_id: "CUSTOMER-SUPPLIED-FRANCHISE"
    }
  });
  assert.equal(mappedCapture.status, 201);
  assert.equal(mappedCapture.body.location.user_id, customer.id);
  assert.equal(mappedCapture.body.mapping.status, "MAPPED");
  assert.equal(mappedCapture.body.mapping.point.id, point.id);
  assert.equal(mappedCapture.body.mapping.center.id, center.id);
  assert.equal(mappedCapture.body.mapping.hub.id, hub.id);
  assert.equal(mappedCapture.body.mapping.command.id, command.id);
  assert.equal(mappedCapture.body.mapping.mapping_version, "approved-geo-v1");
  assert.equal(mappedCapture.body.mapping.franchise_id, undefined);

  const order = await request(baseUrl, "/orders", {
    method: "POST",
    token: customerToken,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      service_id: "SERVICE-001",
      location_id: mappedCapture.body.location.id,
      franchise_id: "CUSTOMER-SUPPLIED-FRANCHISE",
      amount: 0.01
    }
  });
  assert.equal(order.status, 201);
  assert.equal(order.body.order.customer_id, customer.id);
  assert.equal(order.body.order.location_id, mappedCapture.body.location.id);
  assert.equal(order.body.order.amount, 1000);
  assert.equal(order.body.mapping.point.id, point.id);

  const confirmed = await request(baseUrl, `/orders/${order.body.order.id}/confirm`, {
    method: "POST",
    token: adminLogin.body.token
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.attribution.order_id, order.body.order.id);
  assert.equal(confirmed.body.attribution.point_id, point.id);
  assert.equal(confirmed.body.attribution.center_id, center.id);
  assert.equal(confirmed.body.attribution.hub_id, hub.id);
  assert.equal(confirmed.body.attribution.command_id, command.id);
  assert.equal(confirmed.body.attribution.coordinates.lat, mappedCapture.body.location.lat);
  assert.equal(confirmed.body.attribution.coordinates.lon, mappedCapture.body.location.lon);
  assert.equal(confirmed.body.attribution.coordinates.accuracy, 12);
  assert.equal(confirmed.body.attribution.coordinates.source, "browser");
  assert.equal(confirmed.body.attribution.mapping_version, "approved-geo-v1");
  assert.deepEqual(confirmed.body.commissions.map(entry => entry.amount), [20, 10, 5, 5]);
  assert.equal(confirmed.body.commissions.length, commissionRates.length);

  for (const [index, commission] of confirmed.body.commissions.entries()) {
    const eligible = await request(baseUrl, `/commissions/${commission.ledger.id}/eligible`, {
      method: "POST",
      token: adminLogin.body.token
    });
    assert.equal(eligible.status, 200);
    const approved = await request(baseUrl, `/commissions/${commission.ledger.id}/approve`, {
      method: "POST",
      token: adminLogin.body.token
    });
    assert.equal(approved.status, 200);
    const settled = await request(baseUrl, `/commissions/${commission.ledger.id}/settle`, {
      method: "POST",
      token: adminLogin.body.token
    });
    assert.equal(settled.status, 200);
    assert.equal(settled.body.entry.settlement_status, "SETTLED");
    assert.equal(settled.body.wallet_entry.entry, "credit");
    assert.equal(settled.body.wallet_entry.amount, [20, 10, 5, 5][index]);

    const duplicateSettlement = await request(baseUrl, `/commissions/${commission.ledger.id}/settle`, {
      method: "POST",
      token: adminLogin.body.token
    });
    assert.equal(duplicateSettlement.status, 200);
    assert.match(duplicateSettlement.body.message, /already settled/);
    assert.equal(duplicateSettlement.body.wallet_entry.id, settled.body.wallet_entry.id);

    const wallet = await request(baseUrl, `/wallet?owner_id=${encodeURIComponent(commission.owner_id)}`, {
      token: adminLogin.body.token
    });
    assert.equal(wallet.status, 200);
    assert.equal(wallet.body.wallet.balance, [20, 10, 5, 5][index]);
    assert.equal(wallet.body.wallet.count, 1);
  }

  const unmappedCapture = await request(baseUrl, "/locations/capture", {
    method: "POST",
    token: customerToken,
    body: { lat: 0, lon: 0, accuracy: 10, source: "browser" }
  });
  assert.equal(unmappedCapture.status, 201);
  assert.equal(unmappedCapture.body.mapping.status, "UNMAPPED");
  assert.equal(unmappedCapture.body.mapping.mapped, false);

  const rejectedUnmappedOrder = await request(baseUrl, "/orders", {
    method: "POST",
    token: customerToken,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { service_id: "SERVICE-001", location_id: unmappedCapture.body.location.id }
  });
  assert.equal(rejectedUnmappedOrder.status, 422);
  assert.equal(rejectedUnmappedOrder.body.mapping.status, "UNMAPPED");
  const finalData = JSON.parse(fs.readFileSync(fixture, "utf8"));
  assert.equal(finalData.OrderAttribution.length, 1);
  assert.equal(finalData.OrderAttribution[0].order_id, order.body.order.id);
  assert.equal(finalData.CommissionLedger.length, 4);
  assert.equal(finalData.WalletLedger.length, 4);
  assert.equal(new Set(finalData.WalletLedger.map(entry => entry.reference)).size, 4);
});
