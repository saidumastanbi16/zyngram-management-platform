const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-order-access-${crypto.randomUUID()}.json`);
const order = {
  id: "ORD-SCOPED",
  customer_id: "CUSTOMER-1",
  service_id: "SERVICE-001",
  amount: 1000,
  status: "PENDING",
  location_id: "LOC-1",
  created_at: new Date().toISOString()
};
const polygon = [[83.2, 17.7], [83.24, 17.7], [83.24, 17.67], [83.2, 17.67], [83.2, 17.7]];

fs.writeFileSync(fixture, JSON.stringify({
  Users: [{ id: "CUSTOMER-1", name: "Customer One", role: "CUSTOMER", status: "ACTIVE" }],
  UserLocations: [{
    id: "LOC-1",
    user_id: "CUSTOMER-1",
    lat: 17.6868,
    lon: 83.2185,
    accuracy: 10,
    captured_at: new Date().toISOString()
  }],
  Franchises: [
    { id: "CMD-1", level: "Command", owner_id: "OWNER-CMD", parent_id: null, status: "ACTIVE" },
    { id: "HUB-1", level: "Hub", owner_id: "OWNER-HUB", parent_id: "CMD-1", status: "ACTIVE" },
    { id: "CTR-1", level: "Center", owner_id: "OWNER-CTR", parent_id: "HUB-1", status: "ACTIVE" },
    { id: "PNT-1", level: "Point", owner_id: "OWNER-PNT", parent_id: "CTR-1", status: "ACTIVE" }
  ],
  GeoBoundaries: [{
    id: "GEO-1",
    franchise_id: "PNT-1",
    geometry: { type: "Polygon", coordinates: [polygon] },
    version: "v1",
    status: "ACTIVE"
  }],
  Orders: [order],
  OrderAttribution: [],
  CommissionRules: [],
  CommissionLedger: []
}));
process.env.ZYNGRAM_DATA_FILE = fixture;
const orderController = require("../src/controllers/orderController");

function invokeGetOrder(user) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  orderController.getOrderById({ params: { id: order.id }, user }, response);
  return response;
}

test("individual order reads are limited to the customer or assigned staff hierarchy", () => {
  const inScope = invokeGetOrder({ id: "STAFF-1", role: "CENTER", franchise_id: "CTR-1" });
  assert.equal(inScope.statusCode, 200);
  assert.equal(inScope.body.order.id, order.id);

  const outOfScope = invokeGetOrder({ id: "STAFF-2", role: "CENTER", franchise_id: "CTR-OTHER" });
  assert.equal(outOfScope.statusCode, 404);

  const otherCustomer = invokeGetOrder({ id: "CUSTOMER-2", role: "CUSTOMER" });
  assert.equal(otherCustomer.statusCode, 403);
});

test.after(() => {
  if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
  delete process.env.ZYNGRAM_DATA_FILE;
});
