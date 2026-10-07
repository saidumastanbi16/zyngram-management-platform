const fs = require("fs");
const path = require("path");
const store = require("./dataStore");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

function readData() {
  return store.readData();
}

function writeData(data) {
  store.writeData(data);
}

function createOrderAttribution(order, mapping) {
  const data = readData();

  // Prevent duplicate attribution
  const existing = data.OrderAttribution.find(
    item => item.order_id === order.id
  );

  if (existing) {
    return existing;
  }

  const attribution = {
    order_id: order.id,

    point_id: mapping.point
      ? mapping.point.id
      : null,

    center_id: mapping.center
      ? mapping.center.id
      : null,

    hub_id: mapping.hub
      ? mapping.hub.id
      : null,

    command_id: mapping.command
      ? mapping.command.id
      : null,

    node_id: mapping.node?.id || null,
    zone_id: mapping.zone?.id || null,
    territory_id: mapping.territory?.id || null,
    region_id: mapping.region?.id || null,
    nation_id: mapping.nation?.id || null,

    mapping_version:
      mapping.mapping_version || "v1",

    commission_rule_version:
      mapping.commission_rule_version || "NO_ACTIVE_RULES",

    ...(Array.isArray(mapping.commission_rules)
      ? { commission_rules: mapping.commission_rules.map(rule => ({ ...rule })) }
      : {}),

    coordinates: {
      lat: mapping.coordinates.lat,
      lon: mapping.coordinates.lon,
      ...(mapping.coordinates.accuracy !== undefined ? { accuracy: mapping.coordinates.accuracy } : {}),
      ...(mapping.coordinates.source ? { source: mapping.coordinates.source } : {})
    },

    attributed_at: new Date().toISOString()
  };

  data.OrderAttribution.push(attribution);

  writeData(data);

  return attribution;
}

function getOrderAttribution(orderId) {
  const data = readData();

  return data.OrderAttribution.find(
    item => item.order_id === orderId
  );
}

module.exports = {
  createOrderAttribution,
  getOrderAttribution
};