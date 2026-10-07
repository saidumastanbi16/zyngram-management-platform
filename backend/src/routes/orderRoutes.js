const express = require("express");

const router = express.Router();

const {
  confirmOrder,
  createOrder,
  getOrderById,
  getOrders
} = require("../controllers/orderController");
const { allowRoles } = require("../middleware/authMiddleware");

// Create an order
router.post("/", allowRoles("ADMIN", "HQ", "COMMAND", "HUB", "CENTER", "CUSTOMER"), createOrder);
router.post("/:id/confirm", allowRoles("ADMIN", "HQ", "COMMAND", "HUB", "CENTER"), confirmOrder);
router.get("/", getOrders);

// Get order by ID
router.get("/:id", getOrderById);

module.exports = router;