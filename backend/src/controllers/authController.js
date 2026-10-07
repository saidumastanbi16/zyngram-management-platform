const authService = require("../services/authService");

function registerCustomer(req, res) {
  try {
    const result = authService.registerCustomer(req.body || {});
    return res.status(201).json({
      success: true,
      message: "Account created",
      ...result
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
}

function login(req, res) {
  try {
    const { email, password } = req.body || {};
    const result = authService.login(email, password);
    res.json({ success: true, ...result });
  } catch (error) {
    const status = error.message === "Invalid email or password" ? 401 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

function me(req, res) {
  res.json({ success: true, user: req.user });
}

function logout(req, res) {
  authService.deleteSession(req.authToken);
  res.json({ success: true, message: "Signed out" });
}

function createStaff(req, res) {
  try {
    const user = authService.createAdminAccount(req.body || {}, req.user);
    res.status(201).json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

module.exports = {
  createStaff,
  login,
  logout,
  me,
  registerCustomer
};
