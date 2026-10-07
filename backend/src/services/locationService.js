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

function captureLocation(location) {
  const data = readData();
  data.UserLocations = data.UserLocations || [];
  if (!(data.Users || []).some(user => user.id === location.user_id && user.status !== "INACTIVE")) {
    throw new Error("Customer account was not found or is inactive");
  }

  const newLocation = {
    id: `LOC-${Date.now()}-${require("crypto").randomBytes(3).toString("hex")}`,
    user_id: location.user_id,
    lat: Number(location.lat),
    lon: Number(location.lon),
    accuracy: Number(location.accuracy),
    address: location.address || "",
    source: location.source || "browser",
    captured_at: new Date().toISOString()
  };

  data.UserLocations.push(newLocation);

  writeData(data);

  return newLocation;
}

function getUserLocations(userId) {
  const data = readData();

  return data.UserLocations.filter(
    location => location.user_id === userId
  );
}

module.exports = {
  captureLocation,
  getUserLocations
};