const attributionService = require("../services/attributionService");
const orderService = require("../services/orderService");
const locationService = require("../services/locationService");
const geoMappingService = require("../services/geoMappingService");
const commissionService = require("../services/commissionService");

function createOrderAttribution(req, res) {
  try {
    const { order_id } = req.body;

    if (!order_id) {
      return res.status(400).json({
        success: false,
        message: "order_id is required"
      });
    }

    // Find the order
    const order = orderService.getOrderById(order_id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // Find the customer's saved location
    const locations =
      locationService.getUserLocations(
        order.customer_id
      );

    if (!locations.length) {
      return res.status(404).json({
        success: false,
        message: "Customer location not found"
      });
    }

    // Use the location attached to the order
    const location = locations.find(
      item => item.id === order.location_id
    );

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Order location not found"
      });
    }

    // Backend performs the geo-mapping
    const mapping =
      geoMappingService.findFranchiseHierarchy(
        location.lat,
        location.lon,
        location.id
      );

    if (!mapping.mapped) {
      return res.status(422).json({
        success: false,
        message: "Order location is not mapped to a franchise",
        mapping
      });
    }

    // Create immutable attribution snapshot
    const commissionRules = commissionService.getApplicableRules(order.service_id, order.created_at);
    const attribution = attributionService.createOrderAttribution(order, {
      ...mapping,
      commission_rule_version: commissionRules.map(rule => `${rule.level}:${rule.version}:${rule.rule_id}`).join(",") || "NO_ACTIVE_RULES",
      commission_rules: commissionRules,
      coordinates: { ...mapping.coordinates, accuracy: Number(location.accuracy), source: location.source }
    });

    res.status(201).json({
      success: true,
      message: "Order attribution created successfully",
      attribution
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to create order attribution"
    });
  }
}

function getOrderAttribution(req, res) {
  try {
    const order = orderService.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (req.user.role === "CUSTOMER" && order.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "You can only view attribution for your own orders" });
    }
    if (req.user.role !== "ADMIN" && req.user.role !== "HQ" && req.user.role !== "CUSTOMER") {
      const initial = attributionService.getOrderAttribution(order.id);
      if (!initial) return res.status(404).json({ success: false, message: "Order attribution not found" });
      const franchiseLevel = { COMMAND: "command_id", HUB: "hub_id", CENTER: "center_id" }[req.user.role];
      if (!franchiseLevel || initial[franchiseLevel] !== req.user.franchise_id) {
        return res.status(403).json({ success: false, message: "Attribution is outside your assigned franchise" });
      }
    }
    const attribution =
      attributionService.getOrderAttribution(
        req.params.orderId
      );

    if (!attribution) {
      return res.status(404).json({
        success: false,
        message: "Order attribution not found"
      });
    }

    res.status(200).json({
      success: true,
      attribution
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch order attribution"
    });
  }
}

module.exports = {
  createOrderAttribution,
  getOrderAttribution
};