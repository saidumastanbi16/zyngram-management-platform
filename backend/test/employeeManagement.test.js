const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-employees-${crypto.randomUUID()}.json`);
const previous = {
  dataFile: process.env.ZYNGRAM_DATA_FILE,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
};
process.env.ZYNGRAM_DATA_FILE = fixture;
process.env.ADMIN_EMAIL = "employee-admin@example.invalid";
process.env.ADMIN_PASSWORD = "safe-test-password";
fs.writeFileSync(fixture, JSON.stringify({
  Users: [], AuthAccounts: [], AuditLogs: [], Franchises: [], GeoBoundaries: [],
  UserLocations: [], Orders: [], OrderAttribution: [], CommissionRules: [], CommissionLedger: []
}));

const app = require("../server");
const franchiseService = require("../src/services/franchiseService");
const server = app.listen(0, "127.0.0.1");

function request(baseUrl, endpoint, { method = "GET", token, body } = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async response => ({
    status: response.status,
    body: response.headers.get("content-type")?.includes("application/json")
      ? await response.json() : await response.text()
  }));
}

test("employee lifecycle, scope, self-service, documents and audit are enforced by the API", async t => {
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
    for (const [key, value] of Object.entries({
      ZYNGRAM_DATA_FILE: previous.dataFile,
      ADMIN_EMAIL: previous.adminEmail,
      ADMIN_PASSWORD: previous.adminPassword
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const adminLogin = await request(api, "/auth/login", {
    method: "POST", body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.body.token;

  const franchiseA = franchiseService.createFranchise({ level: "Command", name: "Employee Scope A", owner_id: "OWNER-A" });
  const franchiseB = franchiseService.createFranchise({ level: "Command", name: "Employee Scope B", owner_id: "OWNER-B" });
  const managers = {};
  for (const [name, franchise] of [["a", franchiseA], ["b", franchiseB]]) {
    const created = await request(api, "/auth/admins", {
      method: "POST", token: adminToken,
      body: {
        name: `Manager ${name}`, email: `manager-${name}@example.invalid`,
        mobile: "15550001010", password: "safe-test-password", role: "COMMAND",
        franchise_id: franchise.id
      }
    });
    assert.equal(created.status, 201);
    const login = await request(api, "/auth/login", {
      method: "POST",
      body: { email: `manager-${name}@example.invalid`, password: "safe-test-password" }
    });
    assert.equal(login.status, 200);
    managers[name] = login.body.token;
  }

  const department = await request(api, "/departments", { method: "POST", token: adminToken, body: { name: "Operations" } });
  assert.equal(department.status, 201);
  const designation = await request(api, "/designations", {
    method: "POST", token: adminToken,
    body: { name: "Associate", department_id: department.body.department.id }
  });
  assert.equal(designation.status, 201);
  const workLocation = await request(api, "/work-locations", {
    method: "POST", token: adminToken, body: { name: "Visakhapatnam Office" }
  });
  assert.equal(workLocation.status, 201);
  const departments = await request(api, "/departments", { token: adminToken });
  assert.equal(departments.body.departments.length, 1);
  assert.equal((await request(api, "/departments", { method: "PUT", token: adminToken, body: { name: "No ID" } })).status, 404);

  const employeePayload = (name, suffix, franchise_id) => ({
    name, email: `${suffix}@example.invalid`, mobile: "15550002010",
    password: "employee-safe-password", joining_date: new Date().toISOString().slice(0, 10),
    employment_type: "FULL_TIME", franchise_id, department: "Operations", designation: "Associate",
    work_location: "Visakhapatnam Office", state: "Andhra Pradesh", district: "Visakhapatnam"
  });
  const employeeA = await request(api, "/employees", {
    method: "POST", token: managers.a, body: employeePayload("Employee A", "employee-a", franchiseA.id)
  });
  const employeeB = await request(api, "/employees", {
    method: "POST", token: managers.b, body: employeePayload("Employee B", "employee-b", franchiseB.id)
  });
  assert.equal(employeeA.status, 201);
  assert.equal(employeeB.status, 201);
  const employeeAId = employeeA.body.employee.id;
  const employeeBId = employeeB.body.employee.id;
  const adminList = await request(api, "/employees?page=1&pageSize=10&sortBy=joining_date&sortOrder=desc", { token: adminToken });
  assert.equal(adminList.body.count, 2);
  const mismatchedDesignation = await request(api, "/employees", {
    method: "POST", token: managers.a,
    body: { ...employeePayload("Invalid Employee", "employee-invalid", franchiseA.id), designation: "Missing role" }
  });
  assert.equal(mismatchedDesignation.status, 400);

  const scopedList = await request(api, "/employees?page=1&pageSize=1&status=ACTIVE&department=Operations&state=Andhra%20Pradesh", { token: managers.a });
  assert.equal(scopedList.status, 200);
  assert.equal(scopedList.body.count, 1);
  assert.equal(scopedList.body.employees[0].id, employeeAId);
  assert.equal((await request(api, "/employees/dashboard", { token: managers.a })).body.dashboard.employees, 1);
  assert.equal((await request(api, "/employees/reports", { token: managers.a })).status, 200);
  assert.equal((await request(api, `/employees/${employeeBId}`, { token: managers.a })).status, 403);
  assert.equal((await request(api, `/employees/${employeeBId}`, {
    method: "PUT", token: managers.a, body: { name: "Cross Franchise Edit" }
  })).status, 403);
  assert.equal((await request(api, `/employees/${employeeBId}/status`, {
    method: "PATCH", token: managers.a, body: { status: "TERMINATED" }
  })).status, 403);
  assert.equal((await request(api, "/employees", { method: "POST", token: managers.a, body: employeePayload("Out of Scope", "scope-error", franchiseB.id) })).status, 403);
  const update = await request(api, `/employees/${employeeAId}`, {
    method: "PUT", token: managers.a, body: { name: "Employee A Updated", district: "Anakapalle" }
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.employee.name, "Employee A Updated");
  assert.equal(update.body.employee.district, "Anakapalle");
  const departmentRename = await request(api, `/departments/${department.body.department.id}`, {
    method: "PUT", token: adminToken, body: { name: "Field Operations" }
  });
  assert.equal(departmentRename.status, 200);
  assert.equal((await request(api, `/employees/${employeeAId}`, { token: managers.a })).body.employee.department, "Field Operations");

  const employeeLogin = await request(api, "/auth/login", {
    method: "POST", body: { email: "employee-a@example.invalid", password: "employee-safe-password" }
  });
  assert.equal(employeeLogin.status, 200);
  const employeeToken = employeeLogin.body.token;
  assert.equal((await request(api, "/employees/me", { token: employeeToken })).body.employee.id, employeeAId);
  assert.equal((await request(api, "/employees/notifications", { token: employeeToken })).status, 200);
  assert.equal((await request(api, `/employees/${employeeBId}`, { token: employeeToken })).status, 403);
  assert.equal((await request(api, "/departments", { method: "POST", token: employeeToken, body: { name: "Unauthorized" } })).status, 403);
  const customerRegistered = await request(api, "/auth/register", {
    method: "POST",
    body: { name: "API Customer", email: "api-customer@example.invalid", mobile: "15550009999", password: "customer-safe-password" }
  });
  assert.equal(customerRegistered.status, 201);
  assert.equal((await request(api, "/departments", { token: customerRegistered.body.token })).status, 403);
  const hq = await request(api, "/auth/admins", {
    method: "POST", token: adminToken,
    body: { name: "Read Only HQ", email: "employee-hq@example.invalid", mobile: "15550001011", password: "safe-test-password", role: "HQ" }
  });
  assert.equal(hq.status, 201);
  const hqLogin = await request(api, "/auth/login", {
    method: "POST", body: { email: "employee-hq@example.invalid", password: "safe-test-password" }
  });
  assert.equal((await request(api, "/employees", {
    method: "POST", token: hqLogin.body.token, body: employeePayload("HQ Write Attempt", "hq-write", franchiseA.id)
  })).status, 403);

  const today = new Date().toISOString().slice(0, 10);
  const attendance = await request(api, "/attendance/check-in", { method: "POST", token: employeeToken, body: {} });
  assert.equal(attendance.status, 201);
  assert.equal((await request(api, "/attendance", { token: employeeToken })).body.attendance.length, 1);
  const checkOut = await request(api, "/attendance/check-out", { method: "POST", token: employeeToken, body: {} });
  assert.equal(checkOut.status, 200);
  assert.ok(checkOut.body.attendance.working_hours >= 0);
  assert.equal((await request(api, "/attendance", {
    method: "POST", token: employeeToken,
    body: { employee_id: employeeBId, date: today, status: "PRESENT" }
  })).status, 403);

  const leaveDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const leave = await request(api, "/leaves", {
    method: "POST", token: employeeToken,
    body: {
      leave_type: "Annual", start_date: leaveDate, end_date: leaveDate, reason: "Personal request",
      supporting_document: "dGVzdA==", supporting_document_name: "leave-note.txt",
      supporting_document_type: "text/plain"
    }
  });
  assert.equal(leave.status, 201);
  assert.deepEqual(leave.body.leave.supporting_document, { file_name: "leave-note.txt", mime_type: "text/plain" });
  assert.equal((await request(api, `/leaves/${leave.body.leave.id}/document`, { token: managers.b })).status, 403);
  const leaveDocument = await request(api, `/leaves/${leave.body.leave.id}/document`, { token: managers.a });
  assert.equal(leaveDocument.status, 200);
  assert.equal(leaveDocument.body, "test");
  const approved = await request(api, `/leaves/${leave.body.leave.id}/approve`, { method: "PATCH", token: managers.a, body: {} });
  assert.equal(approved.body.leave.status, "APPROVED");
  const attendanceAfterLeave = await request(api, "/attendance", { token: employeeToken });
  assert.ok(attendanceAfterLeave.body.attendance.some(item => item.status === "LEAVE" && item.date === leaveDate));
  assert.equal((await request(api, "/attendance/check-in", { method: "POST", token: employeeToken, body: { date: leaveDate } })).status, 403);

  const target = await request(api, "/targets", {
    method: "POST", token: managers.a,
    body: { employee_id: employeeAId, period: "2026-10", target_type: "Business", target_value: 1000, achievement: 750 }
  });
  assert.equal(target.status, 201);
  assert.equal(target.body.target.achievement_percentage, 75);
  const targetUpdate = await request(api, `/targets/${target.body.target.id}`, {
    method: "PUT", token: managers.a, body: { achievement: 900 }
  });
  assert.equal(targetUpdate.status, 200);
  assert.equal(targetUpdate.body.target.achievement_percentage, 90);
  assert.equal((await request(api, "/targets", { token: employeeToken })).body.targets[0].achievement_percentage, 90);

  const document = await request(api, `/employees/${employeeAId}/documents`, {
    method: "POST", token: managers.a,
    body: { file_name: "proof.txt", document_type: "Identity", mime_type: "text/plain", content_base64: "dGVzdA==" }
  });
  assert.equal(document.status, 201);
  const unsupportedDocument = await request(api, `/employees/${employeeAId}/documents`, {
    method: "POST", token: managers.a,
    body: { file_name: "unsafe.html", document_type: "Other", mime_type: "text/html", content_base64: "dGVzdA==" }
  });
  assert.equal(unsupportedDocument.status, 400);
  const download = await request(api, `/documents/${document.body.document.id}/download`, { token: managers.a });
  assert.equal(download.status, 200);
  assert.equal(download.body, "test");
  assert.equal((await request(api, `/documents/${document.body.document.id}/download`, { token: managers.b })).status, 403);
  assert.equal((await request(api, `/documents/${document.body.document.id}/download`)).status, 401);
  assert.equal((await request(api, `/documents/${document.body.document.id}`, { method: "DELETE", token: managers.a })).status, 200);
  assert.equal((await request(api, `/documents/${document.body.document.id}/download`, { token: managers.a })).status, 404);

  const resigned = await request(api, `/employees/${employeeAId}/status`, {
    method: "PATCH", token: managers.a, body: { status: "RESIGNED" }
  });
  assert.equal(resigned.status, 200);
  assert.equal((await request(api, "/employees/me", { token: employeeToken })).status, 401);
  assert.equal((await request(api, "/attendance", {
    method: "POST", token: managers.a,
    body: { employee_id: employeeAId, date: today, status: "PRESENT" }
  })).status, 409);
  assert.equal((await request(api, "/auth/login", {
    method: "POST", body: { email: "employee-a@example.invalid", password: "employee-safe-password" }
  })).status, 401);
  const logs = JSON.parse(fs.readFileSync(fixture, "utf8")).AuditLogs;
  assert.ok(logs.some(item => item.action === "EMPLOYEE_CREATED"));
  assert.ok(logs.some(item => item.action === "LEAVE_APPROVED"));
  assert.ok(logs.some(item => item.action === "DOCUMENT_DOWNLOADED"));
  assert.ok(logs.some(item => item.action === "AUTHORIZATION_DENIED" && item.entity === "EmployeeAPI"));
});
