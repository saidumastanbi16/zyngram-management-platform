const fs = require("fs");
const path = require("path");
const store = require("./dataStore");
const crypto = require("crypto");
const geoMappingService = require("./geoMappingService");
const { mappingInUserScope } = require("../utils/franchiseScope");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

function readData() {
  return store.readData();
}

function writeData(data) {
  store.writeData(data);
}

function getUsers(user) {
  const data = readData();
  const customers = (data.Users || []).filter(customer => !customer.role || customer.role === "CUSTOMER");
  if (!user || ["ADMIN", "HQ"].includes(user.role)) return customers;
  if (!["COMMAND", "HUB", "CENTER"].includes(user.role)) return [];

  const visibleCustomerIds = new Set((data.UserLocations || [])
    .filter(location => {
      const mapping = geoMappingService.findFranchiseHierarchy(location.lat, location.lon, location.id);
      return mappingInUserScope(mapping, user);
    })
    .map(location => location.user_id));
  return customers.filter(customer => visibleCustomerIds.has(customer.id));
}

function getUserById(id, user) {
  if (user && user.role === "CUSTOMER" && user.id === id) {
    const customer = (readData().Users || []).find(item =>
      item.id === id && (!item.role || item.role === "CUSTOMER")
    );
    if (customer) return customer;
  }
  return getUsers(user).find(customer => customer.id === id);
}

function createUser(user) {
  const data = readData();
  const name = typeof user.name === "string" ? user.name.trim() : "";
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  const mobile = typeof user.mobile === "string" ? user.mobile.trim() : "";
  if (name.length < 2 || name.length > 100) throw new Error("Name must be between 2 and 100 characters");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address");
  if (!/^[+]?[\d\s()-]{7,20}$/.test(mobile)) throw new Error("Enter a valid mobile number");
  if ((data.Users || []).some(existing => String(existing.email || "").toLowerCase() === email)) {
    throw new Error("A customer with this email already exists");
  }
  if ((data.AuthAccounts || []).some(account => String(account.email || "").toLowerCase() === email)) {
    throw new Error("An account with this email already exists");
  }

  const newUser = {
    id: `USR-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    name,
    mobile,
    email,
    role: "CUSTOMER",
    status: "ACTIVE",
    created_at: new Date().toISOString()
  };

  data.Users = data.Users || [];
  data.Users.push(newUser);

  writeData(data);

  return newUser;
}

function updateUser(id, changes) {
  const data = readData();
  const user = (data.Users || []).find(item => item.id === id && (!item.role || item.role === "CUSTOMER"));
  if (!user) return null;
  if (changes.name !== undefined) {
    if (typeof changes.name !== "string" || changes.name.trim().length < 2 || changes.name.trim().length > 100) {
      throw new Error("Name must be between 2 and 100 characters");
    }
    user.name = changes.name.trim();
  }
  if (changes.email !== undefined) {
    if (typeof changes.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email.trim()) || changes.email.trim().length > 254) {
      throw new Error("Enter a valid email address");
    }
    const email = changes.email.trim().toLowerCase();
    if ((data.AuthAccounts || []).some(account => account.user_id !== id && String(account.email || "").toLowerCase() === email)) {
      throw new Error("An account with this email already exists");
    }
    if ((data.Users || []).some(item => item.id !== id && String(item.email || "").toLowerCase() === email)) {
      throw new Error("A customer with this email already exists");
    }
    user.email = email;
  }
  if (changes.mobile !== undefined) {
    if (typeof changes.mobile !== "string" || !/^[+]?[\d\s()-]{7,20}$/.test(changes.mobile.trim())) {
      throw new Error("Enter a valid mobile number");
    }
    user.mobile = changes.mobile.trim();
  }
  if (changes.status !== undefined) {
    if (!["ACTIVE", "INACTIVE"].includes(changes.status)) throw new Error("Status must be ACTIVE or INACTIVE");
    user.status = changes.status;
  }
  const account = (data.AuthAccounts || []).find(item => item.user_id === id);
  if (account) {
    account.name = user.name;
    account.email = user.email.toLowerCase();
    account.status = user.status || "ACTIVE";
  }
  writeData(data);
  return user;
}

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser
};