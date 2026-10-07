const geoMappingService = require("../services/geoMappingService");

function mapLocationToFranchise(req, res) {
  try {
    const { lat, lon, location_id: locationId } = req.body;

    if (lat === undefined || lon === undefined) {
      return res.status(400).json({
        success: false,
        message: "lat and lon are required"
      });
    }

    const latitude = Number(lat);
    const longitude = Number(lon);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "lat and lon must be valid numbers"
      });
    }

    const result =
      geoMappingService.findFranchiseHierarchy(
        latitude,
        longitude,
        locationId
      );

    res.status(200).json({
      success: true,
      mapping: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to map location to franchise"
    });
  }
}

module.exports = {
  mapLocationToFranchise
};