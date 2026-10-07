const express = require("express");
const { allowRoles } = require("../middleware/authMiddleware");
const walletService = require("../services/walletService");

const router = express.Router();

router.get("/", allowRoles("ADMIN", "HQ", "COMMAND", "HUB", "CENTER"), (req, res) => {
  try {
    const requestedOwnerId = req.query.owner_id;
    if (requestedOwnerId && req.user.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Only administrators can view another owner's wallet" });
    }
    const ownerId = requestedOwnerId || req.user.id;
    const wallet = walletService.getOwnerWallet(ownerId);
    return res.json({ success: true, wallet });
  } catch (error) {
    console.error("Wallet retrieval error:", error);
    return res.status(500).json({ success: false, message: "Unable to load wallet ledger" });
  }
});

module.exports = router;
