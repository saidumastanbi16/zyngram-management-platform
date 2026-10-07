const authService = require("../services/authService");
const { recordAudit } = require("../utils/auditLog");

function authenticate(req, res, next) {
  if (req.path === "/health") return next();

  const authorization = req.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");
  const user = scheme === "Bearer" && token ? authService.getSession(token) : null;

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Sign in to access this resource"
    });
  }

  req.user = user;
  req.authToken = token;
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      try {
        recordAudit({
          actor: req.user,
          action: "AUTHORIZATION_DENIED",
          entity: "API",
          result: "DENIED",
          metadata: { method: req.method, path: req.originalUrl, role: req.user?.role || "ANONYMOUS" }
        });
      } catch (error) {
        console.error("Authorization denial audit error:", error);
        return res.status(500).json({
          success: false,
          message: "Unable to record authorization denial"
        });
      }
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action"
      });
    }
    next();
  };
}

module.exports = { allowRoles, authenticate };
