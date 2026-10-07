const express = require("express");
const fs = require("fs");
const path = require("path");
const { allowRoles } = require("../middleware/authMiddleware");
const store = require("../services/dataStore");

const router = express.Router();
const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

router.get("/commissions", allowRoles("ADMIN", "HQ"), (req, res) => {
  try {
    const startValue = req.query.start_date;
    const endValue = req.query.end_date;
    const start = startValue ? new Date(startValue) : null;
    const end = endValue ? new Date(endValue) : null;
    if (endValue && /^\d{4}-\d{2}-\d{2}$/.test(String(endValue))) end.setUTCHours(23, 59, 59, 999);
    const validDate = (value, parsed) => {
      if (!value || Number.isNaN(parsed.getTime())) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return true;
      return parsed.toISOString().slice(0, 10) === value;
    };
    if ((startValue && !validDate(startValue, start)) || (endValue && !validDate(endValue, end))) {
      return res.status(400).json({ success: false, message: "Date filters must be valid dates" });
    }
    if (start && end && start > end) {
      return res.status(400).json({ success: false, message: "start_date cannot be later than end_date" });
    }
    const data = store.readData();
    const commissions = (data.CommissionLedger || []).filter(entry => {
      const created = new Date(entry.created_at);
      return !Number.isNaN(created.getTime()) && (!start || created >= start) && (!end || created <= end);
    });
    const activeCommissions = commissions.filter(entry => entry.lifecycle_status !== "REVERSED" && entry.status !== "Reversed");
    const byLevel = ["Point", "Center", "Hub", "Command"].map(level => {
      const entries = activeCommissions.filter(entry => entry.level === level);
      const settled = entries.filter(entry => entry.settlement_status === "SETTLED");
      return {
        level,
        count: entries.length,
        total: entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
        settled_total: settled.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
        pending_total: entries.filter(entry => entry.settlement_status !== "SETTLED")
          .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
      };
    });
    const settledTotal = activeCommissions
      .filter(entry => entry.settlement_status === "SETTLED")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    res.json({
      success: true,
      count: commissions.length,
      total: activeCommissions.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
      settled_total: settledTotal,
      pending_total: activeCommissions.filter(entry => entry.settlement_status !== "SETTLED")
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
      reversed_total: commissions.filter(entry => entry.lifecycle_status === "REVERSED" || entry.status === "Reversed")
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
      by_level: byLevel,
      commissions
    });
  } catch (error) {
    console.error("Commission report error:", error);
    res.status(500).json({ success: false, message: "Unable to load commission report" });
  }
});

module.exports = router;
