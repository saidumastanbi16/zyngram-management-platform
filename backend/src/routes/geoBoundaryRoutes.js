const express = require("express");
const { allowRoles } = require("../middleware/authMiddleware");

const router = express.Router();

const {
  createGeoBoundary,
  getGeoBoundaries,
  updateGeoBoundary
} = require("../controllers/geoBoundaryController");

// Create a GeoBoundary
router.post("/", allowRoles("ADMIN", "HQ"), createGeoBoundary);

// Get all GeoBoundaries
router.get("/", getGeoBoundaries);
router.patch("/:id", allowRoles("ADMIN", "HQ"), updateGeoBoundary);

module.exports = router;