const express = require("express");
const serviceCatalog = require("../services/serviceCatalog");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ success: true, services: serviceCatalog.listServices() });
});

module.exports = router;
