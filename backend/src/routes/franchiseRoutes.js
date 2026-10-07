const express = require("express");
const { allowRoles } = require("../middleware/authMiddleware");

const router = express.Router();

const {
  getFranchises,
  getFranchiseById,
  createFranchise,
  updateFranchise
} = require("../controllers/franchiseController");

// Create franchise
router.post("/", allowRoles("ADMIN", "HQ"), createFranchise);
router.patch("/:id", allowRoles("ADMIN", "HQ"), updateFranchise);

// Get all franchises
router.get("/", getFranchises);

// Get franchise by ID
router.get("/:id", getFranchiseById);

module.exports = router;