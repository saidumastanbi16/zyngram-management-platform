const express = require("express");
const { rateLimit } = require("express-rate-limit");
const authController = require("../controllers/authController");
const { allowRoles, authenticate } = require("../middleware/authMiddleware");

const router = express.Router();
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Please try again later." }
});
const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many registration attempts. Please try again later." }
});

router.post("/register", registrationRateLimit, authController.registerCustomer);
router.post("/login", loginRateLimit, authController.login);
router.use(authenticate);
router.get("/me", authController.me);
router.post("/logout", authController.logout);
router.post("/admins", allowRoles("ADMIN"), authController.createStaff);

module.exports = router;
