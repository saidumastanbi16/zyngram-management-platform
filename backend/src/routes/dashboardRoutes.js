const express = require("express");
const fs = require("fs");
const path = require("path");
const { allowRoles } = require("../middleware/authMiddleware");
const store = require("../services/dataStore");
const geoMappingService = require("../services/geoMappingService");
const { franchisesForUser, mappingInUserScope } = require("../utils/franchiseScope");

const router = express.Router();
const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

router.get("/", allowRoles("ADMIN", "HQ", "COMMAND", "HUB", "CENTER"), (req, res) => {
  try {
    const data = store.readData();
    const scopedFranchises = franchisesForUser(data.Franchises || [], req.user);
    const scopedIds = new Set(scopedFranchises.map(franchise => franchise.id));
    const scopedLocations = (data.UserLocations || []).filter(location => {
      const mapping = geoMappingService.findFranchiseHierarchy(location.lat, location.lon, location.id);
      return mappingInUserScope(mapping, req.user);
    });
    const locationIds = new Set(scopedLocations.map(location => location.id));
    const scopedOrders = (data.Orders || []).filter(order => {
      const location = (data.UserLocations || []).find(item => item.id === order.location_id);
      return location && locationIds.has(location.id);
    });
    const ownerIds = new Set(scopedFranchises.map(franchise => franchise.owner_id));
    const scopedLedger = (data.CommissionLedger || []).filter(entry => ownerIds.has(entry.owner_id));
    const walletLedger = (data.WalletLedger || []).filter(entry => ownerIds.has(entry.owner_id));
    const activeLedger = scopedLedger.filter(entry => entry.lifecycle_status !== "REVERSED" && entry.status !== "Reversed");
    const commissionTotal = activeLedger.reduce((total, entry) => total + Number(entry.amount || 0), 0);
    const settledCommissionTotal = scopedLedger
      .filter(entry => entry.settlement_status === "SETTLED" && entry.lifecycle_status !== "REVERSED")
      .reduce((total, entry) => total + Number(entry.amount || 0), 0);
    const pendingCommissionTotal = activeLedger
      .filter(entry => entry.settlement_status !== "SETTLED")
      .reduce((total, entry) => total + Number(entry.amount || 0), 0);
    const walletCredits = walletLedger
      .filter(entry => entry.entry === "credit")
      .reduce((total, entry) => total + Number(entry.amount || 0), 0);
    const walletDebits = walletLedger
      .filter(entry => entry.entry === "debit")
      .reduce((total, entry) => total + Number(entry.amount || 0), 0);
    const mappingCounts = scopedLocations.reduce((counts, location) => {
      const result = geoMappingService.findFranchiseHierarchy(location.lat, location.lon, location.id);
      counts[result.mapped ? "mapped" : "unmapped"] += 1;
      return counts;
    }, { mapped: 0, unmapped: 0 });
    const latestLocation = scopedLocations
      .slice()
      .sort((left, right) => new Date(right.captured_at) - new Date(left.captured_at))[0];
    const customerIds = new Set(scopedLocations.map(location => location.user_id));
    const visibleCustomerCount = ["ADMIN", "HQ"].includes(req.user.role)
      ? (data.Users || []).filter(user => !user.role || user.role === "CUSTOMER").length
      : customerIds.size;

    res.json({
      success: true,
      latest_location: latestLocation
        ? {
            ...latestLocation,
            mapping: geoMappingService.findFranchiseHierarchy(latestLocation.lat, latestLocation.lon, latestLocation.id)
          }
        : null,
      metrics: {
        customers: visibleCustomerCount,
        franchises: scopedIds.size,
        orders: scopedOrders.length,
        mapped_locations: mappingCounts.mapped,
        unmapped_locations: mappingCounts.unmapped,
        commission_total: commissionTotal,
        pending_commission_total: pendingCommissionTotal,
        settled_commission_total: settledCommissionTotal,
        wallet_balance: Number((walletCredits - walletDebits).toFixed(2))
      }
    });
  } catch (error) {
    console.error("Dashboard metrics error:", error);
    res.status(500).json({ success: false, message: "Unable to load dashboard metrics" });
  }
});

module.exports = router;
