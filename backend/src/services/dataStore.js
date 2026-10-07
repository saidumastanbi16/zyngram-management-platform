const fs = require("fs");
const path = require("path");
const { getMongoProjections } = require("./mongoProjections");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");
const mongoEnabled = Boolean(process.env.MONGODB_URI && !process.env.ZYNGRAM_DATA_FILE);
const maxMongoStateBytes = 15 * 1024 * 1024;
let mongoClient = null;
let mongoCollection = null;
let dataCache = null;
let persistedData = null;
let revision = 0;
let writeQueue = Promise.resolve();
let persistenceError = null;
let transactionsSupported = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function recordKey(name, record) {
  const field = name === "OrderAttribution"
    ? "order_id"
    : name === "CommissionRules"
      ? "rule_id"
      : name === "AuthSessions"
        ? "token_hash"
        : name === "AuthAccounts"
          ? "user_id"
        : "id";
  const key = record[field];
  if (typeof key !== "string" || !key) {
    throw new Error(`MongoDB collection ${name} contains a record without ${field}`);
  }
  return key;
}

function indexDefinitions(name) {
  const definitions = {
    Users: [[{ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } }],
      [{ status: 1, role: 1 }, {}]],
    Customers: [[{ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } }],
      [{ status: 1, created_at: -1 }, {}]],
    FranchiseOwners: [[{ user_id: 1 }, { sparse: true }],
      [{ linkage_status: 1 }, {}],
      [{ franchise_ids: 1 }, {}]],
    AuthAccounts: [
      [{ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } }],
      [{ user_id: 1 }, { unique: true, partialFilterExpression: { user_id: { $type: "string" } } }]
    ],
    AuthSessions: [[{ token_hash: 1 }, { unique: true }], [{ expires_at: 1 }, {}]],
    UserLocations: [[{ user_id: 1, captured_at: -1 }, {}]],
    Franchises: [[{ parent_id: 1, level: 1, status: 1 }, {}]],
    GeoBoundaries: [[{ franchise_id: 1, status: 1 }, {
      unique: true,
      partialFilterExpression: { status: "ACTIVE" }
    }]],
    Orders: [
      [{ customer_id: 1, created_at: -1 }, {}],
      [{ customer_id: 1, idempotency_key: 1 }, {
        unique: true,
        partialFilterExpression: { idempotency_key: { $type: "string" } }
      }]
    ],
    OrderAttribution: [[{ order_id: 1 }, { unique: true }]],
    CommissionRules: [[{ service_id: 1, level: 1, status: 1, effective_from: 1 }, {}]],
    CommissionLedger: [
      [{ order_id: 1, owner_id: 1, level: 1 }, { unique: true }],
      [{ owner_id: 1, status: 1, created_at: -1 }, {}]
    ],
    WalletLedger: [
      [{ owner_id: 1, created_at: -1 }, {}],
      [{ owner_id: 1, reference: 1, entry: 1 }, { unique: true }]
    ],
    Employees: [
      [{ employee_id: 1 }, { unique: true }],
      [{ email: 1 }, { unique: true }],
      [{ franchise_id: 1, status: 1 }, {}]
    ],
    Attendance: [[{ employee_id: 1, date: 1 }, { unique: true }]],
    EmployeeDocuments: [[{ employee_id: 1, status: 1 }, {}]],
    Notifications: [[{ employee_id: 1, read: 1, created_at: -1 }, {}]],
    AuditLogs: [[{ actor_id: 1, timestamp: -1 }, {}]],
    Departments: [[{ name: 1 }, { unique: true }]],
    Designations: [[{ department_id: 1, name: 1 }, { unique: true }]]
  };
  return definitions[name] || [];
}

async function createNormalizedCollections(data) {
  const database = mongoClient.db(process.env.MONGODB_DB || "zyngram_day10");
  const collections = { ...data, ...getMongoProjections(data) };
  for (const [name, records] of Object.entries(collections)) {
    if (!Array.isArray(records)) continue;
    const collectionName = `zyngram_${name}`;
    const collectionExists = await database.listCollections(
      { name: collectionName },
      { nameOnly: true }
    ).hasNext();
    if (!collectionExists) {
      await database.createCollection(collectionName);
    }
    const collection = database.collection(collectionName);
    for (const [keys, options] of indexDefinitions(name)) {
      await collection.createIndex(keys, options);
    }
  }
}

async function syncNormalizedCollections(data, previous = null, session = null) {
  const database = mongoClient.db(process.env.MONGODB_DB || "zyngram_day10");
  const collections = { ...data, ...getMongoProjections(data) };
  const previousCollections = previous
    ? { ...previous, ...getMongoProjections(previous) }
    : null;
  for (const [name, records] of Object.entries(collections)) {
    if (!Array.isArray(records)) continue;
    if (previousCollections && JSON.stringify(previousCollections[name]) === JSON.stringify(records)) continue;
    const collection = database.collection(`zyngram_${name}`);
    const keys = records.map(record => recordKey(name, record));
    const replacements = records.map((record, index) => ({
      replaceOne: {
        filter: { _id: keys[index] },
        replacement: { ...record, _id: keys[index] },
        upsert: true
      }
    }));
    const options = session ? { session } : {};
    if (replacements.length) await collection.bulkWrite(replacements, { ordered: true, ...options });
    await collection.deleteMany(keys.length ? { _id: { $nin: keys } } : {}, options);
  }
}

function readData() {
  if (mongoEnabled) {
    if (!dataCache) throw new Error("MongoDB store has not been initialized");
    return clone(dataCache);
  }
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function writeData(data) {
  if (!mongoEnabled) {
    fs.writeFileSync(schemaPath, JSON.stringify(data, null, 2), "utf8");
    return;
  }
  if (!mongoCollection) throw new Error("MongoDB store has not been initialized");

  const nextData = clone(data);
  const bsonBytes = require("mongodb").BSON.calculateObjectSize({ _id: "main", revision, data: nextData });
  if (bsonBytes >= maxMongoStateBytes) {
    throw new Error("MongoDB application state reached the 15 MiB safety limit; migrate to normalized collections before adding more data");
  }
  dataCache = nextData;
  const snapshot = clone(dataCache);
  writeQueue = writeQueue.then(async () => {
    if (persistenceError) throw persistenceError;
    const currentRevision = revision;
    const session = transactionsSupported ? mongoClient.startSession() : null;
    const persistSnapshot = async () => {
      await syncNormalizedCollections(snapshot, persistedData, session);
      const result = await mongoCollection.replaceOne(
        { _id: "main", revision: currentRevision },
        { _id: "main", revision: currentRevision + 1, data: snapshot, updated_at: new Date() },
        session ? { session } : {}
      );
      if (result.matchedCount !== 1) {
        throw new Error("MongoDB application state changed concurrently; restart one backend instance and reconcile before retrying");
      }
    };
    try {
      if (session) {
        await session.withTransaction(persistSnapshot, {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" }
        });
      } else {
        await persistSnapshot();
      }
    } finally {
      if (session) await session.endSession();
    }
    revision = currentRevision + 1;
    persistedData = snapshot;
  }).catch(error => {
    persistenceError = error;
    console.error("MongoDB persistence error:", error);
  });
}

async function flush() {
  await writeQueue;
  if (persistenceError) {
    throw persistenceError;
  }
}

async function initialize() {
  if (!mongoEnabled) return;
  if (mongoClient) return;
  if (process.env.NODE_ENV === "production" && !process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required in production");
  }

  const { MongoClient } = require("mongodb");
  mongoClient = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS || 10000)
  });
  try {
    await mongoClient.connect();
    const database = mongoClient.db(process.env.MONGODB_DB || "zyngram_day10");
    const topology = await database.command({ hello: 1 });
    transactionsSupported = Boolean(topology.setName || topology.msg === "isdbgrid");
    if (process.env.NODE_ENV === "production" && !transactionsSupported) {
      throw new Error("Production MongoDB must support multi-document transactions; use a replica set or sharded cluster");
    }
    mongoCollection = database.collection("application_state");
    const storedState = await mongoCollection.findOne({ _id: "main" });
    if (!storedState || !storedState.data || typeof storedState.data !== "object") {
      throw new Error("MongoDB has no imported Zyngram state; run `npm run migrate:mongodb` before starting the API");
    }
    dataCache = storedState.data;
    revision = Number(storedState.revision || 0);
    await createNormalizedCollections(dataCache);
    await syncNormalizedCollections(dataCache);
    persistedData = clone(dataCache);
  } catch (error) {
    await mongoClient.close();
    mongoClient = null;
    mongoCollection = null;
    transactionsSupported = false;
    throw error;
  }
}

async function close() {
  await flush();
  if (mongoClient) await mongoClient.close();
  mongoClient = null;
  mongoCollection = null;
  transactionsSupported = false;
}

async function health() {
  if (!mongoEnabled) {
    const data = readData();
    return { mode: "json", ready: Boolean(data && typeof data === "object") };
  }
  if (!mongoCollection) return { mode: "mongodb", ready: false };
  await flush();
  await mongoClient.db(process.env.MONGODB_DB || "zyngram_day10").command({ ping: 1 });
  return { mode: "mongodb", ready: true, revision, transactions: transactionsSupported };
}

module.exports = { close, flush, health, initialize, mongoEnabled, readData, writeData };
