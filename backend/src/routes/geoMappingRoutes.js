const express = require("express");

const router = express.Router();

const {
  mapLocationToFranchise
} = require("../controllers/geoMappingController");

// Map coordinates to franchise hierarchy
router.post("/map", mapLocationToFranchise);

module.exports = router;