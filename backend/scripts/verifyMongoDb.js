require("dotenv").config();

const { spawnSync } = require("child_process");
const { MongoClient } = require("mongodb");
const { getMongoProjections } = require("../src/services/mongoProjections");

const databaseName = process.env.MONGODB_DB || "zyngram_day10";
const requiredCollections = [
  "Users", "AuthAccounts", "AuthSessions", "UserLocations", "Franchises", "GeoBoundaries",
  "GeoMappingCorrections", "Orders", "OrderAttribution", "CommissionRules",
  "CommissionLedger", "WalletLedger", "Employees", "Departments", "Designations",
  "WorkLocations", "EmployeeFranchiseMapping", "Attendance", "LeaveRequests",
  "Targets", "PerformanceRecords", "EmployeeDocuments", "Notifications", "AuditLogs", "Services"
];

async function verifySessionAfterRestart() {
  const store = require("../src/services/dataStore");
  const auth = require("../src/services/authService");
  await store.initialize();
  const adminAccount = store.readData().AuthAccounts.find(account => account.role === "ADMIN");
  if (!adminAccount) throw new Error("MongoDB store has no ADMIN account to verify sessions");
  const session = auth.createSession(adminAccount);
  await store.flush();
  await store.close();

  const child = spawnSync(process.execPath, [__filename, "--verify-session-child"], {
    encoding: "utf8",
    env: { ...process.env, ZYNGRAM_MONGO_TEST_TOKEN: session.token }
  });
  if (child.status !== 0) {
    throw new Error(`Session restart check failed: ${child.stderr || child.stdout}`);
  }
  process.stdout.write(child.stdout);
}

async function verifySessionChild() {
  const store = require("../src/services/dataStore");
  const auth = require("../src/services/authService");
  await store.initialize();
  const session = auth.getSession(process.env.ZYNGRAM_MONGO_TEST_TOKEN || "");
  if (!session) throw new Error("Session was not restored from MongoDB in a new process");
  console.log(`Session persisted across process restart for role ${session.role}`);
  auth.deleteSession(process.env.ZYNGRAM_MONGO_TEST_TOKEN);
  await store.flush();
  await store.close();
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Set MONGODB_URI in the environment; do not pass credentials as command-line arguments");
  }
  if (process.argv.includes("--verify-session-child")) {
    await verifySessionChild();
    return;
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS || 10000)
  });
  try {
    await client.connect();
    const database = client.db(databaseName);
    const state = await database.collection("application_state").findOne({ _id: "main" });
    if (!state?.data) throw new Error("MongoDB is missing the imported application_state/main document");

    const counts = {};
    const expectedCollections = { ...state.data, ...getMongoProjections(state.data) };
    for (const name of [...requiredCollections, "Customers", "FranchiseOwners"]) {
      const collectionName = `zyngram_${name}`;
      const collection = database.collection(collectionName);
      counts[name] = await collection.countDocuments();
      if (counts[name] !== (expectedCollections[name] || []).length) {
        throw new Error(`${collectionName} has ${counts[name]} records, expected ${(expectedCollections[name] || []).length}`);
      }
    }
    const migrations = await database.collection("migrations").findOne({ name: "import-day10-json-v1" });
    if (!migrations) throw new Error("MongoDB import receipt is missing");
    console.log(JSON.stringify({
      database: databaseName,
      revision: state.revision,
      importedAt: migrations.imported_at,
      normalizedCollectionsVerified: Object.keys(counts).length,
      recordCounts: counts
    }, null, 2));
  } finally {
    await client.close();
  }
  await verifySessionAfterRestart();
}

main().catch(error => {
  console.error("MongoDB verification failed:", error.message);
  process.exitCode = 1;
});
