const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-rbac-${crypto.randomUUID()}.json`);
const previousEnvironment = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "rbac-admin@example.invalid";
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
  CommissionLedger: []
}));

const app = require("../server");
const server = app.listen(0, "127.0.0.1");
const franchiseService = require("../src/services/franchiseService");

function request(baseUrl, endpoint, { method = "GET", token, body } = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async response => ({
    status: response.status,
    body: await response.json()
  }));
}

test("HQ and franchise staff can access their scope while protected staff actions enforce roles", async t => {
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

  if (!server.listening) {
    await new Promise(resolve => server.once("listening", resolve));
  }
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const command = franchiseService.createFranchise({
    level: "Command",
    name: "RBAC Command",
    owner_id: "OWNER-CMD"
  });
  const hub = franchiseService.createFranchise({
    level: "Hub",
    name: "RBAC Hub",
    owner_id: "OWNER-HUB",
    parent_id: command.id
  });
  const center = franchiseService.createFranchise({
    level: "Center",
    name: "RBAC Center",
    owner_id: "OWNER-CENTER",
    parent_id: hub.id
  });

  const unauthenticated = await request(baseUrl, "/franchises");
  assert.equal(unauthenticated.status, 401);

  const adminLogin = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.body.token;

  const createdStaff = {};
  for (const [role, franchiseId] of [
    ["HQ", undefined],
    ["COMMAND", command.id],
    ["HUB", hub.id],
    ["CENTER", center.id]
  ]) {
    const user = await request(baseUrl, "/auth/admins", {
      method: "POST",
      token: adminToken,
      body: {
        name: `RBAC ${role}`,
        email: `${role.toLowerCase()}@example.invalid`,
        mobile: "15550001000",
        password: "safe-test-password",
        role,
        ...(franchiseId ? { franchise_id: franchiseId } : {})
      }
    });
    assert.equal(user.status, 201, `ADMIN should be able to provision ${role}`);

    const login = await request(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: `${role.toLowerCase()}@example.invalid`,
        password: "safe-test-password"
      }
    });
    assert.equal(login.status, 200, `${role} should be able to authenticate`);
    assert.equal(login.body.user.role, role);
    createdStaff[role] = { token: login.body.token, id: user.body.user.id };
  }

  const expectedVisibleFranchises = { HQ: 3, COMMAND: 3, HUB: 2, CENTER: 1 };
  for (const [role, { token }] of Object.entries(createdStaff)) {
    const response = await request(baseUrl, "/franchises", { token });
    assert.equal(response.status, 200, `${role} should read its franchise scope`);
    assert.equal(response.body.count, expectedVisibleFranchises[role]);
    const dashboard = await request(baseUrl, "/dashboard", { token });
    assert.equal(dashboard.status, 200, `${role} should access the role dashboard`);
  }

  const outOfScope = await request(baseUrl, `/franchises/${command.id}`, {
    token: createdStaff.CENTER.token
  });
  assert.equal(outOfScope.status, 404);

  for (const [role, { token }] of Object.entries(createdStaff)) {
    const forbidden = await request(baseUrl, "/auth/admins", {
      method: "POST",
      token,
      body: {
        name: "Unauthorized Staff",
        email: `unauthorized-${role.toLowerCase()}@example.invalid`,
        mobile: "15550001001",
        password: "safe-test-password",
        role: "HQ"
      }
    });
    assert.equal(forbidden.status, 403, `${role} must not provision privileged staff`);
  }

  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const savedHubStatus = data.Franchises.find(item => item.id === hub.id).status;
  data.Franchises.find(item => item.id === hub.id).status = "INACTIVE";
  fs.writeFileSync(fixture, JSON.stringify(data));
  const incompleteHierarchy = await request(baseUrl, "/auth/admins", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Invalid Center",
      email: "invalid-center@example.invalid",
      mobile: "15550001003",
      password: "safe-test-password",
      role: "CENTER",
      franchise_id: center.id
    }
  });
  assert.equal(incompleteHierarchy.status, 400);
  assert.match(incompleteHierarchy.body.message, /complete active parent hierarchy/);
  data.Franchises.find(item => item.id === hub.id).status = savedHubStatus;
  fs.writeFileSync(fixture, JSON.stringify(data));

  const validAdminAction = await request(baseUrl, "/auth/admins", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Admin Provisioned HQ",
      email: "admin-provisioned-hq@example.invalid",
      mobile: "15550001002",
      password: "safe-test-password",
      role: "HQ"
    }
  });
  assert.equal(validAdminAction.status, 201);
});
