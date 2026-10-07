const franchiseService = require("../services/franchiseService");
const { recordAudit } = require("../utils/auditLog");
const { franchisesForUser } = require("../utils/franchiseScope");

function getFranchises(req, res) {
  try {
    const franchises = franchisesForUser(franchiseService.getFranchises(), req.user);

    res.status(200).json({
      success: true,
      count: franchises.length,
      franchises
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch franchises"
    });
  }
}

function getFranchiseById(req, res) {
  try {
    const visibleIds = new Set(franchisesForUser(franchiseService.getFranchises(), req.user).map(item => item.id));
    if (!visibleIds.has(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Franchise not found"
      });
    }
    const franchise = franchiseService.getFranchiseById(
      req.params.id
    );

    if (!franchise) {
      return res.status(404).json({
        success: false,
        message: "Franchise not found"
      });
    }

    res.status(200).json({
      success: true,
      franchise
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch franchise"
    });
  }
}

function createFranchise(req, res) {
  try {
    const {
      level,
      name,
      owner_id,
      parent_id
    } = req.body;

    if (!level || !name || !owner_id) {
      return res.status(400).json({
        success: false,
        message: "level, name and owner_id are required"
      });
    }

    const franchise = franchiseService.createFranchise({
      level,
      name,
      owner_id,
      parent_id
    });
    recordAudit({
      actor: req.user,
      action: "FRANCHISE_CREATED",
      entity: "Franchise",
      entityId: franchise.id,
      metadata: { level, parent_id: parent_id || null, owner_id }
    });

    res.status(201).json({
      success: true,
      message: "Franchise created successfully",
      franchise
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

function updateFranchise(req, res) {
  try {
    const allowed = ["name", "owner_id", "status"];
    const changes = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(changes).length || Object.keys(changes).length !== Object.keys(req.body || {}).length) {
      return res.status(400).json({ success: false, message: "Provide only name, owner_id, or status" });
    }
    const franchise = franchiseService.updateFranchise(req.params.id, changes);
    if (!franchise) return res.status(404).json({ success: false, message: "Franchise not found" });
    recordAudit({
      actor: req.user,
      action: "FRANCHISE_UPDATED",
      entity: "Franchise",
      entityId: franchise.id,
      metadata: changes
    });
    return res.json({ success: true, franchise });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
}

module.exports = {
  getFranchises,
  getFranchiseById,
  createFranchise,
  updateFranchise
};