const express = require("express");
const { allowRoles } = require("../middleware/authMiddleware");
const router = express.Router();
const staffRoles = ["ADMIN", "HQ", "COMMAND", "HUB", "CENTER"];

const commissionController = require("../controllers/commissionController");

// Commission rules
router.get("/rules", allowRoles(...staffRoles), commissionController.getRules);
router.post("/rules", allowRoles("ADMIN"), commissionController.createRule);

// Process commission
router.post("/process", allowRoles("ADMIN"), commissionController.processCommission);

// Commission ledger
router.get("/", allowRoles("ADMIN", "HQ"), commissionController.getCommissions);
router.post("/:ledgerId/eligible", allowRoles("ADMIN"), commissionController.markCommissionEligible);
router.post("/:ledgerId/approve", allowRoles("ADMIN"), commissionController.approveCommission);
router.post("/:ledgerId/settle", allowRoles("ADMIN"), commissionController.settleCommission);
router.post("/:ledgerId/reverse", allowRoles("ADMIN"), commissionController.reverseCommission);

// Owner-specific commissions
router.get("/:ownerId", (req, res, next) => {
  if (req.user.role !== "ADMIN" && req.user.id !== req.params.ownerId && req.user.franchise_id !== req.params.ownerId) {
    return res.status(403).json({
      success: false,
      message: "You can only view your own commission ledger"
    });
  }
  next();
}, commissionController.getOwnerCommissions);

module.exports = router;