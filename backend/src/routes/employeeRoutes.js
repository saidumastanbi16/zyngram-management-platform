const express = require("express");
const controller = require("../controllers/employeeController");
const { allowRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(allowRoles("ADMIN", "HQ", "COMMAND", "HUB", "CENTER", "EMPLOYEE"));

router.get("/employees/dashboard", controller.getDashboard);
router.get("/employees/reports", controller.getReports);
router.get("/employees/audit", controller.getAuditHistory);
router.get("/employees/notifications", controller.getNotifications);
router.patch("/employees/notifications/:id", controller.updateNotification);
router.get("/employees/me", controller.getMyProfile);
router.get("/employees", controller.getEmployees);
router.post("/employees", controller.createEmployee);
router.get("/employees/:id/documents", controller.getDocuments);
router.post("/employees/:id/documents", controller.uploadDocument);
router.get("/employees/:id", controller.getEmployee);
router.put("/employees/:id", controller.updateEmployee);
router.patch("/employees/:id/status", controller.updateEmployeeStatus);

router.get("/departments", controller.getCollection("Departments", "departments"));
router.post("/departments", controller.createCollection("Departments", "department"));
router.put("/departments/:id", controller.updateCollection("Departments", "department"));
router.patch("/departments/:id/status", controller.updateCollection("Departments", "department", true));
router.get("/designations", controller.getCollection("Designations", "designations"));
router.post("/designations", controller.createCollection("Designations", "designation"));
router.put("/designations/:id", controller.updateCollection("Designations", "designation"));
router.patch("/designations/:id/status", controller.updateCollection("Designations", "designation", true));
router.get("/work-locations", controller.getCollection("WorkLocations", "work_locations"));
router.post("/work-locations", controller.createCollection("WorkLocations", "work_location"));
router.put("/work-locations/:id", controller.updateCollection("WorkLocations", "work_location"));
router.patch("/work-locations/:id/status", controller.updateCollection("WorkLocations", "work_location", true));

router.post("/attendance/check-in", controller.checkIn);
router.post("/attendance/check-out", controller.checkOut);
router.get("/attendance", controller.getAttendance);
router.post("/attendance", controller.recordAttendance);
router.get("/leaves", controller.getLeaves);
router.post("/leaves", controller.submitLeave);
router.get("/leaves/:id/document", controller.getLeaveDocument);
router.patch("/leaves/:id/approve", controller.decideLeave("approve"));
router.patch("/leaves/:id/reject", controller.decideLeave("reject"));
router.patch("/leaves/:id/cancel", controller.cancelLeave);
router.get("/targets", controller.getTargets);
router.post("/targets", controller.createTarget);
router.put("/targets/:id", controller.updateTarget);
router.get("/documents/:id/download", controller.downloadDocument);
router.delete("/documents/:id", controller.deleteDocument);

module.exports = router;
