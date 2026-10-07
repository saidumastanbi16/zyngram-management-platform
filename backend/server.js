require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { authenticate } = require("./src/middleware/authMiddleware");
const dataStore = require("./src/services/dataStore");
const authService = require("./src/services/authService");
const employeeService = require("./src/services/employeeService");
const serviceCatalog = require("./src/services/serviceCatalog");

const app = express();
const PORT = Number(process.env.PORT || 5050);
const production = process.env.NODE_ENV === "production";
if (production) app.set("trust proxy", 1);
const allowedOrigins = (process.env.CORS_ORIGINS || (production ? "" : "http://localhost:5173"))
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

if (production && (!allowedOrigins.length || allowedOrigins.includes("*"))) {
  throw new Error("Set CORS_ORIGINS to an explicit comma-separated list of production frontend origins");
}

// Middleware
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.includes(origin));
  }
}));
app.use(express.json({ limit: "6mb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (dataStore.mongoEnabled) {
    const send = res.send;
    res.send = function sendAfterMongoCommit(body) {
      dataStore.flush()
        .then(() => send.call(this, body))
        .catch(error => {
          console.error("Request persistence failed:", error);
          if (!this.headersSent) {
            this.statusCode = 503;
            this.setHeader("Content-Type", "application/json; charset=utf-8");
            send.call(this, JSON.stringify({
              success: false,
              message: "The request could not be durably saved. Contact support before retrying."
            }));
          }
        });
      return this;
    };
  }
  next();
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Zyngram Day 10 API is running"
  });
});

app.get("/api/ready", async (req, res) => {
  try {
    const health = await dataStore.health();
    if (!health.ready) {
      return res.status(503).json({ success: false, ready: false, message: "Application data store is unavailable" });
    }
    const data = dataStore.readData();
    const requiredCollections = ["Users", "Franchises", "Orders", "CommissionLedger", "Employees", "AuditLogs"];
    const missingCollections = requiredCollections.filter(name => !Array.isArray(data[name]));
    if (missingCollections.length) {
      return res.status(503).json({
        success: false,
        message: "Required application data collections are missing",
        missingCollections
      });
    }
    return res.json({
      success: true,
      ready: true,
      storage: health.mode,
      ...(health.revision === undefined ? {} : { revision: health.revision }),
      ...(health.transactions === undefined ? {} : { transactions: health.transactions })
    });
  } catch (error) {
    console.error("Readiness check error:", error);
    return res.status(503).json({ success: false, ready: false, message: "Application data store is unavailable" });
  }
});

app.use("/api/auth", require("./src/routes/authRoutes"));
app.use("/api", authenticate);
app.get("/api/me", (req, res) => {
  res.json({ success: true, user: req.user });
});

// ===============================
// User routes
// ===============================
const userRoutes = require("./src/routes/userRoutes");
app.use("/api/users", userRoutes);

// ===============================
// Location routes
// ===============================
const locationRoutes = require("./src/routes/locationRoutes");
app.use("/api/locations", locationRoutes);

// ===============================
// Franchise routes
// ===============================
const franchiseRoutes = require("./src/routes/franchiseRoutes");
app.use("/api/franchises", franchiseRoutes);

// ===============================
// GeoBoundary routes
// ===============================
const geoBoundaryRoutes = require("./src/routes/geoBoundaryRoutes");
app.use("/api/geo-boundaries", geoBoundaryRoutes);

// ===============================
// GeoMapping routes
// ===============================
const geoMappingRoutes = require("./src/routes/geoMappingRoutes");
app.use("/api/geo-mapping", geoMappingRoutes);

// ===============================
// Order routes
// ===============================
const orderRoutes = require("./src/routes/orderRoutes");
app.use("/api/orders", orderRoutes);

// ===============================
// Attribution routes
// ===============================
const attributionRoutes = require("./src/routes/attributionRoutes");
app.use("/api/attributions", attributionRoutes);

// ===============================
// Commission routes
// ===============================
const commissionRoutes = require("./src/routes/commissionRoutes");
app.use("/api/commissions", commissionRoutes);

app.use("/api/audit-logs", require("./src/routes/auditRoutes"));
app.use("/api/geo", require("./src/routes/geoRoutes"));
app.use("/api/dashboard", require("./src/routes/dashboardRoutes"));
app.use("/api/reports", require("./src/routes/reportRoutes"));
app.use("/api/services", require("./src/routes/serviceRoutes"));
app.use("/api/wallet", require("./src/routes/walletRoutes"));
app.use("/api", require("./src/routes/employeeRoutes"));

// ===============================
// Root route
// ===============================
app.get("/", (req, res) => {
  res.send("Zyngram Backend is Working!");
});

// ===============================
// Start server
// ===============================
if (require.main === module) {
  const HOST = process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1");
  (async () => {
    if (production && !process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI must be configured before starting the production API");
    }
    if (production && ["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.MONGODB_URI).hostname)) {
      throw new Error("Production MONGODB_URI must point to a reachable managed database, not localhost");
    }
    await dataStore.initialize();
    authService.ensureStorage();
    employeeService.ensureEmployeeCollections();
    const data = dataStore.readData();
    if (!Array.isArray(data.Services) || !data.Services.length) {
      data.Services = serviceCatalog.getSeedServices();
      dataStore.writeData(data);
    }
    await dataStore.flush();
    app.listen(PORT, HOST, () => {
      console.log(`Zyngram backend running on http://${HOST}:${PORT}`);
    });
  })().catch(error => {
    console.error("Backend startup failed:", error);
    process.exitCode = 1;
  });
}

module.exports = app;