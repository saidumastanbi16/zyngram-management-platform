const commissionService = require("../services/commissionService");
const orderService = require("../services/orderService");
const attributionService = require("../services/attributionService");
const { recordAudit } = require("../utils/auditLog");
const store = require("../services/dataStore");
const { franchisesForUser } = require("../utils/franchiseScope");


// =====================================================
// GET ALL COMMISSION RULES
// GET /api/commissions/rules
// =====================================================

function getRules(req, res) {
  try {
    const rules = commissionService.getRules();

    res.json({
      success: true,
      rules
    });

  } catch (error) {

    console.error(
      "Get commission rules error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to load commission rules"
    });
  }
}


// =====================================================
// CREATE COMMISSION RULE
// POST /api/commissions/rules
// =====================================================

function createRule(req, res) {
  try {

    const rule =
      commissionService.createRule(
        req.body
      );
    recordAudit({
      actor: req.user,
      action: "COMMISSION_RULE_CREATED",
      entity: "CommissionRule",
      entityId: rule.rule_id,
      metadata: { service_id: rule.service_id, level: rule.level, version: rule.version }
    });

    res.status(201).json({
      success: true,
      message: "Commission rule created successfully",
      rule
    });

  } catch (error) {

    console.error(
      "Create commission rule error:",
      error
    );

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}


// =====================================================
// GET COMMISSION LEDGER
// GET /api/commissions
// =====================================================

function getCommissions(req, res) {
  try {

    const data = store.readData();

    const commissions =
      data.CommissionLedger || [];

    res.json({
      success: true,
      commissions
    });

  } catch (error) {

    console.error(
      "Get commissions error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to load commission ledger"
    });
  }
}


// =====================================================
// GET COMMISSIONS BY OWNER
// GET /api/commissions/:ownerId
// =====================================================

function getOwnerCommissions(req, res) {

  try {

    const requestedOwnerId =
      req.params.ownerId;
    const data = store.readData();
    const commissions =
      data.CommissionLedger || [];
    const franchiseRoles = ["COMMAND", "HUB", "CENTER"];
    const ownerId = requestedOwnerId === req.user.franchise_id ? req.user.id : requestedOwnerId;
    const visibleOwnerIds = franchiseRoles.includes(req.user.role)
      ? new Set(franchisesForUser(data.Franchises || [], req.user).map(franchise => franchise.owner_id))
      : new Set([ownerId]);
    const ownerCommissions = commissions.filter(commission => visibleOwnerIds.has(commission.owner_id));

    res.json({
      success: true,
      owner_id: ownerId,
      commissions: ownerCommissions
    });

  } catch (error) {

    console.error(
      "Get owner commissions error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to load owner commissions"
    });
  }
}


// =====================================================
// PROCESS COMMISSION
// POST /api/commissions/process
// =====================================================

function processCommission(req, res) {

  try {
    const orderId = req.body && req.body.order_id;
    if (typeof orderId !== "string" || !orderId.trim()) {

      return res.status(400).json({
        success: false,
        message: "order_id is required"
      });
    }

    const order = orderService.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    const attribution = attributionService.getOrderAttribution(order.id);
    if (!attribution) {
      return res.status(400).json({
        success: false,
        message: "Create a backend attribution snapshot before calculating commission"
      });
    }


    const results =
      commissionService.processCommission(
        order,
        attribution
      );


    res.json({

      success: true,

      message: "Commission processing completed",

      results

    });

  } catch (error) {

    console.error(
      "Commission processing error:",
      error
    );

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}


// =====================================================
// EXPORT CONTROLLERS
// =====================================================

module.exports = {

  getRules,

  createRule,

  getCommissions,

  getOwnerCommissions,

  processCommission,
  transitionCommission(req, res, action) {
    try {
      const result = require("../services/commissionLifecycleService")
        .transition(req.params.ledgerId, action, req.user, req.body?.reason);
      return res.json({ success: true, ...result });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 409 || error.statusCode === 400) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error(`Commission ${action.toLowerCase()} error:`, error);
      return res.status(500).json({ success: false, message: `Unable to ${action.toLowerCase()} commission` });
    }
  },
  markCommissionEligible(req, res) {
    return module.exports.transitionCommission(req, res, "MARK_ELIGIBLE");
  },
  approveCommission(req, res) {
    return module.exports.transitionCommission(req, res, "APPROVE");
  },
  settleCommission(req, res) {
    return module.exports.transitionCommission(req, res, "SETTLE");
  },
  reverseCommission(req, res) {
    return module.exports.transitionCommission(req, res, "REVERSE");
  }

};