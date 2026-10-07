const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-order-api-${crypto.randomUUID()}.json`);
const previousEnvironment = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "workflow-admin@example.invalid";
process.env.ADMIN_PASSWORD = "safe-test-password";
fs.writeFileSync(fixture, JSON.stringify({
  Users: [],
  AuthAccounts: [],
  AuditLogs: [],
  UserLocations: [],
  Franchises: [],
  GeoBoundaries: [],
  GeoMappingCorrections: [],
  Orders: [],
  OrderAttribution: [],
  CommissionRules: [],
  CommissionLedger: [],
  WalletLedger: []
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

test("order confirmation snapshots backend attribution and applicable commission rules exactly once", async t => {
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
  const readiness = await request(baseUrl, "/ready");
  assert.equal(readiness.status, 200);
  assert.equal(readiness.body.ready, true);
  const command = franchiseService.createFranchise({ level: "Command", name: "Workflow Command", owner_id: "OWNER-CMD" });
  const hub = franchiseService.createFranchise({ level: "Hub", name: "Workflow Hub", owner_id: "OWNER-HUB", parent_id: command.id });
  const center = franchiseService.createFranchise({ level: "Center", name: "Workflow Center", owner_id: "OWNER-CENTER", parent_id: hub.id });
  const point = franchiseService.createFranchise({ level: "Point", name: "Workflow Point", owner_id: "OWNER-POINT", parent_id: center.id });
  const ring = [[83.2, 17.7], [83.24, 17.7], [83.24, 17.67], [83.2, 17.67], [83.2, 17.7]];
  geoBoundaryService.createGeoBoundary({
    franchise_id: point.id,
    version: "mapping-v1",
    geometry: { type: "Polygon", coordinates: [ring] }
  });

  const adminLogin = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.body.token;
  const customerRegistration = await request(baseUrl, "/auth/register", {
    method: "POST",
    body: {
      name: "Workflow Customer",
      email: "workflow-customer@example.invalid",
      mobile: "15550001012",
      password: "safe-test-password"
    }
  });
  assert.equal(customerRegistration.status, 201);
  const customer = customerRegistration.body.user;
  const customerToken = customerRegistration.body.token;

  const locationResponse = await request(baseUrl, "/locations/capture", {
    method: "POST",
    token: customerToken,
    body: { lat: 17.6868, lon: 83.2185, accuracy: 12, source: "browser" }
  });
  assert.equal(locationResponse.status, 201);
  const location = locationResponse.body.location;
  const invalidService = await request(baseUrl, "/orders", {
    method: "POST",
    token: adminToken,
    body: { customer_id: customer.id, service_id: "UNKNOWN-SERVICE", location_id: location.id }
  });
  assert.equal(invalidService.status, 400);
  const unknownCustomer = await request(baseUrl, "/orders", {
    method: "POST",
    token: adminToken,
    body: { customer_id: "UNKNOWN-CUSTOMER", service_id: "SERVICE-001", location_id: location.id }
  });
  assert.equal(unknownCustomer.status, 404);
  const unknownOrder = await request(baseUrl, "/orders/UNKNOWN-ORDER/confirm", {
    method: "POST",
    token: adminToken
  });
  assert.equal(unknownOrder.status, 404);

  const lowAccuracyLocation = await request(baseUrl, "/locations/capture", {
    method: "POST",
    token: customerToken,
    body: { lat: 17.6868, lon: 83.2185, accuracy: 150, source: "browser" }
  });
  assert.equal(lowAccuracyLocation.status, 201);
  const lowAccuracyOrder = await request(baseUrl, "/orders", {
    method: "POST",
    token: customerToken,
    body: { service_id: "SERVICE-001", location_id: lowAccuracyLocation.body.location.id }
  });
  assert.equal(lowAccuracyOrder.status, 422);

  const unmappedLocation = await request(baseUrl, "/locations/capture", {
    method: "POST",
    token: customerToken,
    body: { lat: 0, lon: 0, accuracy: 10, source: "browser" }
  });
  assert.equal(unmappedLocation.status, 201);
  const unmappedOrder = await request(baseUrl, "/orders", {
    method: "POST",
    token: customerToken,
    body: { service_id: "SERVICE-001", location_id: unmappedLocation.body.location.id }
  });
  assert.equal(unmappedOrder.status, 422);

  const levelsAndRates = [["Point", 10], ["Center", 5], ["Hub", 3], ["Command", 2]];
  for (const [level, rate] of levelsAndRates) {
    commissionService.createRule({
      service_id: "SERVICE-001",
      level,
      rate,
      type: "percentage",
      effective_from: "2026-01-01T00:00:00.000Z",
      version: "workflow-v1",
      status: "ACTIVE"
    });
  }

  const created = await request(baseUrl, "/orders", {
    method: "POST",
    token: adminToken,
    body: {
      customer_id: customer.id,
      service_id: "SERVICE-001",
      location_id: location.id,
      amount: 0.01
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.order.amount, 1000);
  assert.equal(created.body.order.status, "CREATED");
  assert.equal(JSON.parse(fs.readFileSync(fixture, "utf8")).OrderAttribution.length, 0);
  const orderId = created.body.order.id;

  const confirmed = await request(baseUrl, `/orders/${orderId}/confirm`, { method: "POST", token: adminToken });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.order.status, "CONFIRMED");
  const originalAttribution = confirmed.body.attribution;
  assert.equal(originalAttribution.point_id, point.id);
  assert.equal(originalAttribution.center_id, center.id);
  assert.equal(originalAttribution.hub_id, hub.id);
  assert.equal(originalAttribution.command_id, command.id);
  assert.equal(originalAttribution.mapping_version, "mapping-v1");
  assert.equal(originalAttribution.coordinates.lat, location.lat);
  assert.equal(originalAttribution.coordinates.lon, location.lon);
  assert.equal(originalAttribution.coordinates.accuracy, 12);
  assert.equal(originalAttribution.coordinates.source, "browser");
  assert.ok(Number.isFinite(Date.parse(originalAttribution.attributed_at)));
  assert.equal(originalAttribution.commission_rules.length, 4);
  assert.deepEqual(confirmed.body.commissions.map(entry => entry.amount), [100, 50, 30, 20]);

  const customerCannotConfirm = await request(baseUrl, `/orders/${orderId}/confirm`, {
    method: "POST",
    token: customerToken
  });
  assert.equal(customerCannotConfirm.status, 403);
  const customerCannotCreateCommissionRule = await request(baseUrl, "/commissions/rules", {
    method: "POST",
    token: customerToken,
    body: {
      service_id: "SERVICE-001",
      level: "Point",
      rate: 1,
      type: "percentage",
      effective_from: "2026-01-01T00:00:00.000Z",
      version: "blocked-v1"
    }
  });
  assert.equal(customerCannotCreateCommissionRule.status, 403);

  geoBoundaryService.createGeoBoundary({
    franchise_id: point.id,
    version: "mapping-v2",
    geometry: { type: "Polygon", coordinates: [ring] }
  });
  for (const [level] of levelsAndRates) {
    commissionService.createRule({
      service_id: "SERVICE-001",
      level,
      rate: 99,
      type: "percentage",
      effective_from: "2026-01-01T00:00:00.000Z",
      version: "workflow-v2",
      status: "ACTIVE"
    });
  }

  const repeated = await request(baseUrl, `/orders/${orderId}/confirm`, { method: "POST", token: adminToken });
  assert.equal(repeated.status, 200);
  assert.match(repeated.body.message, /already confirmed/);
  assert.deepEqual(repeated.body.attribution, originalAttribution);
  assert.deepEqual(repeated.body.commissions.map(entry => entry.amount), [100, 50, 30, 20]);
  const finalData = JSON.parse(fs.readFileSync(fixture, "utf8"));
  assert.equal(finalData.OrderAttribution.length, 1);
  assert.equal(finalData.CommissionLedger.length, 4);
  assert.equal(finalData.OrderAttribution[0].mapping_version, "mapping-v1");
  assert.deepEqual(finalData.CommissionLedger.map(entry => entry.rule_version), ["workflow-v1", "workflow-v1", "workflow-v1", "workflow-v1"]);
  assert.equal(finalData.AuditLogs.filter(log => log.action === "ORDER_CREATED").length, 1);
  assert.equal(finalData.AuditLogs.filter(log => log.action === "ORDER_CONFIRMED").length, 2);
  assert.ok(finalData.AuditLogs.some(log => log.action === "AUTHORIZATION_DENIED" && log.result === "DENIED"));

  const serviceList = await request(baseUrl, "/services", { token: adminToken });
  const rechargeService = serviceList.body.services.find(service => service.id === "SERVICE-MOBILE-RECHARGE");
  assert.equal(rechargeService.pricing_type, "CUSTOMER_AMOUNT");
  assert.equal(rechargeService.min_amount, 10);
  assert.equal(rechargeService.max_amount, 10000);

  const invalidRecharge = await request(baseUrl, "/orders", {
    method: "POST",
    token: customerToken,
    body: {
      service_id: rechargeService.id,
      location_id: location.id,
      mobile_number: "123",
      operator: "UNCONFIGURED",
      circle: "Unknown",
      amount: 100
    }
  });
  assert.equal(invalidRecharge.status, 400);

  for (const [level, rate] of levelsAndRates) {
    commissionService.createRule({
      service_id: rechargeService.id,
      level,
      rate,
      type: "percentage",
      effective_from: "2026-01-01T00:00:00.000Z",
      version: "recharge-v1",
      status: "ACTIVE"
    });
  }
  const rechargeBody = {
    service_id: rechargeService.id,
    location_id: location.id,
    mobile_number: "9876543210",
    operator: "JIO",
    circle: "Andhra Pradesh",
    amount: 199
  };
  const idempotencyKey = crypto.randomUUID();
  const recharge = await request(baseUrl, "/orders", {
    method: "POST",
    token: customerToken,
    body: rechargeBody,
    headers: { "Idempotency-Key": idempotencyKey }
  });
  assert.equal(recharge.status, 201);
  assert.equal(recharge.body.order.amount, 199);
  assert.deepEqual(recharge.body.order.details, {
    mobile_number: "9876543210",
    operator_id: "JIO",
    operator_name: "Jio",
    circle: "Andhra Pradesh",
    processing_mode: "DEMO"
  });

  const duplicateRecharge = await request(baseUrl, "/orders", {
    method: "POST",
    token: customerToken,
    body: rechargeBody,
    headers: { "Idempotency-Key": idempotencyKey }
  });
  assert.equal(duplicateRecharge.status, 200);
  assert.equal(duplicateRecharge.body.duplicate, true);
  assert.equal(duplicateRecharge.body.order.id, recharge.body.order.id);

  const conflictingDuplicate = await request(baseUrl, "/orders", {
    method: "POST",
    token: customerToken,
    body: { ...rechargeBody, amount: 299 },
    headers: { "Idempotency-Key": idempotencyKey }
  });
  assert.equal(conflictingDuplicate.status, 409);

  const confirmedRecharge = await request(baseUrl, `/orders/${recharge.body.order.id}/confirm`, {
    method: "POST",
    token: adminToken
  });
  assert.equal(confirmedRecharge.status, 200);
  assert.equal(confirmedRecharge.body.order.status, "DEMO_COMPLETED");
  assert.match(confirmedRecharge.body.message, /No telecom recharge was submitted/);
  assert.equal(confirmedRecharge.body.order.demo_completed_at !== undefined, true);
  assert.deepEqual(confirmedRecharge.body.commissions.map(entry => entry.amount), [19.9, 9.95, 5.97, 3.98]);
  const rechargeRepeatedConfirmation = await request(baseUrl, `/orders/${recharge.body.order.id}/confirm`, {
    method: "POST",
    token: adminToken
  });
  assert.equal(rechargeRepeatedConfirmation.status, 200);
  assert.match(rechargeRepeatedConfirmation.body.message, /already completed/);
  const rechargedData = JSON.parse(fs.readFileSync(fixture, "utf8"));
  assert.equal(rechargedData.Orders.filter(order => order.idempotency_key === idempotencyKey).length, 1);
  assert.equal(rechargedData.CommissionLedger.length, 8);
  assert.equal(rechargedData.OrderAttribution.length, 2);
  assert.equal(rechargedData.AuditLogs.filter(log => log.action === "DEMO_ORDER_COMPLETED").length, 2);
});
