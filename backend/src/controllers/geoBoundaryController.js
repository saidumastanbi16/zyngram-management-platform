const geoBoundaryService = require("../services/geoBoundaryService");
const { recordAudit } = require("../utils/auditLog");
const franchiseService = require("../services/franchiseService");
const { franchisesForUser } = require("../utils/franchiseScope");

function createGeoBoundary(req, res) {
  try {
    const {
      franchise_id,
      geometry,
      version,
      status
    } = req.body;

    if (!franchise_id || !geometry) {
      return res.status(400).json({
        success: false,
        message: "franchise_id and geometry are required"
      });
    }

    const boundary = geoBoundaryService.createGeoBoundary({
      franchise_id,
      geometry,
      version,
      status
    });
    recordAudit({
      actor: req.user,
      action: "GEO_BOUNDARY_CREATED",
      entity: "GeoBoundary",
      entityId: boundary.id,
      metadata: { franchise_id, version: boundary.version, supersedes: boundary.supersedes }
    });

    res.status(201).json({
      success: true,
      message: "GeoBoundary created successfully",
      boundary
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

function getGeoBoundaries(req, res) {
  try {
    const allowedIds = new Set(franchisesForUser(franchiseService.getFranchises(), req.user).map(item => item.id));
    const boundaries = geoBoundaryService.getGeoBoundaries().filter(item => allowedIds.has(item.franchise_id));

    res.status(200).json({
      success: true,
      count: boundaries.length,
      boundaries
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch GeoBoundaries"
    });
  }
}

function updateGeoBoundary(req, res) {
  try {
    const boundary = geoBoundaryService.updateGeoBoundary(req.params.id, req.body?.status);
    if (!boundary) return res.status(404).json({ success: false, message: "GeoBoundary not found" });
    recordAudit({
      actor: req.user,
      action: "GEO_BOUNDARY_STATUS_UPDATED",
      entity: "GeoBoundary",
      entityId: boundary.id,
      metadata: { status: boundary.status, version: boundary.version }
    });
    return res.json({ success: true, boundary });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
}

module.exports = {
  createGeoBoundary,
  getGeoBoundaries,
  updateGeoBoundary
};