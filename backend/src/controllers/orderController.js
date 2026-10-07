const orderService = require("../services/orderService");
const locationService = require("../services/locationService");
const attributionService = require("../services/attributionService");
const geoMappingService = require("../services/geoMappingService");
const commissionService = require("../services/commissionService");
const serviceCatalog = require("../services/serviceCatalog");
const userService = require("../services/userService");
const { recordAudit } = require("../utils/auditLog");

function orderInStaffScope(order, user) {
  if (["ADMIN", "HQ"].includes(user.role)) return true;
  const field = { COMMAND: "command", HUB: "hub", CENTER: "center" }[user.role];
  if (!field || !user.franchise_id) return false;
  const attribution = attributionService.getOrderAttribution(order.id);
  if (attribution) return attribution[`${field}_id`] === user.franchise_id;
  const location = locationService.getUserLocations(order.customer_id).find(item => item.id === order.location_id);
  if (!location) return false;
  const mapping = geoMappingService.findFranchiseHierarchy(location.lat, location.lon, location.id);
  return mapping.mapped && mapping[field]?.id === user.franchise_id;
}

function createOrder(req, res) {
  try {
    const { customer_id, service_id, location_id } = req.body;
    const customerId = req.user.role === "CUSTOMER" ? req.user.id : customer_id;
    if (req.user.role !== "CUSTOMER" && !["ADMIN", "HQ"].includes(req.user.role)) {
      recordAudit({
        actor: req.user,
        action: "AUTHORIZATION_DENIED",
        entity: "Order",
        result: "DENIED",
        metadata: { method: req.method, path: req.originalUrl }
      });
      return res.status(403).json({ success: false, message: "Only administrators or headquarters can create bookings for customers" });
    }
    const service = serviceCatalog.getService(service_id);

    if (
      !customerId ||
      !service_id ||
      !service ||
      !location_id
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A valid customer, configured service and saved location are required"
      });
    }
    let orderDetails;
    try {
      orderDetails = serviceCatalog.validateOrder(service, req.body);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const idempotencyKey = req.get("Idempotency-Key");
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
      return res.status(400).json({ success: false, message: "Idempotency-Key must be between 8 and 128 characters" });
    }
    const customer = userService.getUserById(customerId);
    if (!customer || customer.status === "INACTIVE" || (customer.role && customer.role !== "CUSTOMER")) {
      return res.status(404).json({ success: false, message: "Active customer account not found" });
    }

    const customerLocations = locationService.getUserLocations(customerId);
    const selectedLocation = customerLocations.find(location => location.id === location_id);
    if (!selectedLocation) {
      return res.status(400).json({
        success: false,
        message: "The selected service location does not belong to this customer"
      });
    }
    if (req.user.role === "CUSTOMER" && selectedLocation.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "You can only book from your own saved location" });
    }
    if (!Number.isFinite(Number(selectedLocation.accuracy)) || Number(selectedLocation.accuracy) <= 0 || Number(selectedLocation.accuracy) > 100) {
      return res.status(422).json({
        success: false,
        message: "Location GPS accuracy must be 100 meters or better before booking"
      });
    }
    const mapping = geoMappingService.findFranchiseHierarchy(selectedLocation.lat, selectedLocation.lon, selectedLocation.id);
    if (!mapping.mapped) {
      return res.status(422).json({
        success: false,
        message: "This location is not inside a configured franchise boundary",
        mapping
      });
    }

    const existingOrder = orderService.getOrderByIdempotencyKey(customerId, idempotencyKey);
    if (existingOrder) {
      const sameRequest = existingOrder.service_id === service_id &&
        existingOrder.location_id === location_id &&
        existingOrder.amount === orderDetails.amount &&
        JSON.stringify(existingOrder.details || null) === JSON.stringify(orderDetails.details);
      if (!sameRequest) {
        return res.status(409).json({ success: false, message: "Idempotency-Key was already used for a different order" });
      }
      return res.json({
        success: true,
        duplicate: true,
        message: "This order was already created",
        order: existingOrder,
        mapping
      });
    }

    const order = orderService.createOrder({
      customer_id: customerId,
      service_id,
      amount: orderDetails.amount,
      location_id,
      details: orderDetails.details,
      idempotency_key: idempotencyKey
    });
    recordAudit({
      actor: req.user,
      action: "ORDER_CREATED",
      entity: "Order",
      entityId: order.id,
      metadata: { customer_id: customerId, service_id, location_id, amount: order.amount }
    });

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      order,
      mapping
    });

  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order"
    });
  }
}

function confirmOrder(req, res) {
  try {
    const order = orderService.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (req.user.role === "CUSTOMER" && order.customer_id !== req.user.id) {
      recordAudit({
        actor: req.user,
        action: "AUTHORIZATION_DENIED",
        entity: "Order",
        entityId: order.id,
        result: "DENIED",
        metadata: { action: "ORDER_CONFIRMATION" }
      });
      return res.status(403).json({ success: false, message: "You can only confirm your own orders" });
    }
    if (req.user.role !== "CUSTOMER" && !orderInStaffScope(order, req.user)) {
      recordAudit({
        actor: req.user,
        action: "AUTHORIZATION_DENIED",
        entity: "Order",
        entityId: order.id,
        result: "DENIED",
        metadata: { action: "ORDER_CONFIRMATION" }
      });
      return res.status(403).json({ success: false, message: "Order is outside your assigned franchise" });
    }

    let attribution = attributionService.getOrderAttribution(order.id);
    if (!attribution) {
      const location = locationService.getUserLocations(order.customer_id)
        .find(item => item.id === order.location_id);
      if (!location) {
        return res.status(404).json({ success: false, message: "The order service location was not found" });
      }
      if (!Number.isFinite(Number(location.accuracy)) || Number(location.accuracy) <= 0 || Number(location.accuracy) > 100) {
        return res.status(422).json({
          success: false,
          message: "Location GPS accuracy must be 100 meters or better before confirmation"
        });
      }
      const mapping = geoMappingService.findFranchiseHierarchy(location.lat, location.lon, location.id);
      if (!mapping.mapped) {
        return res.status(422).json({
          success: false,
          message: "Order location is not mapped to an active franchise boundary",
          mapping
        });
      }
      const commissionRules = commissionService.getApplicableRules(order.service_id, order.created_at);
      attribution = attributionService.createOrderAttribution(order, {
        ...mapping,
        commission_rule_version: commissionRules.map(rule => `${rule.level}:${rule.version}:${rule.rule_id}`).join(",") || "NO_ACTIVE_RULES",
        commission_rules: commissionRules,
        coordinates: {
          ...mapping.coordinates,
          accuracy: Number(location.accuracy),
          source: location.source
        }
      });
    }

    const wasAlreadyProcessed = ["CONFIRMED", "DEMO_COMPLETED"].includes(order.status);
    const isDemoRecharge = order.details?.processing_mode === "DEMO";
    const commissions = commissionService.processCommission(order, attribution);
    const confirmedOrder = orderService.confirmOrder(order.id);
    recordAudit({
      actor: req.user,
      action: isDemoRecharge ? "DEMO_ORDER_COMPLETED" : "ORDER_CONFIRMED",
      entity: "Order",
      entityId: order.id,
      metadata: {
        attribution_id: attribution.id,
        commission_count: commissions.length,
        ...(isDemoRecharge ? { telecom_recharge_submitted: false } : {})
      }
    });
    res.json({
      success: true,
      message: isDemoRecharge
        ? wasAlreadyProcessed
          ? "Demo order was already completed; existing commission entries were reused. No telecom recharge was submitted."
          : "Demo order completed and demo commissions processed. No telecom recharge was submitted."
        : wasAlreadyProcessed
          ? "Order was already confirmed; existing commission entries were reused"
          : "Order confirmed and commissions processed",
      order: confirmedOrder,
      attribution,
      commissions
    });
  } catch (error) {
    console.error("Order confirmation error:", error);
    res.status(500).json({ success: false, message: "Failed to confirm order" });
  }
}

function getOrderById(req, res) {
  try {
    const order = orderService.getOrderById(
      req.params.id
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }
    if (req.user.role === "CUSTOMER" && order.customer_id !== req.user.id) {
      return res.status(403).json({ success: false, message: "You can only view your own orders" });
    }
    if (req.user.role !== "CUSTOMER" && !orderInStaffScope(order, req.user)) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.status(200).json({
      success: true,
      order
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch order"
    });
  }
}

function getOrders(req, res) {
  try {
    const orders = orderService.getOrders();
    const visibleOrders = req.user.role === "CUSTOMER"
      ? orders.filter(order => order.customer_id === req.user.id)
      : orders.filter(order => orderInStaffScope(order, req.user));
    res.json({ success: true, count: visibleOrders.length, orders: visibleOrders });
  } catch (error) {
    console.error("Order list error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
}

module.exports = {
  confirmOrder,
  createOrder,
  getOrderById,
  getOrders
};