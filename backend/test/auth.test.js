const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-auth-${crypto.randomUUID()}.json`);
fs.writeFileSync(fixture, JSON.stringify({ Users: [], AuthAccounts: [], AuditLogs: [] }));
process.env.ZYNGRAM_DATA_FILE = fixture;
const authService = require("../src/services/authService");
const serviceCatalog = require("../src/services/serviceCatalog");
const userService = require("../src/services/userService");

test("registration creates a hashed customer account and an authenticated session", () => {
  const result = authService.registerCustomer({
    name: "Test Customer",
    email: "customer@example.invalid",
    mobile: "+15550001234",
    password: "safe-test-password"
  });

  assert.equal(result.user.role, "CUSTOMER");
  assert.equal(authService.getSession(result.token).id, result.user.id);
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const savedAccount = data.AuthAccounts.find(account => account.email === result.user.email);
  const savedSession = data.AuthSessions.find(session => session.user_id === result.user.id);
  assert.notEqual(savedAccount.password_hash, "safe-test-password");
  assert.equal(savedAccount.role, "CUSTOMER");
  assert.ok(savedSession);
  assert.equal(savedSession.token_hash, crypto.createHash("sha256").update(result.token).digest("hex"));
  assert.equal(JSON.stringify(data.AuthSessions).includes(result.token), false);
  authService.deleteSession(result.token);
  assert.equal(JSON.parse(fs.readFileSync(fixture, "utf8")).AuthSessions.length, 0);
});

test("login is case-insensitive and rejects an incorrect password", () => {
  const result = authService.registerCustomer({
    name: "Login Test",
    email: "login@example.invalid",
    mobile: "15550001235",
    password: "safe-test-password"
  });
  authService.deleteSession(result.token);

  const login = authService.login("LOGIN@example.invalid", "safe-test-password");
  assert.equal(login.user.id, result.user.id);
  assert.throws(
    () => authService.login("login@example.invalid", "incorrect-password"),
    { message: "Invalid email or password" }
  );
  authService.deleteSession(login.token);
});

test("registration rejects duplicate email addresses regardless of casing", () => {
  authService.registerCustomer({
    name: "Duplicate Test",
    email: "duplicate@example.invalid",
    mobile: "15550001236",
    password: "safe-test-password"
  });
  assert.throws(
    () => authService.registerCustomer({
      name: "Duplicate Test",
      email: "DUPLICATE@example.invalid",
      mobile: "15550001237",
      password: "safe-test-password"
    }),
    { message: "An account with this email already exists" }
  );
});

test("one-time admin password reset changes the hash and revokes existing sessions", () => {
  const previousEnvironment = {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    resetOnBoot: process.env.ADMIN_PASSWORD_RESET_ON_BOOT
  };
  try {
    process.env.ADMIN_EMAIL = "reset-admin@example.invalid";
    process.env.ADMIN_PASSWORD = "previous-safe-password";
    delete process.env.ADMIN_PASSWORD_RESET_ON_BOOT;
    authService.ensureStorage();

    const previousSession = authService.login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    process.env.ADMIN_PASSWORD = "replacement-safe-password";
    process.env.ADMIN_PASSWORD_RESET_ON_BOOT = "true";
    authService.ensureStorage();

    assert.equal(authService.getSession(previousSession.token), undefined);
    assert.throws(
      () => authService.login(process.env.ADMIN_EMAIL, "previous-safe-password"),
      { message: "Invalid email or password" }
    );
    const currentSession = authService.login(process.env.ADMIN_EMAIL, "replacement-safe-password");
    assert.equal(currentSession.user.role, "ADMIN");
    assert.equal(process.env.ADMIN_PASSWORD_RESET_ON_BOOT, undefined);
    authService.deleteSession(currentSession.token);
  } finally {
    if (previousEnvironment.adminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previousEnvironment.adminEmail;
    if (previousEnvironment.adminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousEnvironment.adminPassword;
    if (previousEnvironment.resetOnBoot === undefined) delete process.env.ADMIN_PASSWORD_RESET_ON_BOOT;
    else process.env.ADMIN_PASSWORD_RESET_ON_BOOT = previousEnvironment.resetOnBoot;
  }
});

test("registration links an existing customer profile when its mobile also matches", () => {
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  data.Users.push({
    id: "USR-LEGACY",
    name: "Legacy Name",
    mobile: "630282624\\7",
    email: "legacy@example.invalid",
    status: "ACTIVE"
  });
  fs.writeFileSync(fixture, JSON.stringify(data));

  const result = authService.registerCustomer({
    name: "Customer Name",
    email: "legacy@example.invalid",
    mobile: "+91 6302826247",
    password: "safe-test-password"
  });

  assert.equal(result.user.id, "USR-LEGACY");
  assert.equal(JSON.parse(fs.readFileSync(fixture, "utf8")).Users.length, 4);
});

test("only the administrator can create privileged staff accounts", () => {
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const admin = data.AuthAccounts.find(account => account.role === "ADMIN");
  assert.ok(admin);
  const staff = authService.createAdminAccount({
    name: "HQ Test",
    email: "hq@example.invalid",
    mobile: "15550001238",
    password: "safe-test-password",
    role: "HQ"
  }, { id: admin.user_id });
  assert.equal(staff.role, "HQ");
  assert.throws(
    () => authService.createAdminAccount({ role: "CUSTOMER" }, { id: admin.user_id }),
    { message: "Choose a valid staff role" }
  );
});

test("regional staff accounts require an active matching franchise and own it", () => {
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  data.Franchises = [
    { id: "CMD-TEST", level: "Command", status: "ACTIVE", owner_id: "OWNER-1", parent_id: null },
    { id: "HUB-TEST", level: "Hub", status: "ACTIVE", owner_id: "OWNER-2", parent_id: "CMD-TEST" }
  ];
  fs.writeFileSync(fixture, JSON.stringify(data));
  const admin = data.AuthAccounts.find(account => account.role === "ADMIN");
  assert.throws(
    () => authService.createAdminAccount({
      name: "Scoped Hub",
      email: "scoped-hub@example.invalid",
      mobile: "15550001239",
      password: "safe-test-password",
      role: "HUB"
    }, { id: admin.user_id }),
    { message: "Select an active Hub franchise for this staff role" }
  );
  authService.createAdminAccount({
    name: "Scoped Hub",
    email: "scoped-hub@example.invalid",
    mobile: "15550001239",
    password: "safe-test-password",
    role: "HUB",
    franchise_id: "HUB-TEST"
  }, { id: admin.user_id });
  const session = authService.login("scoped-hub@example.invalid", "safe-test-password");
  assert.equal(session.user.franchise_id, "HUB-TEST");
  const saved = JSON.parse(fs.readFileSync(fixture, "utf8"));
  assert.equal(saved.Franchises.find(item => item.id === "HUB-TEST").owner_id, session.user.id);
  authService.deleteSession(session.token);
});

test("customer profile updates synchronize identity and disable inactive logins", () => {
  const registration = authService.registerCustomer({
    name: "Profile Test",
    email: "profile@example.invalid",
    mobile: "15550001240",
    password: "safe-test-password"
  });
  const updated = userService.updateUser(registration.user.id, {
    name: "Updated Profile",
    email: "updated-profile@example.invalid"
  });
  assert.equal(updated.name, "Updated Profile");
  assert.equal(authService.getSession(registration.token).name, "Updated Profile");
  assert.equal(authService.getSession(registration.token).email, "updated-profile@example.invalid");
  userService.updateUser(registration.user.id, { status: "INACTIVE" });
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const account = data.AuthAccounts.find(item => item.user_id === registration.user.id);
  assert.equal(account.email, "updated-profile@example.invalid");
  assert.equal(account.status, "INACTIVE");
  assert.equal(authService.getSession(registration.token), undefined);
});

test("customer service catalog uses backend-configured test prices", () => {
  const services = serviceCatalog.listServices();
  assert.ok(services.length > 0);
  assert.equal(serviceCatalog.getService("SERVICE-001").demoPrice, 1000);
  assert.equal(services.find(service => service.id === "SERVICE-001").price_type, "DEMO_CONFIGURATION");
  assert.equal(serviceCatalog.getService("UNKNOWN-SERVICE"), null);
});

test.after(() => {
  if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
  delete process.env.ZYNGRAM_DATA_FILE;
});
