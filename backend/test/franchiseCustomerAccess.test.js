const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-franchise-customers-${crypto.randomUUID()}.json`);
const previousEnvironment = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
const firstPolygon = [[83.2, 17.7], [83.24, 17.7], [83.24, 17.67], [83.2, 17.67], [83.2, 17.7]];
const secondPolygon = [[83.3, 17.7], [83.34, 17.7], [83.34, 17.67], [83.3, 17.67], [83.3, 17.7]];
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "franchise-customer-admin@example.invalid";
process.env.ADMIN_PASSWORD = "safe-test-password";
fs.writeFileSync(fixture, JSON.stringify({
  Users: [
    { id: "CUSTOMER-IN-SCOPE", name: "Mapped Customer", email: "mapped@example.invalid", role: "CUSTOMER", status: "ACTIVE" },
    { id: "CUSTOMER-OUT-OF-SCOPE", name: "Other Customer", email: "other@example.invalid", role: "CUSTOMER", status: "ACTIVE" }
  ],
  AuthAccounts: [],
  AuthSessions: [],
  AuditLogs: [],
  Franchises: [
    { id: "COMMAND-ONE", level: "Command", name: "Command One", owner_id: "COMMAND-OWNER-ONE", status: "ACTIVE" },
    { id: "HUB-ONE", level: "Hub", name: "Hub One", owner_id: "HUB-OWNER-ONE", parent_id: "COMMAND-ONE", status: "ACTIVE" },
    { id: "CENTER-ONE", level: "Center", name: "Center One", owner_id: "CENTER-OWNER-ONE", parent_id: "HUB-ONE", status: "ACTIVE" },
    { id: "POINT-ONE", level: "Point", name: "Point One", owner_id: "POINT-OWNER-ONE", parent_id: "CENTER-ONE", status: "ACTIVE" },
    { id: "COMMAND-TWO", level: "Command", name: "Command Two", owner_id: "COMMAND-OWNER-TWO", status: "ACTIVE" },
    { id: "HUB-TWO", level: "Hub", name: "Hub Two", owner_id: "HUB-OWNER-TWO", parent_id: "COMMAND-TWO", status: "ACTIVE" },
    { id: "CENTER-TWO", level: "Center", name: "Center Two", owner_id: "CENTER-OWNER-TWO", parent_id: "HUB-TWO", status: "ACTIVE" },
    { id: "POINT-TWO", level: "Point", name: "Point Two", owner_id: "POINT-OWNER-TWO", parent_id: "CENTER-TWO", status: "ACTIVE" }
  ],
  GeoBoundaries: [
    { id: "BOUNDARY-ONE", franchise_id: "POINT-ONE", geometry: { type: "Polygon", coordinates: [firstPolygon] }, status: "ACTIVE" },
    { id: "BOUNDARY-TWO", franchise_id: "POINT-TWO", geometry: { type: "Polygon", coordinates: [secondPolygon] }, status: "ACTIVE" }
  ],
  UserLocations: [
    { id: "LOCATION-IN-SCOPE", user_id: "CUSTOMER-IN-SCOPE", lat: 17.6868, lon: 83.2185 },
    { id: "LOCATION-OUT-OF-SCOPE", user_id: "CUSTOMER-OUT-OF-SCOPE", lat: 17.6868, lon: 83.3185 }
  ],
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

test("franchise owners can list and view only customers mapped into their branch", async t => {
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
  const createdOwner = await request(baseUrl, "/auth/admins", {
    method: "POST",
    token: adminLogin.body.token,
    body: {
      name: "Center Owner",
      email: "center-owner@example.invalid",
      mobile: "15550001010",
      password: "safe-test-password",
      role: "CENTER",
      franchise_id: "CENTER-ONE"
    }
  });
  assert.equal(createdOwner.status, 201);

  const fixtureData = JSON.parse(fs.readFileSync(fixture, "utf8"));
  fixtureData.CommissionLedger.push(
    { id: "COMMISSION-CENTER", owner_id: createdOwner.body.user.id, level: "Center", amount: 20 },
    { id: "COMMISSION-POINT", owner_id: "POINT-OWNER-ONE", level: "Point", amount: 30 },
    { id: "COMMISSION-OUT-OF-SCOPE", owner_id: "POINT-OWNER-TWO", level: "Point", amount: 90 }
  );
  fs.writeFileSync(fixture, JSON.stringify(fixtureData));

  const ownerLogin = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: "center-owner@example.invalid", password: "safe-test-password" }
  });
  assert.equal(ownerLogin.status, 200);
  const ownerToken = ownerLogin.body.token;

  const ownerList = await request(baseUrl, "/users", { token: ownerToken });
  assert.equal(ownerList.status, 200);
  assert.deepEqual(ownerList.body.users.map(customer => customer.id), ["CUSTOMER-IN-SCOPE"]);

  const ownerDetails = await request(baseUrl, "/users/CUSTOMER-IN-SCOPE", { token: ownerToken });
  assert.equal(ownerDetails.status, 200);
  assert.equal(ownerDetails.body.user.id, "CUSTOMER-IN-SCOPE");

  const hiddenDetails = await request(baseUrl, "/users/CUSTOMER-OUT-OF-SCOPE", { token: ownerToken });
  assert.equal(hiddenDetails.status, 404);

  const ownerCommissions = await request(baseUrl, `/commissions/${createdOwner.body.user.id}`, { token: ownerToken });
  assert.equal(ownerCommissions.status, 200);
  assert.deepEqual(
    ownerCommissions.body.commissions.map(commission => commission.id).sort(),
    ["COMMISSION-CENTER", "COMMISSION-POINT"]
  );

  const adminList = await request(baseUrl, "/users", { token: adminLogin.body.token });
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.count, 2);

  const ownerLogout = await request(baseUrl, "/auth/logout", {
    method: "POST",
    token: ownerToken,
    body: {}
  });
  assert.equal(ownerLogout.status, 200);
});
