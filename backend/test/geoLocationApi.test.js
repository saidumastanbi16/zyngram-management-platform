const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-geo-api-${crypto.randomUUID()}.json`);
const previousEnvironment = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
const polygon = [[83.2, 17.7], [83.24, 17.7], [83.24, 17.67], [83.2, 17.67], [83.2, 17.7]];
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "geo-admin@example.invalid";
process.env.ADMIN_PASSWORD = "safe-test-password";
fs.writeFileSync(fixture, JSON.stringify({
  Users: [{
    id: "CUSTOMER-GEO",
    name: "Geo Test Customer",
    email: "geo-customer@example.invalid",
    status: "ACTIVE"
  }],
  AuthAccounts: [],
  AuditLogs: [],
  UserLocations: [],
  Franchises: [
    { id: "CMD-GEO", level: "Command", name: "Geo Command", owner_id: "OWNER-CMD", parent_id: null, status: "ACTIVE" },
    { id: "HUB-GEO", level: "Hub", name: "Geo Hub", owner_id: "OWNER-HUB", parent_id: "CMD-GEO", status: "ACTIVE" },
    { id: "CTR-GEO", level: "Center", name: "Geo Center", owner_id: "OWNER-CTR", parent_id: "HUB-GEO", status: "ACTIVE" },
    { id: "PNT-GEO", level: "Point", name: "Geo Point", owner_id: "OWNER-PNT", parent_id: "CTR-GEO", status: "ACTIVE" }
  ],
  GeoBoundaries: [{
    id: "BOUNDARY-GEO",
    franchise_id: "PNT-GEO",
    geometry: { type: "Polygon", coordinates: [polygon] },
    version: "geo-v1",
    status: "ACTIVE"
  }],
  Orders: [],
  OrderAttribution: [],
  CommissionRules: [],
  CommissionLedger: []
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

test("location capture validates coordinates and returns mock geography and polygon mapping", async t => {
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
  const token = login.body.token;

  const resolved = await request(baseUrl, "/geo/reverse-geocode", {
    method: "POST",
    token,
    body: { lat: 17.6868, lon: 83.2185 }
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.provider, "TEST_MOCK");
  assert.equal(resolved.body.status, "MOCK_RESOLVED");
  assert.equal(resolved.body.address.city, "Visakhapatnam");

  const unresolved = await request(baseUrl, "/geo/reverse-geocode", {
    method: "POST",
    token,
    body: { lat: 12.9716, lon: 77.5946 }
  });
  assert.equal(unresolved.body.status, "UNRESOLVED");
  assert.equal(unresolved.body.address, null);

  const invalidGeocode = await request(baseUrl, "/geo/reverse-geocode", {
    method: "POST",
    token,
    body: { lat: 91, lon: 83.2185 }
  });
  assert.equal(invalidGeocode.status, 400);

  const invalidMapping = await request(baseUrl, "/geo/franchise-map?lat=17.6868&lon=181", { token });
  assert.equal(invalidMapping.status, 400);

  const mapped = await request(baseUrl, "/geo/franchise-map?lat=17.6868&lon=83.2185", { token });
  assert.equal(mapped.status, 200);
  assert.equal(mapped.body.mapping.status, "MAPPED");
  assert.equal(mapped.body.mapping.point.id, "PNT-GEO");
  assert.equal(mapped.body.mapping.center.id, "CTR-GEO");
  assert.equal(mapped.body.mapping.hub.id, "HUB-GEO");
  assert.equal(mapped.body.mapping.command.id, "CMD-GEO");
  assert.equal(mapped.body.mapping.mapping_version, "geo-v1");
  assert.deepEqual(mapped.body.mapping.boundary_geometry.coordinates, [polygon]);

  const unmapped = await request(baseUrl, "/geo/franchise-map?lat=17.6868&lon=83.3", { token });
  assert.equal(unmapped.body.mapping.status, "UNMAPPED");
  assert.equal(unmapped.body.mapping.mapped, false);

  const invalidCapture = await request(baseUrl, "/locations/capture", {
    method: "POST",
    token,
    body: {
      user_id: "CUSTOMER-GEO",
      lat: -91,
      lon: 83.2185,
      accuracy: 10,
      source: "browser"
    }
  });
  assert.equal(invalidCapture.status, 400);

  const saved = await request(baseUrl, "/locations/capture", {
    method: "POST",
    token,
    body: {
      user_id: "CUSTOMER-GEO",
      lat: 17.6868,
      lon: 83.2185,
      accuracy: 12,
      source: "browser"
    }
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.location.source, "browser");
  assert.equal(saved.body.location.accuracy, 12);
  assert.equal(saved.body.mapping.status, "MAPPED");
  assert.equal(saved.body.mapping.point.id, "PNT-GEO");
  assert.ok(Number.isFinite(Date.parse(saved.body.location.captured_at)));

  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  data.GeoBoundaries[0].geometry.coordinates.push([
    [83.215, 17.69],
    [83.221, 17.69],
    [83.221, 17.683],
    [83.215, 17.683],
    [83.215, 17.69]
  ]);
  fs.writeFileSync(fixture, JSON.stringify(data));
  const locationInsideHole = await request(baseUrl, "/geo/franchise-map?lat=17.6868&lon=83.2185", { token });
  assert.equal(locationInsideHole.body.mapping.status, "UNMAPPED");
});
