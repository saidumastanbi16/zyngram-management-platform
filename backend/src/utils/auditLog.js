const crypto = require("crypto");
const store = require("../services/dataStore");

function recordAudit({ actor, action, entity, entityId, result = "SUCCESS", metadata = {} }) {
  const data = store.readData();
  data.AuditLogs = data.AuditLogs || [];
  const log = {
    id: `AUD-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    timestamp: new Date().toISOString(),
    actor_id: actor?.id || "SYSTEM",
    role: actor?.role || "SYSTEM",
    action,
    entity,
    entity_id: entityId || null,
    result,
    metadata
  };
  data.AuditLogs.push(log);
  store.writeData(data);
  return log;
}

module.exports = { recordAudit };
