const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-booking-${crypto.randomUUID()}.json`);
const franchises = [
  { id: "CMD-1", level: "Command", owner_id: "OWNER-CMD", status: "ACTIVE", parent_id: null },
  { id: "HUB-1", level: "Hub", owner_id: "OWNER-HUB", status: "ACTIVE", parent_id: "CMD-1" },
  { id: "CTR-1", level: "Center", owner_id: "OWNER-CTR", status: "ACTIVE", parent_id: "HUB-1" },
  { id: "PNT-1", level: "Point", owner_id: "OWNER-PNT", status: "ACTIVE", parent_id: "CTR-1" }
];
const polygon = [[83.2, 17.7], [83.24, 17.7], [83.24, 17.67], [83.2, 17.67], [83.2, 17.7]];
const rules = [
  ["Point", 10],
  ["Center", 5],
  ["Hub", 3],
  ["Command", 2]
].map(([level, rate], index) => ({
  rule_id: `RULE-${index}`,
  service_id: "SERVICE-001",
  level,
  rate,
  type: "percentage",
  effective_from: "2026-01-01T00:00:00.000Z",
  effective_to: null,
  version: "v1",
  status: "ACTIVE"
}));
fs.writeFileSync(fixture, JSON.stringify({
  Users: [],
  AuthAccounts: [],
  AuditLogs: [],
  UserLocations: [],
  Franchises: franchises,
  GeoBoundaries: [{
    id: "GEO-1",
    franchise_id: "PNT-1",
    geometry: { type: "Polygon", coordinates: [polygon] },
    version: "v1",
    status: "ACTIVE"
  }],
  Orders: [],
  OrderAttribution: [],
  CommissionRules: rules,
  CommissionLedger: []
}));
process.env.ZYNGRAM_DATA_FILE = fixture;
const authService = require("../src/services/authService");
const locationService = require("../src/services/locationService");
const geoMappingService = require("../src/services/geoMappingService");
const serviceCatalog = require("../src/services/serviceCatalog");
const orderService = require("../src/services/orderService");
const attributionService = require("../src/services/attributionService");
const commissionService = require("../src/services/commissionService");

test("customer booking confirms against backend location, price, attribution, and idempotent commission rules", () => {
  const customer = authService.registerCustomer({
    name: "Booking Customer",
    email: "booking@example.invalid",
    mobile: "15550001241",
    password: "safe-test-password"
  });
  const location = locationService.captureLocation({
    user_id: customer.user.id,
    lat: 17.6868,
    lon: 83.2185,
    accuracy: 10
  });
  const mapping = geoMappingService.findFranchiseHierarchy(location.lat, location.lon, location.id);
  assert.equal(mapping.status, "MAPPED");

  const order = orderService.createOrder({
    customer_id: customer.user.id,
    service_id: "SERVICE-001",
    amount: serviceCatalog.getService("SERVICE-001").demoPrice,
    location_id: location.id
  });
  const attribution = attributionService.createOrderAttribution(order, mapping);
  const firstRun = commissionService.processCommission(order, attribution);
  const confirmed = orderService.confirmOrder(order.id);
  const secondRun = commissionService.processCommission(confirmed, attribution);

  assert.equal(order.amount, 1000);
  assert.equal(confirmed.status, "CONFIRMED");
  assert.deepEqual(firstRun.map(result => result.amount), [100, 50, 30, 20]);
  assert.equal(JSON.parse(fs.readFileSync(fixture, "utf8")).CommissionLedger.length, 4);
  assert.ok(secondRun.every(result => result.duplicate));
  authService.deleteSession(customer.token);
});

test.after(() => {
  if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
  delete process.env.ZYNGRAM_DATA_FILE;
});
