const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./dataStore");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");

function readData() {
  return store.readData();
}

function writeData(data) {
  store.writeData(data);
}

function createOrder(order) {
  const data = readData();
  data.Orders = data.Orders || [];

  const newOrder = {
    id: `ORD-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    customer_id: order.customer_id,
    service_id: order.service_id,
    amount: Number(order.amount),
    status: "CREATED",
    location_id: order.location_id,
    created_at: new Date().toISOString(),
    ...(order.details ? { details: order.details } : {}),
    ...(order.idempotency_key ? { idempotency_key: order.idempotency_key } : {})
  };

  data.Orders.push(newOrder);

  writeData(data);

  return newOrder;
}

function getOrderByIdempotencyKey(customerId, key) {
  if (!key) return null;
  const data = readData();
  return (data.Orders || []).find(order =>
    order.customer_id === customerId && order.idempotency_key === key
  ) || null;
}

function getOrderById(id) {
  const data = readData();

  return data.Orders.find(
    order => order.id === id
  );
}

function getOrders() {
  const data = readData();
  return data.Orders || [];
}

function confirmOrder(id) {
  const data = readData();
  const order = data.Orders.find(item => item.id === id);

  if (!order) {
    return null;
  }

  if (order.details?.processing_mode === "DEMO") {
    order.status = "DEMO_COMPLETED";
    order.demo_completed_at = order.demo_completed_at || new Date().toISOString();
  } else {
    order.status = "CONFIRMED";
    order.confirmed_at = order.confirmed_at || new Date().toISOString();
  }
  writeData(data);
  return order;
}

module.exports = {
  confirmOrder,
  createOrder,
  getOrderByIdempotencyKey,
  getOrderById,
  getOrders
};