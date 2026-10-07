const express = require("express");
const fs = require("fs");
const path = require("path");
const { allowRoles } = require("../middleware/authMiddleware");
const store = require("../services/dataStore");

const router = express.Router();
const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

router.get("/", allowRoles("ADMIN"), (req, res) => {
  try {
    const data = store.readData();
    const logs = data.AuditLogs || [];
    res.json({ success: true, count: logs.length, logs: logs.slice().reverse() });
  } catch (error) {
    console.error("Audit log retrieval error:", error);
    res.status(500).json({ success: false, message: "Unable to load audit logs" });
  }
});

module.exports = router;
