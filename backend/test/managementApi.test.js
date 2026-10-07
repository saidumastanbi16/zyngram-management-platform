const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-management-${crypto.randomUUID()}.json`);
const previousEnvironment = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "management-admin@example.invalid";
process.env.ADMIN_PASSWORD = "safe-test-password";
fs.writeFileSync(fixture, JSON.stringify({
  Users: [{
    id: "STAFF-MANAGEMENT",
    name: "Existing Staff",
    email: "staff@example.invalid",
    mobile: "15550001000",
    role: "HQ",
    status: "ACTIVE"
  }],
  AuthAccounts: [],
  AuditLogs: [],
  UserLocations: [],
  Franchises: [],
  GeoBoundaries: [],
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

test("customer and franchise management returns customer-only data and enforces editor roles", async t => {
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

  const customer = await request(baseUrl, "/users", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Management Customer",
      email: "management-customer@example.invalid",
      mobile: "15550001001"
    }
  });
  assert.equal(customer.status, 201);
  const customerId = customer.body.user.id;

  const invalidCustomer = await request(baseUrl, "/users", {
    method: "POST",
    token: adminToken,
    body: { name: "X", email: "invalid", mobile: "not-a-number" }
  });
  assert.equal(invalidCustomer.status, 400);

  const adminList = await request(baseUrl, "/users", { token: adminToken });
  assert.equal(adminList.status, 200);
  assert.deepEqual(adminList.body.users.map(user => user.id), [customerId]);
  const adminDetails = await request(baseUrl, `/users/${customerId}`, { token: adminToken });
  assert.equal(adminDetails.status, 200);
  assert.equal(adminDetails.body.user.email, "management-customer@example.invalid");

  const hqCreated = await request(baseUrl, "/auth/admins", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Management HQ",
      email: "management-hq@example.invalid",
      mobile: "15550001002",
      password: "safe-test-password",
      role: "HQ"
    }
  });
  assert.equal(hqCreated.status, 201);
  const hqLogin = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: "management-hq@example.invalid", password: "safe-test-password" }
  });
  assert.equal(hqLogin.status, 200);
  const hqToken = hqLogin.body.token;

  const hqList = await request(baseUrl, "/users", { token: hqToken });
  assert.equal(hqList.status, 200);
  assert.deepEqual(hqList.body.users.map(user => user.id), [customerId]);
  const hqDetails = await request(baseUrl, `/users/${customerId}`, { token: hqToken });
  assert.equal(hqDetails.status, 200);
  const hiddenStaffDetails = await request(baseUrl, "/users/STAFF-MANAGEMENT", { token: hqToken });
  assert.equal(hiddenStaffDetails.status, 404);

  const updatedCustomer = await request(baseUrl, `/users/${customerId}`, {
    method: "PATCH",
    token: adminToken,
    body: { name: "Updated Management Customer", status: "INACTIVE" }
  });
  assert.equal(updatedCustomer.status, 200);
  assert.equal(updatedCustomer.body.user.name, "Updated Management Customer");
  assert.equal(updatedCustomer.body.user.status, "INACTIVE");
  const restoreCustomer = await request(baseUrl, `/users/${customerId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "ACTIVE" }
  });
  assert.equal(restoreCustomer.status, 200);

  const hqCannotCreateCustomer = await request(baseUrl, "/users", {
    method: "POST",
    token: hqToken,
    body: { name: "Blocked Customer", email: "blocked@example.invalid", mobile: "15550001003" }
  });
  assert.equal(hqCannotCreateCustomer.status, 403);
  const hqCannotEditCustomer = await request(baseUrl, `/users/${customerId}`, {
    method: "PATCH",
    token: hqToken,
    body: { name: "Blocked Edit" }
  });
  assert.equal(hqCannotEditCustomer.status, 403);
  const registeredCustomer = await request(baseUrl, "/auth/register", {
    method: "POST",
    body: {
      name: "Self Service Customer",
      email: "self-service@example.invalid",
      mobile: "15550001004",
      password: "safe-test-password"
    }
  });
  assert.equal(registeredCustomer.status, 201);
  const customerToken = registeredCustomer.body.token;
  const customerCannotList = await request(baseUrl, "/users", { token: customerToken });
  assert.equal(customerCannotList.status, 403);
  const customerOwnProfile = await request(baseUrl, `/users/${registeredCustomer.body.user.id}`, { token: customerToken });
  assert.equal(customerOwnProfile.status, 200);
  const customerCannotEditProfile = await request(baseUrl, `/users/${registeredCustomer.body.user.id}`, {
    method: "PATCH",
    token: customerToken,
    body: { name: "Self Edited" }
  });
  assert.equal(customerCannotEditProfile.status, 403);

  const franchise = await request(baseUrl, "/franchises", {
    method: "POST",
    token: hqToken,
    body: { level: "Command", name: "Managed Command", owner_id: "OWNER-MANAGED" }
  });
  assert.equal(franchise.status, 201);
  const franchiseId = franchise.body.franchise.id;
  const updatedFranchise = await request(baseUrl, `/franchises/${franchiseId}`, {
    method: "PATCH",
    token: hqToken,
    body: { name: "Updated Managed Command", owner_id: "OWNER-UPDATED" }
  });
  assert.equal(updatedFranchise.status, 200);
  assert.equal(updatedFranchise.body.franchise.name, "Updated Managed Command");
  assert.equal(updatedFranchise.body.franchise.owner_id, "OWNER-UPDATED");

  const customerCannotCreateFranchise = await request(baseUrl, "/franchises", {
    method: "POST",
    token: customerToken,
    body: { level: "Nation", name: "Blocked Nation", owner_id: "OWNER-BLOCKED" }
  });
  assert.equal(customerCannotCreateFranchise.status, 403);
  const auditActions = JSON.parse(fs.readFileSync(fixture, "utf8")).AuditLogs.map(entry => entry.action);
  assert.ok(auditActions.includes("CUSTOMER_UPDATED"));
  assert.ok(auditActions.includes("FRANCHISE_CREATED"));
  assert.ok(auditActions.includes("FRANCHISE_UPDATED"));
});
