const express = require("express");
const geoMappingService = require("../services/geoMappingService");
const { allowRoles } = require("../middleware/authMiddleware");

const router = express.Router();

function parseCoordinates(latValue, lonValue) {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lon) || lon < -180 || lon > 180
  ) {
    return null;
  }
  return { lat, lon };
}

router.post("/reverse-geocode", (req, res) => {
  const coordinates = parseCoordinates(req.body && req.body.lat, req.body && req.body.lon);
  if (!coordinates) {
    return res.status(400).json({ success: false, message: "Valid latitude and longitude are required" });
  }

  const { lat, lon } = coordinates;
  const withinDemoArea = lat >= 17.67 && lat <= 17.70 && lon >= 83.20 && lon <= 83.24;
  res.json({
    success: true,
    provider: "TEST_MOCK",
    status: withinDemoArea ? "MOCK_RESOLVED" : "UNRESOLVED",
    address: withinDemoArea
      ? {
          country: "India",
          state: "Andhra Pradesh",
          district: "Visakhapatnam",
          city: "Visakhapatnam",
          pin: null
        }
      : null
  });
});

router.get("/franchise-map", (req, res) => {
  const coordinates = parseCoordinates(req.query.lat, req.query.lon);
  if (!coordinates) {
    return res.status(400).json({ success: false, message: "Valid latitude and longitude are required" });
  }
  res.json({
    success: true,
    mapping: geoMappingService.findFranchiseHierarchy(coordinates.lat, coordinates.lon, req.query.location_id)
  });
});

router.post("/mapping-corrections", allowRoles("ADMIN"), (req, res) => {
  try {
    const { location_id: locationId, point_id: pointId, reason } = req.body || {};
    if (!locationId || !pointId || !reason) {
      return res.status(400).json({ success: false, message: "location_id, point_id and reason are required" });
    }
    const result = geoMappingService.correctLocationMapping({
      locationId,
      pointId,
      reason,
      actor: req.user
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
