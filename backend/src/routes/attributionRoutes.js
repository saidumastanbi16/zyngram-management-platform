const express = require("express");
const { allowRoles } = require("../middleware/authMiddleware");

const router = express.Router();

const {
  createOrderAttribution,
  getOrderAttribution
} = require("../controllers/attributionController");

// Create immutable order attribution
router.post("/", allowRoles("ADMIN"), createOrderAttribution);

// Get attribution for an order
router.get("/:orderId", getOrderAttribution);

module.exports = router;