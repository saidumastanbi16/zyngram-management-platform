const express = require("express");

const router = express.Router();

const {
  captureLocation,
  getUserLocations
} = require("../controllers/locationController");

// Capture a user's location
router.post("/capture", captureLocation);

// Get locations for a specific user
router.get("/user/:userId", getUserLocations);

module.exports = router;