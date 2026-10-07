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

function createGeoBoundary(boundary) {
  const data = readData();
  const franchise = (data.Franchises || []).find(item => item.id === boundary.franchise_id && item.status === "ACTIVE");
  if (!franchise || franchise.level !== "Point") {
    throw new Error("Geo boundaries must reference an active Point franchise");
  }
  const center = data.Franchises.find(item => item.id === franchise.parent_id && item.level === "Center" && item.status === "ACTIVE");
  const hub = center && data.Franchises.find(item => item.id === center.parent_id && item.level === "Hub" && item.status === "ACTIVE");
  const command = hub && data.Franchises.find(item => item.id === hub.parent_id && item.level === "Command" && item.status === "ACTIVE");
  if (!center || !hub || !command) throw new Error("Geo boundaries require a complete active franchise hierarchy");
  if (!boundary.geometry || boundary.geometry.type !== "Polygon" || !Array.isArray(boundary.geometry.coordinates)) {
    throw new Error("Boundary geometry must be a GeoJSON Polygon");
  }
  const rings = boundary.geometry.coordinates;
  if (!rings.length || rings.some(ring => !Array.isArray(ring) || ring.length < 4)) {
    throw new Error("Every polygon ring must contain at least four coordinate pairs");
  }
  for (const ring of rings) {
    for (const point of ring) {
      if (
        !Array.isArray(point) || point.length < 2 ||
        typeof point[0] !== "number" || !Number.isFinite(point[0]) || point[0] < -180 || point[0] > 180 ||
        typeof point[1] !== "number" || !Number.isFinite(point[1]) || point[1] < -90 || point[1] > 90
      ) {
        throw new Error("Polygon coordinates must use valid [longitude, latitude] pairs");
      }
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new Error("Polygon rings must be closed");
    }
  }
  const status = boundary.status || "ACTIVE";
  if (!["ACTIVE", "INACTIVE"].includes(status)) throw new Error("Boundary status must be ACTIVE or INACTIVE");
  const version = boundary.version || "v1";
  if (typeof version !== "string" || version.trim().length < 1 || version.length > 50) {
    throw new Error("Boundary version must be between 1 and 50 characters");
  }

  data.GeoBoundaries = data.GeoBoundaries || [];
  const supersedes = [];
  if (status === "ACTIVE") {
    data.GeoBoundaries.forEach(existing => {
      if (existing.franchise_id === franchise.id && existing.status === "ACTIVE") {
        existing.status = "INACTIVE";
        existing.updated_at = new Date().toISOString();
        supersedes.push(existing.id);
      }
    });
  }
  const newBoundary = {
    id: `GEO-${Date.now()}-${require("crypto").randomBytes(3).toString("hex")}`,
    franchise_id: boundary.franchise_id,
    geometry: boundary.geometry,
    version: version.trim(),
    status,
    supersedes,
    created_at: new Date().toISOString()
  };

  data.GeoBoundaries.push(newBoundary);

  writeData(data);

  return newBoundary;
}

function getGeoBoundaries() {
  const data = readData();

  return data.GeoBoundaries || [];
}

function updateGeoBoundary(id, status) {
  const data = readData();
  const boundary = (data.GeoBoundaries || []).find(item => item.id === id);
  if (!boundary) return null;
  if (!["ACTIVE", "INACTIVE"].includes(status)) throw new Error("Boundary status must be ACTIVE or INACTIVE");
  if (status === "ACTIVE") {
    const point = (data.Franchises || []).find(item => item.id === boundary.franchise_id && item.level === "Point" && item.status === "ACTIVE");
    const center = point && data.Franchises.find(item => item.id === point.parent_id && item.level === "Center" && item.status === "ACTIVE");
    const hub = center && data.Franchises.find(item => item.id === center.parent_id && item.level === "Hub" && item.status === "ACTIVE");
    const command = hub && data.Franchises.find(item => item.id === hub.parent_id && item.level === "Command" && item.status === "ACTIVE");
    if (!point || !center || !hub || !command) throw new Error("A boundary can only be activated under a complete active hierarchy");
    for (const sibling of data.GeoBoundaries || []) {
      if (sibling.franchise_id === boundary.franchise_id && sibling.id !== boundary.id && sibling.status === "ACTIVE") {
        sibling.status = "INACTIVE";
        sibling.updated_at = new Date().toISOString();
      }
    }
  }
  boundary.status = status;
  boundary.updated_at = new Date().toISOString();
  writeData(data);
  return boundary;
}

module.exports = {
  createGeoBoundary,
  getGeoBoundaries,
  updateGeoBoundary
};