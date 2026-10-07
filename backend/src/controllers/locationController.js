const locationService = require("../services/locationService");
const geoMappingService = require("../services/geoMappingService");
const { recordAudit } = require("../utils/auditLog");
const store = require("../services/dataStore");

function captureLocation(req, res) {
  try {
    const {
      lat,
      lon,
      accuracy,
      address,
      source
    } = req.body;
    const user_id = req.user.role === "CUSTOMER" ? req.user.id : req.body.user_id;
    if (req.user.role !== "CUSTOMER" && req.user.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only administrators can capture a location for another customer" });
    }

    if (!user_id || lat === undefined || lon === undefined || accuracy === undefined) {
      return res.status(400).json({
        success: false,
        message: "user_id, lat, lon and accuracy are required"
      });
    }

    const latitude = Number(lat);
    const longitude = Number(lon);
    const measuredAccuracy = Number(accuracy);
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(measuredAccuracy) || measuredAccuracy <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Coordinates and location accuracy must be valid positive measurements"
      });
    }

    const mapping = geoMappingService.findFranchiseHierarchy(latitude, longitude);
    const location = locationService.captureLocation({
      user_id,
      lat: latitude,
      lon: longitude,
      accuracy: measuredAccuracy,
      address,
      source
    });
    recordAudit({
      actor: req.user,
      action: "LOCATION_CAPTURED",
      entity: "UserLocation",
      entityId: location.id,
      metadata: { user_id, source: location.source, accuracy: location.accuracy }
    });

    res.status(201).json({
      success: true,
      message: mapping.mapped
        ? "Location captured and mapped to an active franchise"
        : "Location captured; no active franchise boundary matches it",
      location,
      mapping
    });

  } catch (error) {
    console.error("Location capture error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to capture location"
    });
  }
}

function getUserLocations(req, res) {
  try {
    if (!["ADMIN", "HQ"].includes(req.user.role) && req.user.id !== req.params.userId) {
      return res.status(403).json({
        success: false,
        message: "You can only view your own saved locations"
      });
    }
    const users = store.readData().Users || [];
    if (!users.some(user => user.id === req.params.userId)) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    const locations = locationService.getUserLocations(
      req.params.userId
    );

    res.status(200).json({
      success: true,
      count: locations.length,
      locations
    });

  } catch (error) {
    console.error("Location listing error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user locations"
    });
  }
}

module.exports = {
  captureLocation,
  getUserLocations
};