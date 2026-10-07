require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { BSON, MongoClient } = require("mongodb");
const { getMongoProjections } = require("../src/services/mongoProjections");

const sourcePath = path.resolve(
  process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../data/schema.json")
);
const databaseName = process.env.MONGODB_DB || "zyngram_day10";
const requiredCollections = [
  "Users", "AuthAccounts", "AuthSessions", "UserLocations", "Franchises", "GeoBoundaries",
  "GeoMappingCorrections", "Orders", "OrderAttribution", "CommissionRules",
  "CommissionLedger", "WalletLedger", "Employees", "Departments", "Designations",
  "WorkLocations", "EmployeeFranchiseMapping", "Attendance", "LeaveRequests",
  "Targets", "PerformanceRecords", "EmployeeDocuments", "Notifications", "AuditLogs", "Services"
];

function assertUnique(rows, keyOf, collectionName, keyName) {
  const values = rows.map(keyOf).filter(value => value !== undefined && value !== null && value !== "");
  if (new Set(values).size !== values.length) {
    throw new Error(`Source collection ${collectionName} contains duplicate ${keyName} values`);
  }
}

function assertUniqueActiveBoundaries(boundaries) {
  assertUnique(
    boundaries.filter(boundary => boundary.status === "ACTIVE"),
    boundary => boundary.franchise_id,
    "GeoBoundaries",
    "active franchise boundary"
  );
}

function assertReferences(rows, field, targetRows, targetField, collectionName) {
  const targetValues = new Set(targetRows.map(row => row[targetField]).filter(Boolean));
  const invalid = rows.find(row => row[field] && !targetValues.has(row[field]));
  if (invalid) {
    throw new Error(`Source collection ${collectionName} contains an invalid ${field} reference`);
  }
}

function loadAndValidateSource() {
  const sourceBytes = fs.readFileSync(sourcePath);
  const data = JSON.parse(sourceBytes.toString("utf8"));
  const defaultedCollections = [];
  for (const name of requiredCollections) {
    if (data[name] === undefined) {
      data[name] = [];
      defaultedCollections.push(name);
    }
  }
  data.AuthSessions = data.AuthSessions || [];
  data.Services = Array.isArray(data.Services) && data.Services.length
    ? data.Services
    : require("../src/services/serviceCatalog").getSeedServices();
  const missing = requiredCollections.filter(name => !Array.isArray(data[name]));
  if (missing.length) throw new Error(`Source schema is missing array collections: ${missing.join(", ")}`);

  const counts = {};
  for (const name of requiredCollections) {
    const rows = data[name];
    counts[name] = rows.length;
    if (rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`Source collection ${name} contains a non-object record`);
    }
    const keyField = name === "OrderAttribution"
      ? "order_id"
      : name === "CommissionRules"
        ? "rule_id"
        : name === "AuthSessions"
          ? "token_hash"
          : name === "AuthAccounts"
            ? "user_id"
          : "id";
    assertUnique(rows, row => row[keyField], name, keyField);
    if (rows.some(row => typeof row[keyField] !== "string" || !row[keyField])) {
      throw new Error(`Source collection ${name} contains a record without ${keyField}`);
    }
  }
  for (const [name, rows] of Object.entries(getMongoProjections(data))) {
    counts[name] = rows.length;
  }
  assertUnique(data.AuthAccounts, row => String(row.email || "").toLowerCase(), "AuthAccounts", "email");
  assertUnique(data.AuthAccounts, row => row.user_id, "AuthAccounts", "user_id");
  assertUnique(data.Users, row => String(row.email || "").toLowerCase(), "Users", "email");
  assertUnique(data.Employees, row => row.employee_id, "Employees", "employee_id");
  assertUnique(data.Employees, row => String(row.email || "").toLowerCase(), "Employees", "email");
  assertUnique(data.OrderAttribution, row => row.order_id, "OrderAttribution", "order_id");
  assertUnique(data.CommissionRules, row => row.rule_id, "CommissionRules", "rule_id");
  assertUnique(
    data.CommissionLedger,
    row => `${row.order_id}|${row.owner_id}|${row.level}`,
    "CommissionLedger",
    "order/owner/level"
  );
  assertUniqueActiveBoundaries(data.GeoBoundaries);
  assertUnique(data.Departments, row => row.name, "Departments", "name");
  assertUnique(data.Designations, row => `${row.department_id || ""}|${row.name}`, "Designations", "department/name");
  assertUnique(data.Attendance, row => `${row.employee_id}|${row.date}`, "Attendance", "employee/date");
  assertUnique(data.WalletLedger, row => `${row.owner_id}|${row.reference}|${row.entry}`, "WalletLedger", "owner/reference/entry");
  assertUnique(
    data.Orders.filter(row => row.idempotency_key),
    row => `${row.customer_id}|${row.idempotency_key}`,
    "Orders",
    "customer/idempotency key"
  );
  data.AuthAccounts.forEach(account => {
    if (account.role !== "ADMIN" && !data.Users.some(user => user.id === account.user_id)) {
      throw new Error(`Auth account ${account.email} has no corresponding Users record`);
    }
  });
  assertReferences(data.AuthSessions, "user_id", data.AuthAccounts, "user_id", "AuthSessions");
  assertReferences(data.UserLocations, "user_id", data.Users, "id", "UserLocations");
  assertReferences(data.Franchises, "parent_id", data.Franchises, "id", "Franchises");
  assertReferences(data.GeoBoundaries, "franchise_id", data.Franchises, "id", "GeoBoundaries");
  assertReferences(data.Orders, "customer_id", data.Users, "id", "Orders");
  assertReferences(data.Orders, "location_id", data.UserLocations, "id", "Orders");
  assertReferences(data.Orders, "service_id", data.Services, "id", "Orders");
  assertReferences(data.OrderAttribution, "order_id", data.Orders, "id", "OrderAttribution");
  for (const level of ["point_id", "center_id", "hub_id", "command_id"]) {
    assertReferences(data.OrderAttribution, level, data.Franchises, "id", "OrderAttribution");
  }
  assertReferences(data.CommissionLedger, "order_id", data.Orders, "id", "CommissionLedger");
  assertReferences(data.CommissionLedger, "rule_id", data.CommissionRules, "rule_id", "CommissionLedger");
  if (data.CommissionLedger.some(row => typeof row.owner_id !== "string" || !row.owner_id.trim())) {
    throw new Error("Source collection CommissionLedger contains a record without owner_id");
  }
  assertReferences(data.Employees, "department_id", data.Departments, "id", "Employees");
  assertReferences(data.Employees, "designation_id", data.Designations, "id", "Employees");
  assertReferences(data.Employees, "franchise_id", data.Franchises, "id", "Employees");
  assertReferences(data.EmployeeFranchiseMapping, "employee_id", data.Employees, "id", "EmployeeFranchiseMapping");
  assertReferences(data.EmployeeFranchiseMapping, "franchise_id", data.Franchises, "id", "EmployeeFranchiseMapping");
  assertReferences(data.Attendance, "employee_id", data.Employees, "id", "Attendance");
  assertReferences(data.LeaveRequests, "employee_id", data.Employees, "id", "LeaveRequests");
  assertReferences(data.Targets, "employee_id", data.Employees, "id", "Targets");
  assertReferences(data.PerformanceRecords, "employee_id", data.Employees, "id", "PerformanceRecords");
  assertReferences(data.PerformanceRecords, "target_id", data.Targets, "id", "PerformanceRecords");
  assertReferences(data.EmployeeDocuments, "employee_id", data.Employees, "id", "EmployeeDocuments");
  assertReferences(data.Notifications, "employee_id", data.Employees, "id", "Notifications");
  const document = { _id: "main", revision: 0, data, imported_at: new Date() };
  const bsonBytes = BSON.calculateObjectSize(document);
  if (bsonBytes >= 15 * 1024 * 1024) {
    throw new Error(`Source state is ${bsonBytes} BSON bytes; it must remain below the 15 MiB safety threshold`);
  }
  return {
    document,
    counts,
    bsonBytes,
    sha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
    defaultedCollections
  };
}

async function main() {
  const { document, counts, bsonBytes, sha256, defaultedCollections } = loadAndValidateSource();
  console.log(JSON.stringify({
    source: sourcePath,
    database: databaseName,
    dryRun: process.argv.includes("--dry-run"),
    bsonBytes,
    sha256,
    defaultedCollections,
    counts
  }, null, 2));
  if (process.argv.includes("--dry-run")) return;
  if (!process.env.MONGODB_URI) {
    throw new Error("Set MONGODB_URI in the environment; do not commit credentials or put them in a command-line argument");
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS || 10000)
  });
  try {
    await client.connect();
    const database = client.db(databaseName);
    const stateCollection = database.collection("application_state");
    const migrationCollection = database.collection("migrations");
    await migrationCollection.createIndex({ name: 1 }, { unique: true });

    const existing = await stateCollection.findOne({ _id: "main" });
    if (existing) {
      throw new Error(`MongoDB database already has application state at revision ${existing.revision}; import stopped without replacing it`);
    }

    await stateCollection.insertOne(document);
    try {
      const dataStore = require("../src/services/dataStore");
      await dataStore.initialize();
      await dataStore.close();
      await migrationCollection.insertOne({
        name: "import-day10-json-v1",
        source: path.basename(sourcePath),
        source_sha256: sha256,
        imported_at: new Date(),
        collection_counts: counts
      });
    } catch (error) {
      await stateCollection.deleteOne({ _id: "main", revision: 0 });
      throw error;
    }
    console.log("MongoDB import complete. Verify /api/ready before directing any traffic.");
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error("MongoDB JSON import failed:", error.message);
  process.exitCode = 1;
});
