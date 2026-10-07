const services = [
  {
    id: "SERVICE-001",
    name: "Franchise Welcome Package",
    category: "Customer onboarding",
    description: "A guided introduction to the local franchise and its services.",
    demoPrice: 1000
  },
  {
    id: "SERVICE-003",
    name: "Local Service Consultation",
    category: "Consultation",
    description: "A service-area consultation with the mapped local franchise.",
    demoPrice: 981
  },
  {
    id: "SERVICE-MOBILE-RECHARGE",
    name: "Mobile Recharge",
    category: "Mobile services",
    description: "Demo recharge request validated by the Zyngram backend.",
    pricingType: "CUSTOMER_AMOUNT",
    minAmount: 10,
    maxAmount: 10000,
    operators: [
      { id: "AIRTEL", name: "Airtel" },
      { id: "JIO", name: "Jio" },
      { id: "VI", name: "Vi" },
      { id: "BSNL", name: "BSNL" }
    ],
    circles: [
      "Andhra Pradesh",
      "Delhi",
      "Karnataka",
      "Maharashtra",
      "Tamil Nadu",
      "Telangana"
    ]
  }
];

function getSeedServices() {
  return services.map(service => ({ ...service, operators: service.operators?.map(operator => ({ ...operator })), circles: service.circles?.slice() }));
}

function configuredServices() {
  const data = require("./dataStore").readData();
  return Array.isArray(data.Services) && data.Services.length ? data.Services : services;
}

function listServices() {
  return configuredServices().map(({ demoPrice, pricingType, minAmount, maxAmount, ...service }) => ({
    ...service,
    amount: demoPrice ?? null,
    pricing_type: pricingType || "DEMO_CONFIGURATION",
    price_type: pricingType || "DEMO_CONFIGURATION",
    ...(minAmount === undefined ? {} : { min_amount: minAmount }),
    ...(maxAmount === undefined ? {} : { max_amount: maxAmount })
  }));
}

function getService(id) {
  return configuredServices().find(service => service.id === id) || null;
}

function validateOrder(service, input = {}) {
  if (service.pricingType !== "CUSTOMER_AMOUNT") {
    return { amount: service.demoPrice, details: null };
  }

  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount < service.minAmount || amount > service.maxAmount) {
    throw new Error(`Recharge amount must be a whole number between ₹${service.minAmount} and ₹${service.maxAmount}`);
  }

  const mobileNumber = typeof input.mobile_number === "string"
    ? input.mobile_number.replace(/\D/g, "")
    : "";
  if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
    throw new Error("Enter a valid 10-digit Indian mobile number");
  }

  const operator = service.operators.find(item => item.id === input.operator);
  if (!operator) throw new Error("Choose a configured mobile operator");
  if (!service.circles.includes(input.circle)) throw new Error("Choose a configured telecom circle");

  return {
    amount,
    details: {
      mobile_number: mobileNumber,
      operator_id: operator.id,
      operator_name: operator.name,
      circle: input.circle,
      processing_mode: "DEMO"
    }
  };
}

module.exports = { getSeedServices, getService, listServices, validateOrder };
