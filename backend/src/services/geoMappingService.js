const fs = require("fs");
const path = require("path");
const store = require("./dataStore");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

function readData() {
  return store.readData();
}

// Check whether a coordinate is inside a polygon
function isPointInsidePolygon(lat, lon, polygon) {
  let inside = false;

  for (
    let i = 0, j = polygon.length - 1;
    i < polygon.length;
    j = i++
  ) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];

    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lon <
        ((xj - xi) * (lat - yi)) /
          (yj - yi) +
          xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function hierarchyForPoint(data, point) {
  if (!point || point.level !== "Point" || point.status !== "ACTIVE") return null;
  const center = data.Franchises.find(item => item.id === point.parent_id && item.level === "Center" && item.status === "ACTIVE");
  const hub = center && data.Franchises.find(item => item.id === center.parent_id && item.level === "Hub" && item.status === "ACTIVE");
  const command = hub && data.Franchises.find(item => item.id === hub.parent_id && item.level === "Command" && item.status === "ACTIVE");
  if (!center || !hub || !command) return null;
  const digital = {};
  let parentId = command.parent_id;
  for (const level of ["Node", "Zone", "Territory", "Region", "Nation"]) {
    const item = parentId && data.Franchises.find(franchise =>
      franchise.id === parentId && franchise.level === level && franchise.status === "ACTIVE"
    );
    if (!item) break;
    digital[level.toLowerCase()] = item;
    parentId = item.parent_id;
  }
  return { point, center, hub, command, ...digital };
}

function findFranchiseHierarchy(lat, lon, locationId) {
  const data = readData();
  const savedLocation = locationId && (data.UserLocations || []).find(item => item.id === locationId);
  const override = locationId && (data.GeoMappingCorrections || [])
    .filter(item =>
      item.location_id === locationId &&
      item.status === "ACTIVE" &&
      savedLocation &&
      Number(savedLocation.lat) === Number(lat) &&
      Number(savedLocation.lon) === Number(lon)
    )
    .sort((left, right) => new Date(right.corrected_at) - new Date(left.corrected_at))[0];
  if (override) {
    const point = data.Franchises.find(item => item.id === override.point_id);
    const hierarchy = hierarchyForPoint(data, point);
    if (hierarchy) {
      return {
        mapped: true,
        status: "MAPPED",
        ...hierarchy,
        mapping_source: "ADMIN_CORRECTION",
        correction_id: override.id,
        mapping_version: override.mapping_version,
        coordinates: { lat, lon }
      };
    }
  }

  const activeBoundaries = data.GeoBoundaries.filter(boundary => {
    if (boundary.status !== "ACTIVE") return false;
    const franchise = data.Franchises.find(item => item.id === boundary.franchise_id);
    return franchise && franchise.level === "Point" && franchise.status === "ACTIVE";
  });

  let matchedBoundary = null;

  for (const boundary of activeBoundaries) {
    if (
      boundary.geometry &&
      boundary.geometry.type === "Polygon"
    ) {
      const rings = boundary.geometry.coordinates || [];
      const outerRing = rings[0] || [];
      const insideOuter = isPointInsidePolygon(lat, lon, outerRing);
      const insideHole = rings.slice(1).some(ring => isPointInsidePolygon(lat, lon, ring));

      if (insideOuter && !insideHole) {
        matchedBoundary = boundary;
        break;
      }
    }
  }

  if (!matchedBoundary) {
    return {
      mapped: false,
      status: "UNMAPPED",
      message: "No franchise boundary matches this location"
    };
  }

  const point = data.Franchises.find(
    franchise =>
      franchise.id === matchedBoundary.franchise_id &&
      franchise.level === "Point" &&
      franchise.status === "ACTIVE"
  );

  if (!point) {
    return {
      mapped: false,
      status: "UNMAPPED",
      message: "Point franchise not found"
    };
  }

  const hierarchy = hierarchyForPoint(data, point);
  if (!hierarchy) {
    return {
      mapped: false,
      status: "UNMAPPED",
      message: "The matched Point does not have a complete active franchise hierarchy"
    };
  }

  return {
    mapped: true,
    status: "MAPPED",
    ...hierarchy,
    boundary_id: matchedBoundary.id,
    boundary_geometry: matchedBoundary.geometry,
    mapping_version: matchedBoundary.version,
    mapping_source: "BOUNDARY",
    coordinates: {
      lat,
      lon
    }
  };
}

function correctLocationMapping({ locationId, pointId, reason, actor }) {
  const data = readData();
  const location = (data.UserLocations || []).find(item => item.id === locationId);
  if (!location) throw new Error("Saved location not found");
  const point = (data.Franchises || []).find(item => item.id === pointId);
  const hierarchy = hierarchyForPoint(data, point);
  if (!hierarchy) throw new Error("Select an active Point with a complete active hierarchy");
  if (typeof reason !== "string" || reason.trim().length < 10 || reason.trim().length > 500) {
    throw new Error("Correction reason must be between 10 and 500 characters");
  }
  data.GeoMappingCorrections = data.GeoMappingCorrections || [];
  const correction = {
    id: `GMC-${Date.now()}-${require("crypto").randomBytes(3).toString("hex")}`,
    location_id: locationId,
    point_id: pointId,
    reason: reason.trim(),
    actor_id: actor.id,
    actor_role: actor.role,
    mapping_version: `manual-${Date.now()}`,
    status: "ACTIVE",
    corrected_at: new Date().toISOString()
  };
  data.GeoMappingCorrections.push(correction);
  data.AuditLogs = data.AuditLogs || [];
  data.AuditLogs.push({
    id: `AUD-${Date.now()}-${require("crypto").randomBytes(3).toString("hex")}`,
    actor_id: actor.id,
    role: actor.role,
    action: "GEO_MAPPING_CORRECTED",
    entity: "UserLocation",
    entity_id: locationId,
    result: "SUCCESS",
    metadata: { reason: correction.reason, point_id: pointId, correction_id: correction.id },
    created_at: correction.corrected_at
  });
  store.writeData(data);
  return { correction, mapping: { ...hierarchy, mapped: true, status: "MAPPED", mapping_source: "ADMIN_CORRECTION", correction_id: correction.id, mapping_version: correction.mapping_version, coordinates: { lat: location.lat, lon: location.lon } } };
}

module.exports = {
  correctLocationMapping,
  findFranchiseHierarchy,
  isPointInsidePolygon
};