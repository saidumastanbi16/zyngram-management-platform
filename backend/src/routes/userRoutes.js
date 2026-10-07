const express = require("express");
const { allowRoles } = require("../middleware/authMiddleware");

const router = express.Router();

const {
  getUsers,
  getUserById,
  createUser,
  updateUser
} = require("../controllers/userController");

// Create a new user
router.post("/", allowRoles("ADMIN"), createUser);
router.patch("/:id", allowRoles("ADMIN"), updateUser);

// Get customers within the administrator or assigned franchise scope
router.get("/", allowRoles("ADMIN", "HQ", "COMMAND", "HUB", "CENTER"), getUsers);

// Get user by ID
router.get("/:id", (req, res, next) => {
  if (
    !["ADMIN", "HQ", "COMMAND", "HUB", "CENTER"].includes(req.user.role) &&
    req.user.id !== req.params.id
  ) {
    return res.status(403).json({
      success: false,
      message: "You can only view your own user profile"
    });
  }
  next();
}, getUserById);

module.exports = router;