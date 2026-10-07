const crypto = require("crypto");
const store = require("./dataStore");

function recordCommissionCredit(data, commission, actorId, createdAt = new Date().toISOString()) {
  data.WalletLedger = data.WalletLedger || [];
  const existing = data.WalletLedger.find(entry =>
    entry.owner_id === commission.owner_id &&
    entry.reference === commission.id &&
    entry.entry === "credit"
  );
  if (existing) return existing;

  const walletEntry = {
    id: `WAL-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    owner_id: commission.owner_id,
    entry: "credit",
    reference: commission.id,
    amount: Number(commission.amount),
    status: "SETTLED",
    created_at: createdAt,
    created_by: actorId
  };
  data.WalletLedger.push(walletEntry);
  return walletEntry;
}

function getOwnerWallet(ownerId) {
  const data = store.readData();
  const entries = (data.WalletLedger || [])
    .filter(entry => entry.owner_id === ownerId)
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  const credits = entries
    .filter(entry => entry.entry === "credit")
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
  const debits = entries
    .filter(entry => entry.entry === "debit")
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);

  return {
    owner_id: ownerId,
    credits,
    debits,
    balance: Number((credits - debits).toFixed(2)),
    count: entries.length,
    entries
  };
}

module.exports = { getOwnerWallet, recordCommissionCredit };
