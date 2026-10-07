const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const store = require("./dataStore");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

function currentStatus(entry) {
  if (entry.lifecycle_status) return entry.lifecycle_status;
  if (entry.settlement_status === "SETTLED") return "SETTLED";
  return String(entry.status || entry.calculation_status || "CALCULATED").toUpperCase();
}

function transition(ledgerId, action, actor, reason = "") {
  const data = store.readData();
  const entry = (data.CommissionLedger || []).find(item => item.id === ledgerId);
  if (!entry) {
    const error = new Error("Commission entry not found");
    error.statusCode = 404;
    throw error;
  }

  const from = currentStatus(entry);
  if (action === "SETTLE" && from === "SETTLED") {
    const walletEntry = (data.WalletLedger || []).find(item =>
      item.owner_id === entry.owner_id && item.reference === entry.id && item.entry === "credit"
    ) || null;
    return { entry, wallet_entry: walletEntry, message: "Commission was already settled" };
  }
  if (action === "REVERSE" && from === "REVERSED") {
    const walletEntry = (data.WalletLedger || []).find(item =>
      item.owner_id === entry.owner_id && item.reference === entry.id && item.entry === "debit"
    ) || null;
    return { entry, wallet_entry: walletEntry, message: "Commission was already reversed" };
  }

  const allowedFrom = {
    MARK_ELIGIBLE: ["CALCULATED"],
    APPROVE: ["ELIGIBLE"],
    SETTLE: ["APPROVED"],
    REVERSE: ["CALCULATED", "ELIGIBLE", "APPROVED", "SETTLED"]
  }[action];
  if (!allowedFrom || !allowedFrom.includes(from)) {
    const error = new Error(`Cannot ${action.toLowerCase()} a commission in ${from} state`);
    error.statusCode = 409;
    throw error;
  }
  if (action === "REVERSE" && (typeof reason !== "string" || reason.trim().length < 10 || reason.trim().length > 500)) {
    const error = new Error("Reversal reason must be between 10 and 500 characters");
    error.statusCode = 400;
    throw error;
  }

  const timestamp = new Date().toISOString();
  const nextStatus = {
    MARK_ELIGIBLE: "ELIGIBLE",
    APPROVE: "APPROVED",
    SETTLE: "SETTLED",
    REVERSE: "REVERSED"
  }[action];
  let walletEntry = null;

  if (action === "SETTLE") {
    const walletService = require("./walletService");
    walletEntry = walletService.recordCommissionCredit(data, entry, actor.id, timestamp);
    entry.settlement_status = "SETTLED";
    entry.settled_at = timestamp;
    entry.settled_by = actor.id;
  } else if (action === "REVERSE") {
    if (from === "SETTLED") {
      data.WalletLedger = data.WalletLedger || [];
      walletEntry = data.WalletLedger.find(item =>
        item.owner_id === entry.owner_id && item.reference === entry.id && item.entry === "debit"
      );
      if (!walletEntry) {
        walletEntry = {
          id: `WAL-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          owner_id: entry.owner_id,
          entry: "debit",
          reference: entry.id,
          amount: Number(entry.amount),
          status: "SETTLED",
          created_at: timestamp,
          created_by: actor.id,
          reason: reason.trim()
        };
        data.WalletLedger.push(walletEntry);
      }
      entry.settlement_status = "REVERSED";
      entry.reversed_settlement_at = timestamp;
    }
    entry.reversed_at = timestamp;
    entry.reversed_by = actor.id;
    entry.reversal_reason = reason.trim();
  }

  entry.lifecycle_status = nextStatus;
  entry.status = nextStatus.charAt(0) + nextStatus.slice(1).toLowerCase();
  data.AuditLogs = data.AuditLogs || [];
  data.AuditLogs.push({
    id: `AUD-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    actor_id: actor.id,
    role: actor.role,
    action: `COMMISSION_${nextStatus}`,
    entity: "CommissionLedger",
    entity_id: entry.id,
    result: "SUCCESS",
    metadata: {
      from,
      to: nextStatus,
      ...(action === "REVERSE" ? { reason: reason.trim() } : {}),
      ...(walletEntry ? { wallet_entry_id: walletEntry.id } : {})
    },
    created_at: timestamp
  });
  store.writeData(data);
  return {
    entry,
    wallet_entry: walletEntry,
    message: action === "REVERSE" && from === "SETTLED"
      ? "Commission reversed and wallet debit recorded"
      : `Commission moved to ${nextStatus.toLowerCase()}`
  };
}

module.exports = { currentStatus, transition };
