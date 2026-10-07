const fs = require("fs");
const path = require("path");
const store = require("./dataStore");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(
  __dirname,
  "../../data/schema.json"
);


// =====================================================
// READ DATABASE
// =====================================================

function readData() {
  return store.readData();
}


// =====================================================
// WRITE DATABASE
// =====================================================

function writeData(data) {
  store.writeData(data);
}


// =====================================================
// GET ALL COMMISSION RULES
// =====================================================

function getRules() {
  const data = readData();

  return data.CommissionRules || [];
}


// =====================================================
// CREATE COMMISSION RULE
// =====================================================

function createRule(ruleData) {

  const data = readData();
  if (!ruleData || typeof ruleData !== "object" || Array.isArray(ruleData)) {
    throw new Error("A commission rule object is required");
  }

  if (!data.CommissionRules) {
    data.CommissionRules = [];
  }


  // Required fields

  const requiredFields = [
    "service_id",
    "level",
    "rate",
    "type",
    "effective_from",
    "version",
    "status"
  ];


  for (const field of requiredFields) {

    if (
      ruleData[field] === undefined ||
      ruleData[field] === null ||
      ruleData[field] === ""
    ) {

      throw new Error(
        `${field} is required`
      );

    }
  }


  // Validate franchise level

  const validLevels = [
    "Point",
    "Center",
    "Hub",
    "Command"
  ];


  if (!validLevels.includes(ruleData.level)) {

    throw new Error(
      "Invalid commission level"
    );

  }


  // Validate commission type

  const validTypes = [
    "percentage",
    "fixed"
  ];


  if (!validTypes.includes(ruleData.type)) {

    throw new Error(
      "Invalid commission type"
    );

  }


  // Validate rate

  const rate = Number(ruleData.rate);
  if (!Number.isFinite(rate) || rate < 0 || (ruleData.type === "percentage" && rate > 100)) {

    throw new Error(
      "Commission rate must be valid and percentage rates cannot exceed 100"
    );

  }
  const validServices = require("./serviceCatalog").listServices();
  if (!validServices.some(service => service.id === ruleData.service_id)) {
    throw new Error("Select a configured service");
  }
  const effectiveFrom = new Date(ruleData.effective_from);
  const effectiveTo = ruleData.effective_to ? new Date(ruleData.effective_to) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime()))) {
    throw new Error("Effective dates must be valid dates");
  }
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error("effective_to cannot be earlier than effective_from");
  }
  if (!["ACTIVE", "INACTIVE"].includes(ruleData.status)) throw new Error("Status must be ACTIVE or INACTIVE");
  if (typeof ruleData.version !== "string" || ruleData.version.trim().length < 1 || ruleData.version.trim().length > 50) {
    throw new Error("A valid commission rule version is required");
  }


  // Create rule

  const rule = {

    rule_id:
      `RULE-${Date.now()}-${require("crypto").randomBytes(3).toString("hex")}`,

    service_id:
      ruleData.service_id,

    level:
      ruleData.level,

    rate:
      rate,

    type:
      ruleData.type,

    effective_from:
      ruleData.effective_from ||
      new Date().toISOString(),

    effective_to:
      ruleData.effective_to ||
      null,

    version:
      ruleData.version.trim(),

    status:
      ruleData.status ||
      "ACTIVE",

    configuration_type:
      "TEST_CONFIGURATION",

    created_at:
      new Date().toISOString()

  };


  data.CommissionRules.push(rule);

  writeData(data);

  return rule;
}


// =====================================================
// FIND ACTIVE COMMISSION RULE
// =====================================================

function findActiveRule(
  serviceId,
  level,
  orderDate
) {

  const data = readData();

  const rules =
    data.CommissionRules || [];


  const targetDate =
    new Date(
      orderDate || new Date()
    );


  return rules.filter(rule => {

    // Service must match

    if (
      rule.service_id !== serviceId
    ) {

      return false;

    }


    // Franchise level must match

    if (
      rule.level !== level
    ) {

      return false;

    }


    // Rule must be active

    if (
      rule.status !== "ACTIVE"
    ) {

      return false;

    }


    // Effective start date

    const fromDate =
      new Date(
        rule.effective_from
      );


    if (
      targetDate < fromDate
    ) {

      return false;

    }


    // Effective end date

    if (rule.effective_to) {

      const toDate =
        new Date(
          rule.effective_to
        );


      if (
        targetDate > toDate
      ) {

        return false;

      }

    }


    return true;

  }).sort((left, right) =>
    new Date(right.effective_from) - new Date(left.effective_from) ||
    new Date(right.created_at || 0) - new Date(left.created_at || 0)
  )[0] || null;

}

function getApplicableRules(serviceId, orderDate) {
  return ["Point", "Center", "Hub", "Command"].flatMap(level => {
    const rule = findActiveRule(serviceId, level, orderDate);
    return rule ? [{ ...rule }] : [];
  });

}


// =====================================================
// CALCULATE COMMISSION AMOUNT
// =====================================================

function calculateCommission(
  amount,
  rule
) {

  if (!rule) {
    return 0;
  }


  const orderAmount =
    Number(amount);


  const rate =
    Number(rule.rate);


  // Percentage commission

  if (
    rule.type === "percentage"
  ) {

    return Number(
      (
        orderAmount *
        rate /
        100
      ).toFixed(2)
    );

  }


  // Fixed commission

  if (
    rule.type === "fixed"
  ) {

    return Number(
      rate.toFixed(2)
    );

  }


  return 0;

}


// =====================================================
// CREATE COMMISSION LEDGER ENTRY
// =====================================================

function createLedgerEntry({

  orderId,

  ownerId,

  level,

  rule,

  amount

}) {

  const data = readData();


  if (!data.CommissionLedger) {

    data.CommissionLedger = [];

  }


  // ---------------------------------------------
  // DUPLICATE PROTECTION
  // ---------------------------------------------

  const existing =
    data.CommissionLedger.find(
      entry =>
        entry.order_id === orderId &&
        entry.level === level
    );


  if (existing) {

    return {

      duplicate: true,

      entry: existing

    };

  }


  // ---------------------------------------------
  // CREATE LEDGER ENTRY
  // ---------------------------------------------

  const entry = {

    id:
      `COM-${Date.now()}-${level}-${require("crypto").randomBytes(3).toString("hex")}`,

    order_id:
      orderId,

    owner_id:
      ownerId,

    level:
      level,

    rule_id:
      rule.rule_id,

    rate:
      rule.rate,

    rule_version:
      rule.version,

    amount:
      amount,

    status:
      "Calculated",

    lifecycle_status:
      "CALCULATED",

    calculation_status:
      "Calculated",

    settlement_status:
      "Pending",

    created_at:
      new Date().toISOString()

  };


  data.CommissionLedger.push(
    entry
  );


  writeData(data);


  return {

    duplicate: false,

    entry: entry

  };

}


// =====================================================
// PROCESS COMMISSION FOR AN ORDER
// =====================================================

function processCommission(
  order,
  attribution
) {

  if (!order) {

    throw new Error(
      "Order is required"
    );

  }


  if (!attribution) {

    throw new Error(
      "Attribution is required before commission calculation"
    );

  }


  // ---------------------------------------------
  // FRANCHISE LEVELS
  // ---------------------------------------------

  const franchiseLevels = [

    {
      level: "Point",

      franchiseId:
        attribution.point_id
    },

    {
      level: "Center",

      franchiseId:
        attribution.center_id
    },

    {
      level: "Hub",

      franchiseId:
        attribution.hub_id
    },

    {
      level: "Command",

      franchiseId:
        attribution.command_id
    }

  ];


  const data = readData();

  const franchises =
    data.Franchises || [];


  const results = [];
  const rulesByLevel = new Map(
    (Array.isArray(attribution.commission_rules)
      ? attribution.commission_rules
      : ["Point", "Center", "Hub", "Command"]
        .map(level => findActiveRule(order.service_id, level, order.created_at))
        .filter(Boolean)
    ).map(rule => [rule.level, rule])
  );


  // ---------------------------------------------
  // PROCESS EACH LEVEL
  // ---------------------------------------------

  for (
    const item of franchiseLevels
  ) {

    if (!item.franchiseId) {

      continue;

    }


    // Find franchise

    const franchise =
      franchises.find(
        franchise =>
          franchise.id ===
          item.franchiseId
      );


    if (!franchise) {

      continue;

    }


    // Find active rule

    const rule = rulesByLevel.get(item.level);


    // No rule configured

    if (!rule) {

      results.push({

        level:
          item.level,

        status:
          "RULE_NOT_FOUND",

        amount:
          0

      });

      continue;

    }


    // Calculate commission

    const amount =
      calculateCommission(

        order.amount,

        rule

      );


    // Create ledger

    const ledgerResult =
      createLedgerEntry({

        orderId:
          order.id,

        ownerId:
          franchise.owner_id,

        level:
          item.level,

        rule:
          rule,

        amount:
          amount

      });


    results.push({

      level:
        item.level,

      owner_id:
        franchise.owner_id,

      rule_id:
        rule.rule_id,

      rate:
        rule.rate,

      type:
        rule.type,

      amount:
        amount,

      duplicate:
        ledgerResult.duplicate,

      ledger:
        ledgerResult.entry

    });

  }


  return results;

}


// =====================================================
// EXPORT FUNCTIONS
// =====================================================

module.exports = {

  getRules,

  createRule,

  findActiveRule,

  calculateCommission,

  createLedgerEntry,
  getApplicableRules,
  processCommission

};