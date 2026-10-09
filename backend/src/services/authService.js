const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const store = require("./dataStore");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");
const sessions = new Map();
const hashLength = 64;
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;

function readData() {
  return store.readData();
}

function writeData(data) {
  store.writeData(data);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, hashLength).toString("hex");
  return { salt, hash };
}

function passwordMatches(password, account) {
  const candidate = Buffer.from(hashPassword(password, account.salt).hash, "hex");
  const saved = Buffer.from(account.password_hash, "hex");
  return candidate.length === saved.length && crypto.timingSafeEqual(candidate, saved);
}

function hasValidFranchiseAssignment(account, data) {
  const expectedLevel = {
    COMMAND: "Command",
    HUB: "Hub",
    CENTER: "Center"
  }[account.role];
  if (!expectedLevel) return true;
  let franchise = (data.Franchises || []).find(item =>
    item.id === account.franchise_id &&
    item.level === expectedLevel &&
    item.owner_id === account.user_id &&
    item.status === "ACTIVE"
  );
  if (!franchise) return false;

  const parentLevels = {
    Nation: null,
    Region: "Nation",
    Territory: "Region",
    Zone: "Territory",
    Node: "Zone",
    Command: "Node",
    Hub: "Command",
    Center: "Hub",
    Point: "Center"
  };
  const visited = new Set([franchise.id]);
  while (franchise.parent_id) {
    const expectedParentLevel = parentLevels[franchise.level];
    if (!expectedParentLevel || visited.has(franchise.parent_id)) return false;
    const parent = (data.Franchises || []).find(item =>
      item.id === franchise.parent_id &&
      item.level === expectedParentLevel &&
      item.status === "ACTIVE"
    );
    if (!parent) return false;
    visited.add(parent.id);
    franchise = parent;
  }
  return franchise.level === "Command" || franchise.level === "Nation";
}

function normalizedMobile(value) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
}

function audit(data, actorId, action, result, details = {}) {
  data.AuditLogs = data.AuditLogs || [];
  data.AuditLogs.push({
    id: `AUD-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    actor_id: actorId || "ANONYMOUS",
    role: actorId ? "USER" : "ANONYMOUS",
    action,
    entity: "Auth",
    entity_id: details.email || actorId || "unknown",
    result,
    details,
    created_at: new Date().toISOString()
  });
}

function ensureStorage() {
  if (process.env.NODE_ENV === "production") {
    const adminPassword = process.env.ADMIN_PASSWORD || "";
    if (!process.env.ADMIN_EMAIL || adminPassword.length < 12 || adminPassword === "admin123") {
      throw new Error("Production requires ADMIN_EMAIL and a non-demo ADMIN_PASSWORD of at least 12 characters");
    }
  }
  const data = readData();
  let changed = false;
  if (!data.AuthAccounts) changed = true;
  if (!data.AuthSessions) changed = true;
  if (!data.AuditLogs) changed = true;
  data.AuthAccounts = data.AuthAccounts || [];
  data.AuthSessions = data.AuthSessions || [];
  data.AuditLogs = data.AuditLogs || [];

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@zyngram.com").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminAccount = data.AuthAccounts.find(account => account.email === adminEmail);

  if (process.env.ADMIN_PASSWORD_RESET_ON_BOOT === "true") {
    if (!adminAccount || adminAccount.role !== "ADMIN") {
      throw new Error("ADMIN_PASSWORD_RESET_ON_BOOT requires an existing administrator account");
    }
    const { salt, hash } = hashPassword(adminPassword);
    adminAccount.salt = salt;
    adminAccount.password_hash = hash;
    data.AuthSessions = data.AuthSessions.filter(session => session.user_id !== adminAccount.user_id);
    audit(data, "SYSTEM", "AUTH_ADMIN_PASSWORD_RESET", "SUCCESS", { email: adminEmail });
    delete process.env.ADMIN_PASSWORD_RESET_ON_BOOT;
    changed = true;
  } else if (!adminAccount) {
    const { salt, hash } = hashPassword(adminPassword);
    data.AuthAccounts.push({
      user_id: "ADMIN-001",
      name: "Admin User",
      email: adminEmail,
      salt,
      password_hash: hash,
      role: "ADMIN",
      status: "ACTIVE",
      created_at: new Date().toISOString()
    });
    audit(data, "SYSTEM", "AUTH_ADMIN_BOOTSTRAPPED", "SUCCESS", { email: adminEmail });
    changed = true;
  }

  if (changed) writeData(data);
}

function publicUser(account) {
  return {
    id: account.user_id,
    name: account.name,
    email: account.email,
    role: account.role,
    franchise_id: account.franchise_id || null
  };
}

function createSession(account) {
  const token = crypto.randomBytes(32).toString("hex");
  const data = readData();
  const createdAt = Date.now();
  data.AuthSessions = (data.AuthSessions || []).filter(session => session.expires_at > createdAt);
  data.AuthSessions.push({
    token_hash: crypto.createHash("sha256").update(token).digest("hex"),
    user_id: account.user_id,
    created_at: createdAt,
    expires_at: createdAt + sessionDurationMs
  });
  writeData(data);
  return { token, user: publicUser(account) };
}

function registerCustomer(input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const mobile = typeof input.mobile === "string" ? input.mobile.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (name.length < 2 || name.length > 100) {
    throw new Error("Name must be between 2 and 100 characters");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid email address");
  }
  if (!/^[+]?[\d\s()-]{7,20}$/.test(mobile)) {
    throw new Error("Enter a valid mobile number");
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error("Password must be between 8 and 128 characters");
  }

  const data = readData();
  data.AuthAccounts = data.AuthAccounts || [];
  data.Users = data.Users || [];
  if (data.AuthAccounts.some(account => account.email.toLowerCase() === email)) {
    throw new Error("An account with this email already exists");
  }

  const legacyIndex = data.Users.findIndex(user => user.email.toLowerCase() === email);
  const legacyUser = legacyIndex >= 0 ? data.Users[legacyIndex] : null;
  if (legacyUser?.status === "INACTIVE") {
    throw new Error("This customer account is inactive. Contact an administrator.");
  }
  if (legacyUser && normalizedMobile(legacyUser.mobile || "") !== normalizedMobile(mobile)) {
    throw new Error("This email already has a customer profile. Contact an administrator to recover access.");
  }

  const userId = legacyUser
    ? legacyUser.id
    : `USR-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const { salt, hash } = hashPassword(password);
  const user = legacyUser
    ? { ...legacyUser, name, mobile, role: "CUSTOMER" }
    : {
        id: userId,
        name,
        mobile,
        email,
        role: "CUSTOMER",
        status: "ACTIVE",
        created_at: new Date().toISOString()
      };
  if (legacyUser) data.Users[legacyIndex] = user;
  else data.Users.push(user);
  data.AuthAccounts.push({
    user_id: userId,
    name,
    email,
    salt,
    password_hash: hash,
    role: "CUSTOMER",
    status: "ACTIVE",
    created_at: user.created_at
  });
  audit(data, userId, "CUSTOMER_REGISTERED", "SUCCESS", { email });
  writeData(data);

  const session = createSession(data.AuthAccounts[data.AuthAccounts.length - 1]);
  return { ...session, user };
}

function login(emailInput, passwordInput) {
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
  const password = typeof passwordInput === "string" ? passwordInput : "";
  const data = readData();
  const account = (data.AuthAccounts || []).find(item => item.email.toLowerCase() === email);

  if (!account || account.status !== "ACTIVE" || !passwordMatches(password, account)) {
    audit(data, null, "LOGIN", "FAILURE", { email });
    writeData(data);
    throw new Error("Invalid email or password");
  }
  if (!hasValidFranchiseAssignment(account, data)) {
    audit(data, account.user_id, "LOGIN", "FAILURE", { email, reason: "INVALID_FRANCHISE_ASSIGNMENT" });
    writeData(data);
    throw new Error("Staff account is not assigned to an active franchise");
  }

  audit(data, account.user_id, "LOGIN", "SUCCESS", { email });
  writeData(data);
  return createSession(account);
}

function createAdminAccount(input, actor) {
  const role = typeof input.role === "string" ? input.role.toUpperCase() : "";
  if (!["ADMIN", "HQ", "COMMAND", "HUB", "CENTER"].includes(role)) {
    throw new Error("Choose a valid staff role");
  }

  return registerStaff(input, role, actor.id);
}

function registerStaff(input, role, actorId) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const mobile = typeof input.mobile === "string" ? input.mobile.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (name.length < 2 || name.length > 100) throw new Error("Enter a valid name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address");
  if (!/^[+]?[\d\s()-]{7,20}$/.test(mobile)) throw new Error("Enter a valid mobile number");
  if (password.length < 8 || password.length > 128) throw new Error("Password must be between 8 and 128 characters");

  const data = readData();
  data.AuthAccounts = data.AuthAccounts || [];
  data.Users = data.Users || [];
  if (
    data.AuthAccounts.some(account => account.email.toLowerCase() === email) ||
    data.Users.some(user => user.email.toLowerCase() === email)
  ) {
    throw new Error("An account with this email already exists");
  }

  const franchiseId = typeof input.franchise_id === "string" ? input.franchise_id.trim() : "";
  const franchiseLevel = {
    COMMAND: "Command",
    HUB: "Hub",
    CENTER: "Center"
  }[role];
  let assignedFranchise = null;
  if (franchiseLevel) {
    assignedFranchise = (data.Franchises || []).find(item =>
      item.id === franchiseId && item.level === franchiseLevel && item.status === "ACTIVE"
    );
    if (!assignedFranchise) throw new Error(`Select an active ${franchiseLevel} franchise for this staff role`);
    if (!hasValidFranchiseAssignment({
      role,
      franchise_id: assignedFranchise.id,
      user_id: assignedFranchise.owner_id
    }, data)) {
      throw new Error("Staff franchise must have a complete active parent hierarchy");
    }
  } else if (franchiseId) {
    throw new Error("This staff role cannot be assigned to a franchise");
  }

  const userId = `STAFF-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const { salt, hash } = hashPassword(password);
  const createdAt = new Date().toISOString();
  if (assignedFranchise) {
    for (const existingAccount of data.AuthAccounts) {
      if (existingAccount.franchise_id === assignedFranchise.id) delete existingAccount.franchise_id;
    }
    for (const existingUser of data.Users) {
      if (existingUser.franchise_id === assignedFranchise.id) delete existingUser.franchise_id;
    }
  }
  data.Users.push({
    id: userId,
    name,
    mobile,
    email,
    role,
    ...(assignedFranchise ? { franchise_id: assignedFranchise.id } : {}),
    status: "ACTIVE",
    created_at: createdAt
  });
  data.AuthAccounts.push({
    user_id: userId,
    name,
    email,
    salt,
    password_hash: hash,
    role,
    ...(assignedFranchise ? { franchise_id: assignedFranchise.id } : {}),
    status: "ACTIVE",
    created_at: createdAt
  });
  if (assignedFranchise) assignedFranchise.owner_id = userId;
  audit(data, actorId, "STAFF_ACCOUNT_CREATED", "SUCCESS", { email, role });
  writeData(data);
  return { id: userId, name, email, role };
}

function getSession(token) {
  const data = readData();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = (data.AuthSessions || []).find(item => item.token_hash === tokenHash);
  if (!session) return undefined;
  if (session.expires_at <= Date.now()) {
    data.AuthSessions = data.AuthSessions.filter(item => item.token_hash !== tokenHash);
    writeData(data);
    return undefined;
  }
  const account = (data.AuthAccounts || []).find(item => item.user_id === session.user_id);
  if (!account || account.status !== "ACTIVE" || !hasValidFranchiseAssignment(account, data)) {
    data.AuthSessions = data.AuthSessions.filter(item => item.token_hash !== tokenHash);
    writeData(data);
    return undefined;
  }
  return { ...publicUser(account), createdAt: session.created_at };
}

function deleteSession(token) {
  const data = readData();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  data.AuthSessions = (data.AuthSessions || []).filter(item => item.token_hash !== tokenHash);
  writeData(data);
}

if (!store.mongoEnabled) ensureStorage();

module.exports = {
  createAdminAccount,
  createSession,
  deleteSession,
  ensureStorage,
  getSession,
  hashPassword,
  login,
  publicUser,
  registerCustomer
};
