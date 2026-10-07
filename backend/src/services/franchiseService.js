const fs = require("fs");
const path = require("path");
const store = require("./dataStore");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

function readData() {
  return store.readData();
}

function writeData(data) {
  store.writeData(data);
}

function hasActiveParents(data, franchise) {
  const expectedParents = {
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
  let child = franchise;
  while (child.parent_id) {
    const expectedLevel = expectedParents[child.level];
    if (!expectedLevel) return false;
    const parent = (data.Franchises || []).find(item => item.id === child.parent_id);
    if (!parent || parent.level !== expectedLevel || parent.status !== "ACTIVE") return false;
    child = parent;
  }
  return child.level === "Command" || expectedParents[child.level] === null;
}

function getFranchises() {
  const data = readData();
  return data.Franchises;
}

function getFranchiseById(id) {
  const franchises = getFranchises();

  return franchises.find(
    franchise => franchise.id === id
  );
}

function createFranchise(franchise) {
  const data = readData();

  const validLevels = [
    "Point",
    "Center",
    "Hub",
    "Command",
    "Node",
    "Zone",
    "Territory",
    "Region",
    "Nation"
  ];

  if (!validLevels.includes(franchise.level)) {
    throw new Error(
      "Invalid franchise level"
    );
  }
  if (typeof franchise.name !== "string" || franchise.name.trim().length < 2 || franchise.name.trim().length > 100) {
    throw new Error("Franchise name must be between 2 and 100 characters");
  }
  if (typeof franchise.owner_id !== "string" || !franchise.owner_id.trim()) {
    throw new Error("A valid franchise owner ID is required");
  }

  const expectedParentLevel = {
    Nation: null,
    Region: "Nation",
    Territory: "Region",
    Zone: "Territory",
    Node: "Zone",
    Command: "Node",
    Hub: "Command",
    Center: "Hub",
    Point: "Center"
  }[franchise.level];
  const optionalParent = franchise.level === "Command";
  if (expectedParentLevel === null && franchise.parent_id) {
    throw new Error("A Nation franchise cannot have a parent");
  }
  if (expectedParentLevel && !optionalParent && !franchise.parent_id) {
    throw new Error(`${franchise.level} franchises require a ${expectedParentLevel} parent`);
  }
  if (franchise.parent_id) {
    const parent = data.Franchises.find(item => item.id === franchise.parent_id && item.status === "ACTIVE");
    if (!parent || parent.level !== expectedParentLevel) {
      throw new Error(`Parent must be an active ${expectedParentLevel} franchise`);
    }
  }
  if (franchise.parent_id && !hasActiveParents(data, { ...franchise, status: "ACTIVE" })) {
    throw new Error("The franchise parent hierarchy must be complete and active");
  }

  const newFranchise = {
    id: `FRN-${Date.now()}-${require("crypto").randomBytes(3).toString("hex")}`,
    level: franchise.level,
    name: franchise.name.trim(),
    owner_id: franchise.owner_id.trim(),
    parent_id: franchise.parent_id || null,
    status: "ACTIVE"
  };

  data.Franchises.push(newFranchise);

  writeData(data);

  return newFranchise;
}

function updateFranchise(id, changes) {
  const data = readData();
  const franchise = data.Franchises.find(item => item.id === id);
  if (!franchise) return null;
  if (changes.name !== undefined) {
    if (typeof changes.name !== "string" || changes.name.trim().length < 2 || changes.name.trim().length > 100) {
      throw new Error("Franchise name must be between 2 and 100 characters");
    }
    franchise.name = changes.name.trim();
  }
  if (changes.status !== undefined) {
    if (!["ACTIVE", "INACTIVE"].includes(changes.status)) throw new Error("Status must be ACTIVE or INACTIVE");
    if (changes.status === "ACTIVE") {
      if (!hasActiveParents(data, franchise)) {
        throw new Error("Cannot activate a franchise until its complete parent hierarchy is active");
      }
    }
    franchise.status = changes.status;
  }
  if (changes.owner_id !== undefined) {
    if (typeof changes.owner_id !== "string" || !changes.owner_id.trim()) throw new Error("A valid owner ID is required");
    franchise.owner_id = changes.owner_id.trim();
  }
  writeData(data);
  return franchise;
}

module.exports = {
  getFranchises,
  getFranchiseById,
  createFranchise,
  updateFranchise
};