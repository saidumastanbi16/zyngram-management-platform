const service = require("../services/employeeService");
const { recordAudit } = require("../utils/auditLog");

function auditDenial(req, res, error) {
  if (error.status !== 403 || !req.user) return null;
  try {
    recordAudit({
      actor: req.user,
      action: "AUTHORIZATION_DENIED",
      entity: "EmployeeAPI",
      result: "DENIED",
      metadata: { method: req.method, path: req.originalUrl, reason: error.message }
    });
    return null;
  } catch (auditError) {
    console.error("Employee authorization audit error:", auditError);
    return res.status(500).json({ success: false, message: "Unable to record authorization denial" });
  }
}

function handle(res, operation, status = 200) {
  try {
    const result = operation();
    return res.status(status).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof service.EmployeeError) {
      const auditResponse = auditDenial(res.req, res, error);
      if (auditResponse) return auditResponse;
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Employee management API error:", error);
    return res.status(500).json({ success: false, message: "Unable to complete employee management request" });
  }
}

function getEmployees(req, res) {
  return handle(res, () => service.listEmployees(req.query, req.user));
}

function createEmployee(req, res) {
  return handle(res, () => ({ employee: service.createEmployee(req.body || {}, req.user) }), 201);
}

function getEmployee(req, res) {
  return handle(res, () => ({ employee: service.employeeProfile(req.params.id, req.user) }));
}

function getMyProfile(req, res) {
  return handle(res, () => ({ employee: service.employeeProfile("me", req.user) }));
}

function updateEmployee(req, res) {
  return handle(res, () => ({ employee: service.updateEmployee(req.params.id, req.body || {}, req.user) }));
}

function updateEmployeeStatus(req, res) {
  return handle(res, () => ({ employee: service.updateEmployeeStatus(req.params.id, req.body || {}, req.user) }));
}

function getCollection(collection, key) {
  return (req, res) => handle(res, () => ({ [key]: service.listCollection(collection, req.user) }));
}

function createCollection(collection, key) {
  return (req, res) => handle(res, () => ({ [key]: service.saveReferenceCollection(collection, req.body || {}, req.user) }), 201);
}

function updateCollection(collection, key, statusOnly = false) {
  return (req, res) => handle(res, () => ({
    [key]: service.updateReferenceCollection(collection, req.params.id, req.body || {}, req.user, statusOnly)
  }));
}

function getAttendance(req, res) {
  return handle(res, () => {
    let records = service.listCollection("Attendance", req.user);
    if (req.query.from) records = records.filter(item => item.date >= req.query.from);
    if (req.query.to) records = records.filter(item => item.date <= req.query.to);
    if (req.query.employee_id) records = records.filter(item => item.employee_id === req.query.employee_id);
    return { attendance: records.slice().sort((a, b) => b.date.localeCompare(a.date)) };
  });
}

function checkIn(req, res) {
  return handle(res, () => ({ attendance: service.checkIn(req.body || {}, req.user) }), 201);
}

function checkOut(req, res) {
  return handle(res, () => ({ attendance: service.checkOut(req.body || {}, req.user) }));
}

function recordAttendance(req, res) {
  return handle(res, () => ({ attendance: service.recordAttendance(req.body || {}, req.user) }), 201);
}

function getLeaves(req, res) {
  return handle(res, () => {
    let leaves = service.listCollection("LeaveRequests", req.user);
    if (req.query.status) leaves = leaves.filter(item => item.status === String(req.query.status).toUpperCase());
    return { leaves: leaves.slice().sort((a, b) => b.requested_at.localeCompare(a.requested_at)) };
  });
}

function getLeaveDocument(req, res) {
  try {
    const document = service.getLeaveDocument(req.params.id, req.user);
    res.type(document.mime_type);
    res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(document.file_name)}"`);
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(Buffer.from(document.content_base64, "base64"));
  } catch (error) {
    if (error instanceof service.EmployeeError) {
      const auditResponse = auditDenial(req, res, error);
      if (auditResponse) return auditResponse;
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Leave document download error:", error);
    return res.status(500).json({ success: false, message: "Unable to download supporting document" });
  }
}

function submitLeave(req, res) {
  return handle(res, () => ({ leave: service.submitLeave(req.body || {}, req.user) }), 201);
}

function cancelLeave(req, res) {
  return handle(res, () => ({ leave: service.cancelLeave(req.params.id, req.user) }));
}

function decideLeave(decision) {
  return (req, res) => handle(res, () => ({
    leave: service.decideLeave(req.params.id, decision, req.body || {}, req.user)
  }));
}

function getTargets(req, res) {
  return handle(res, () => ({ targets: service.listCollection("Targets", req.user) }));
}

function createTarget(req, res) {
  return handle(res, () => ({ target: service.createTarget(req.body || {}, req.user) }), 201);
}

function updateTarget(req, res) {
  return handle(res, () => ({ target: service.updateTarget(req.params.id, req.body || {}, req.user) }));
}

function getDocuments(req, res) {
  return handle(res, () => ({ documents: service.getDocuments(req.params.id, req.user) }));
}

function uploadDocument(req, res) {
  return handle(res, () => ({
    document: service.addDocument(req.params.id, req.body || {}, req.user)
  }), 201);
}

function downloadDocument(req, res) {
  try {
    const document = service.downloadDocument(req.params.id, req.user);
    res.type(document.mime_type || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(document.file_name)}"`);
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(Buffer.from(document.content_base64, "base64"));
  } catch (error) {
    if (error instanceof service.EmployeeError) {
      const auditResponse = auditDenial(req, res, error);
      if (auditResponse) return auditResponse;
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Employee document download error:", error);
    return res.status(500).json({ success: false, message: "Unable to download employee document" });
  }
}

function deleteDocument(req, res) {
  return handle(res, () => ({ document: service.deleteDocument(req.params.id, req.user) }));
}

function getDashboard(req, res) {
  return handle(res, () => ({ dashboard: service.dashboard(req.user) }));
}

function getReports(req, res) {
  return handle(res, () => ({ reports: service.reports(req.query, req.user) }));
}

function getAuditHistory(req, res) {
  return handle(res, () => ({ logs: service.auditHistory(req.user) }));
}

function getNotifications(req, res) {
  return handle(res, () => ({ notifications: service.getNotifications(req.user) }));
}

function updateNotification(req, res) {
  return handle(res, () => ({ notification: service.editNotification(req.params.id, req.body || {}, req.user) }));
}

module.exports = {
  cancelLeave,
  createCollection,
  createEmployee,
  createTarget,
  decideLeave,
  deleteDocument,
  downloadDocument,
  getAuditHistory,
  getAttendance,
  getCollection,
  getDashboard,
  getDocuments,
  getEmployee,
  getEmployees,
  getLeaves,
  getLeaveDocument,
  getMyProfile,
  getNotifications,
  getReports,
  getTargets,
  recordAttendance,
  submitLeave,
  updateCollection,
  updateEmployee,
  updateEmployeeStatus,
  updateNotification,
  updateTarget,
  uploadDocument,
  checkIn,
  checkOut
};
