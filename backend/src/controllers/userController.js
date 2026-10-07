const userService = require("../services/userService");
const { recordAudit } = require("../utils/auditLog");

function getUsers(req, res) {
  try {
    const users = userService.getUsers(req.user);

    res.status(200).json({
      success: true,
      count: users.length,
      users: users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch users"
    });
  }
}

function getUserById(req, res) {
  try {
    const user = userService.getUserById(req.params.id, req.user);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    res.status(200).json({
      success: true,
      user: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch user"
    });
  }
}

function createUser(req, res) {
  try {
    const { name, mobile, email } = req.body;

    if (!name || !mobile || !email) {
      return res.status(400).json({
        success: false,
        message: "Name, mobile and email are required"
      });
    }

    const user = userService.createUser({
      name,
      mobile,
      email
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

function updateUser(req, res) {
  try {
    const allowed = ["name", "email", "mobile", "status"];
    const changes = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(changes).length || Object.keys(changes).length !== Object.keys(req.body || {}).length) {
      return res.status(400).json({ success: false, message: "Provide only name, email, mobile, or status" });
    }
    const user = userService.updateUser(req.params.id, changes);
    if (!user) return res.status(404).json({ success: false, message: "Customer not found" });
    recordAudit({
      actor: req.user,
      action: "CUSTOMER_UPDATED",
      entity: "User",
      entityId: user.id,
      metadata: changes
    });
    return res.json({ success: true, user });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
}

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser
};