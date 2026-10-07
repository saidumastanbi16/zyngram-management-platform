const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { hashPassword } = require("./authService");
const store = require("./dataStore");

const schemaPath = process.env.ZYNGRAM_DATA_FILE || path.join(__dirname, "../../data/schema.json");
const collections = [
  "Employees", "Departments", "Designations", "Attendance", "LeaveRequests", "Targets",
  "PerformanceRecords", "EmployeeDocuments", "WorkLocations", "EmployeeFranchiseMapping",
  "Notifications"
];
const managerRoles = ["COMMAND", "HUB", "CENTER"];
const employeeStatuses = ["ACTIVE", "INACTIVE", "RESIGNED", "TERMINATED"];
const attendanceStatuses = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEK_OFF"];
const leaveStatuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
const allowedDocumentTypes = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const id = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

class EmployeeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function readData() {
  const data = store.readData();
  for (const collection of collections) data[collection] = data[collection] || [];
  data.Users = data.Users || [];
  data.AuthAccounts = data.AuthAccounts || [];
  data.Franchises = data.Franchises || [];
  data.AuditLogs = data.AuditLogs || [];
  return data;
}

function saveData(data) {
  store.writeData(data);
}

function ensureEmployeeCollections() {
  const data = store.readData();
  let changed = false;
  for (const collection of [...collections, "Users", "AuthAccounts", "Franchises", "AuditLogs"]) {
    if (!Object.prototype.hasOwnProperty.call(data, collection)) {
      data[collection] = [];
      changed = true;
    } else if (!Array.isArray(data[collection])) {
      throw new Error(`Employee data migration expected ${collection} to be an array`);
    }
  }
  if (changed) saveData(data);
}

function audit(data, actor, action, entity, entityId, oldValue, newValue) {
  data.AuditLogs.push({
    id: id("AUD"),
    timestamp: new Date().toISOString(),
    actor_id: actor.id,
    role: actor.role,
    action,
    entity,
    entity_id: entityId,
    result: "SUCCESS",
    metadata: {
      ...(oldValue === undefined ? {} : { old_value: oldValue }),
      ...(newValue === undefined ? {} : { new_value: newValue })
    }
  });
}

function isAdmin(user) {
  return user.role === "ADMIN";
}

function isManager(user) {
  return isAdmin(user) || managerRoles.includes(user.role);
}

function franchiseScope(data, user) {
  if (isAdmin(user) || user.role === "HQ") return new Set(data.Franchises.map(item => item.id));
  if (!managerRoles.includes(user.role) || !user.franchise_id) return new Set();
  const assigned = data.Franchises.find(item =>
    item.id === user.franchise_id && item.owner_id === user.id && item.status === "ACTIVE"
  );
  if (!assigned) return new Set();
  const visible = new Set([assigned.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const franchise of data.Franchises) {
      if (franchise.parent_id && visible.has(franchise.parent_id) && !visible.has(franchise.id)) {
        visible.add(franchise.id);
        changed = true;
      }
    }
  }
  return visible;
}

function employeeVisible(data, employee, user) {
  if (isAdmin(user) || user.role === "HQ") return true;
  if (user.role === "EMPLOYEE") return employee.user_id === user.id;
  return franchiseScope(data, user).has(employee.franchise_id);
}

function requireManager(user, message = "Only an administrator or authorized franchise manager can perform this action") {
  if (!isManager(user)) throw new EmployeeError(message, 403);
}

function requireSelfOrManager(user, message = "Only an employee or authorized manager can perform this action") {
  if (user.role !== "EMPLOYEE" && !isManager(user)) throw new EmployeeError(message, 403);
}

function getEmployee(data, employeeId, user) {
  const employee = data.Employees.find(item =>
    item.id === employeeId ||
    item.employee_id === employeeId ||
    (user.role === "EMPLOYEE" && (employeeId === "me" || item.user_id === employeeId) && item.user_id === user.id)
  );
  if (!employee) throw new EmployeeError("Employee not found", 404);
  if (!employeeVisible(data, employee, user)) throw new EmployeeError("You do not have access to this employee", 403);
  return employee;
}

function safeEmployee(employee) {
  const { login_password, ...safe } = employee;
  return safe;
}

function validateText(value, label, min = 1, max = 120) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new EmployeeError(`${label} must be between ${min} and ${max} characters`);
  }
  return value.trim();
}

function validateDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new EmployeeError(`${label} must be a valid date (YYYY-MM-DD)`);
  }
  return value;
}

function validateEmail(value) {
  const email = validateText(value, "Email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EmployeeError("Enter a valid email address");
  return email;
}

function validateMobile(value) {
  const mobile = validateText(value, "Mobile", 7, 20);
  if (!/^[+]?[\d\s()-]{7,20}$/.test(mobile)) throw new EmployeeError("Enter a valid mobile number");
  return mobile;
}

function validatePhotoUrl(value) {
  if (!value) return "";
  const url = validateText(value, "Profile photo URL", 1, 500);
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid protocol");
  } catch {
    throw new EmployeeError("Profile photo URL must be a valid HTTP or HTTPS URL");
  }
  return url;
}

function ratingFromAchievement(percentage) {
  if (percentage >= 100) return "EXCEEDS";
  if (percentage >= 75) return "MEETS";
  return "BELOW";
}

function ensureUniqueEmail(data, email, exceptUserId) {
  const duplicate = data.AuthAccounts.some(account =>
    account.user_id !== exceptUserId && String(account.email).toLowerCase() === email
  ) || data.Users.some(user =>
    user.id !== exceptUserId && String(user.email || "").toLowerCase() === email
  );
  if (duplicate) throw new EmployeeError("An account with this email already exists", 409);
}

function validateEmployeeReferences(data, employee) {
  const department = employee.department
    ? data.Departments.find(item => item.name.toLowerCase() === employee.department.toLowerCase() && item.status === "ACTIVE")
    : null;
  if (employee.department && !department) throw new EmployeeError("Choose an active department");
  const designation = employee.designation
    ? data.Designations.find(item => item.name.toLowerCase() === employee.designation.toLowerCase() && item.status === "ACTIVE")
    : null;
  if (employee.designation && !designation) throw new EmployeeError("Choose an active designation");
  if (designation?.department_id && designation.department_id !== department?.id) {
    throw new EmployeeError("The selected designation is linked to a different department");
  }
  if (employee.work_location && !data.WorkLocations.some(item =>
    item.name.toLowerCase() === employee.work_location.toLowerCase() && item.status === "ACTIVE"
  )) {
    throw new EmployeeError("Choose an active work location");
  }
  if (employee.zin_id && data.Employees.some(item =>
    item.id !== employee.id && String(item.zin_id || "").toLowerCase() === employee.zin_id.toLowerCase()
  )) {
    throw new EmployeeError("ZIN ID already exists", 409);
  }
  employee.department_id = department?.id || null;
  employee.designation_id = designation?.id || null;
}

function listEmployees(query, user) {
  const data = readData();
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize || query.limit, 10) || 10));
  const search = String(query.search || "").trim().toLowerCase();
  const sortBy = ["name", "employee_id", "joining_date", "status", "department", "designation"].includes(query.sortBy)
    ? query.sortBy : "name";
  const direction = query.sortOrder === "desc" ? -1 : 1;
  let employees = data.Employees.filter(employee => employeeVisible(data, employee, user));
  const filters = ["department", "designation", "franchise_id", "state", "district", "employment_type", "status"];
  for (const key of filters) {
    if (query[key]) employees = employees.filter(employee =>
      String(employee[key] || "").toLowerCase() === String(query[key]).toLowerCase()
    );
  }
  for (const key of ["fromJoiningDate", "toJoiningDate"]) {
    if (query[key]) validateDate(String(query[key]), key);
  }
  if (query.fromJoiningDate) employees = employees.filter(employee => employee.joining_date >= query.fromJoiningDate);
  if (query.toJoiningDate) employees = employees.filter(employee => employee.joining_date <= query.toJoiningDate);
  if (search) {
    employees = employees.filter(employee =>
      ["employee_id", "zin_id", "name", "mobile", "email", "department", "designation", "franchise_id", "franchise_name", "state", "district", "employment_type", "status"]
        .some(key => String(employee[key] || "").toLowerCase().includes(search))
    );
  }
  employees.sort((a, b) => String(a[sortBy] || "").localeCompare(String(b[sortBy] || "")) * direction);
  return {
    employees: employees.slice((page - 1) * pageSize, page * pageSize).map(safeEmployee),
    count: employees.length,
    page,
    pageSize,
    pages: Math.ceil(employees.length / pageSize)
  };
}

function createEmployee(input, actor) {
  requireManager(actor);
  const data = readData();
  const name = validateText(input.name, "Name", 2, 100);
  const email = validateEmail(input.email);
  const mobile = validateMobile(input.mobile);
  const password = validateText(input.password, "Initial password", 8, 128);
  const franchiseId = validateText(input.franchise_id, "Franchise");
  if (!franchiseScope(data, actor).has(franchiseId)) throw new EmployeeError("You cannot assign employees outside your franchise scope", 403);
  const franchise = data.Franchises.find(item => item.id === franchiseId && item.status === "ACTIVE");
  if (!franchise) throw new EmployeeError("Choose an active franchise");
  ensureUniqueEmail(data, email);
  const employeeId = input.employee_id
    ? validateText(input.employee_id, "Employee ID", 2, 50)
    : id("EMP");
  if (data.Employees.some(item => item.employee_id === employeeId)) throw new EmployeeError("Employee ID already exists", 409);
  const status = String(input.status || "ACTIVE").toUpperCase();
  if (!employeeStatuses.includes(status)) throw new EmployeeError("Choose a valid employee status");
  const createdAt = new Date().toISOString();
  const userId = id("EMP");
  const accountPassword = hashPassword(password);
  const department = String(input.department || "").trim();
  const designation = String(input.designation || "").trim();
  const employmentType = String(input.employment_type || "FULL_TIME").toUpperCase();
  if (!["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"].includes(employmentType)) {
    throw new EmployeeError("Choose a valid employment type");
  }
  const employee = {
    id: employeeId,
    employee_id: employeeId,
    user_id: userId,
    zin_id: String(input.zin_id || "").trim(),
    name,
    mobile,
    email,
    date_of_birth: input.date_of_birth ? validateDate(input.date_of_birth, "Date of birth") : null,
    gender: String(input.gender || "").trim(),
    address: String(input.address || "").trim(),
    profile_photo_url: validatePhotoUrl(input.profile_photo_url),
    state: String(input.state || "").trim(),
    district: String(input.district || "").trim(),
    department,
    department_id: null,
    designation,
    designation_id: null,
    employment_type: employmentType,
    joining_date: validateDate(input.joining_date, "Joining date"),
    reporting_manager: String(input.reporting_manager || "").trim(),
    work_location: String(input.work_location || "").trim(),
    franchise_id: franchise.id,
    franchise_name: franchise.name,
    status,
    created_at: createdAt,
    updated_at: createdAt
  };
  validateEmployeeReferences(data, employee);
  data.Employees.push(employee);
  data.EmployeeFranchiseMapping.push({ id: id("EFM"), employee_id: employee.id, franchise_id: franchise.id });
  data.Users.push({
    id: userId, name, mobile, email, role: "EMPLOYEE", franchise_id: franchise.id,
    status: status === "ACTIVE" ? "ACTIVE" : "INACTIVE", created_at: createdAt
  });
  data.AuthAccounts.push({
    user_id: userId, name, email, salt: accountPassword.salt, password_hash: accountPassword.hash,
    role: "EMPLOYEE", franchise_id: franchise.id,
    status: status === "ACTIVE" ? "ACTIVE" : "INACTIVE", created_at: createdAt
  });
  audit(data, actor, "EMPLOYEE_CREATED", "Employee", employee.id, undefined, safeEmployee(employee));
  saveData(data);
  return safeEmployee(employee);
}

function updateEmployee(employeeId, input, actor) {
  requireManager(actor);
  const data = readData();
  const employee = getEmployee(data, employeeId, actor);
  const oldValue = safeEmployee({ ...employee });
  const allowed = [
    "zin_id", "name", "mobile", "email", "date_of_birth", "gender", "address", "state", "district",
    "department", "designation", "employment_type", "joining_date", "reporting_manager", "work_location",
    "franchise_id", "profile_photo_url"
  ];
  for (const key of allowed) {
    if (input[key] === undefined) continue;
    if (key === "franchise_id") {
      const franchiseId = validateText(input[key], "Franchise");
      if (!franchiseScope(data, actor).has(franchiseId) ||
        !data.Franchises.some(item => item.id === franchiseId && item.status === "ACTIVE")) {
        throw new EmployeeError("You cannot assign employees outside your active franchise scope", 403);
      }
      employee.franchise_id = franchiseId;
      employee.franchise_name = data.Franchises.find(item => item.id === franchiseId).name;
    } else if (key === "name") employee.name = validateText(input[key], "Name", 2, 100);
    else if (key === "mobile") employee.mobile = validateMobile(input[key]);
    else if (key === "email") {
      const email = validateEmail(input[key]);
      ensureUniqueEmail(data, email, employee.user_id);
      employee.email = email;
    }
    else if (key === "joining_date" || key === "date_of_birth") employee[key] = input[key] ? validateDate(input[key], key) : null;
    else if (key === "employment_type") {
      const employmentType = validateText(input[key], "Employment type", 2, 30).toUpperCase();
      if (!["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"].includes(employmentType)) {
        throw new EmployeeError("Choose a valid employment type");
      }
      employee.employment_type = employmentType;
    } else if (key === "profile_photo_url") {
      employee.profile_photo_url = validatePhotoUrl(input[key]);
    } else if (["zin_id", "department", "designation", "reporting_manager", "work_location"].includes(key)) {
      employee[key] = validateText(input[key], key, 0, key === "profile_photo_url" ? 500 : 120);
    } else employee[key] = validateText(input[key], key, 0, 500);
  }
  employee.updated_at = new Date().toISOString();
  const account = data.AuthAccounts.find(item => item.user_id === employee.user_id);
  const user = data.Users.find(item => item.id === employee.user_id);
  if (account) {
    account.name = employee.name;
    account.email = employee.email;
    account.franchise_id = employee.franchise_id;
  }
  if (user) {
    user.name = employee.name;
    user.email = employee.email;
    user.mobile = employee.mobile;
    user.franchise_id = employee.franchise_id;
  }
  for (const mapping of data.EmployeeFranchiseMapping.filter(item => item.employee_id === employee.id)) {
    mapping.franchise_id = employee.franchise_id;
  }
  validateEmployeeReferences(data, employee);
  audit(data, actor, "EMPLOYEE_UPDATED", "Employee", employee.id, oldValue, safeEmployee(employee));
  saveData(data);
  return safeEmployee(employee);
}

function updateEmployeeStatus(employeeId, input, actor) {
  requireManager(actor);
  const status = String(input.status || "").toUpperCase();
  if (!employeeStatuses.includes(status)) throw new EmployeeError(`Status must be ${employeeStatuses.join(", ")}`);
  const data = readData();
  const employee = getEmployee(data, employeeId, actor);
  const previous = employee.status;
  employee.status = status;
  employee.updated_at = new Date().toISOString();
  const account = data.AuthAccounts.find(item => item.user_id === employee.user_id);
  const user = data.Users.find(item => item.id === employee.user_id);
  if (account) account.status = status === "ACTIVE" ? "ACTIVE" : "INACTIVE";
  if (user) user.status = status === "ACTIVE" ? "ACTIVE" : "INACTIVE";
  data.Notifications.push({
    id: id("NTF"), employee_id: employee.id, type: "EMPLOYMENT_STATUS",
    message: `Your employment status is now ${status.toLowerCase()}.`,
    created_at: new Date().toISOString(), read: false
  });
  audit(data, actor, "EMPLOYEE_STATUS_CHANGED", "Employee", employee.id, { status: previous }, { status });
  saveData(data);
  return safeEmployee(employee);
}

function listCollection(collection, user, employeeId) {
  const data = readData();
  const employee = employeeId
    ? getEmployee(data, employeeId, user)
    : user.role === "EMPLOYEE" ? data.Employees.find(item => item.user_id === user.id) : null;
  if (collection === "Departments" || collection === "Designations" || collection === "WorkLocations") {
    return data[collection];
  }
  if (collection === "Attendance" || collection === "LeaveRequests" || collection === "Targets" || collection === "EmployeeDocuments") {
    if (user.role === "EMPLOYEE") {
      const records = data[collection].filter(item => item.employee_id === employee?.id);
      return collection === "LeaveRequests" ? records.map(safeLeave) : records;
    }
    const scope = franchiseScope(data, user);
    const records = data[collection].filter(item => {
      const recordEmployee = data.Employees.find(entry => entry.id === item.employee_id);
      return recordEmployee && employeeVisible(data, recordEmployee, user);
    });
    return collection === "LeaveRequests" ? records.map(safeLeave) : records;
  }
  throw new EmployeeError("Unsupported employee data collection", 404);
}

function saveReferenceCollection(collection, input, actor) {
  requireManager(actor);
  if (collection === "WorkLocations" && !isAdmin(actor)) {
    throw new EmployeeError("Only an administrator can manage work locations", 403);
  }
  const data = readData();
  const name = validateText(input.name, "Name", 2, 100);
  const existing = data[collection].find(item => item.name.toLowerCase() === name.toLowerCase());
  if (existing) throw new EmployeeError(`${collection === "Departments" ? "Department" : "Designation"} already exists`, 409);
  const item = {
    id: id(collection === "Departments" ? "DEP" : collection === "Designations" ? "DSG" : "WLC"),
    name,
    description: String(input.description || "").trim(),
    ...(collection === "Designations" && input.department_id ? { department_id: String(input.department_id) } : {}),
    status: "ACTIVE",
    created_at: new Date().toISOString()
  };
  if (collection === "Designations" && item.department_id && !data.Departments.some(entry => entry.id === item.department_id)) {
    throw new EmployeeError("Choose an existing department");
  }
  data[collection].push(item);
  audit(data, actor, `${collection.toUpperCase()}_CREATED`, collection.slice(0, -1), item.id, undefined, item);
  saveData(data);
  return item;
}

function updateReferenceCollection(collection, itemId, input, actor, statusOnly = false) {
  requireManager(actor);
  if (collection === "WorkLocations" && !isAdmin(actor)) {
    throw new EmployeeError("Only an administrator can manage work locations", 403);
  }
  const data = readData();
  const item = data[collection].find(entry => entry.id === itemId);
  if (!item) throw new EmployeeError("Record not found", 404);
  const oldValue = { ...item };
  let newName;
  if (statusOnly) {
    const status = String(input.status || "").toUpperCase();
    if (!["ACTIVE", "INACTIVE"].includes(status)) throw new EmployeeError("Status must be ACTIVE or INACTIVE");
    item.status = status;
  } else {
    if (input.name !== undefined) {
      newName = validateText(input.name, "Name", 2, 100);
      if (data[collection].some(entry => entry.id !== item.id && entry.name.toLowerCase() === newName.toLowerCase())) {
        throw new EmployeeError(`${collection.slice(0, -1)} already exists`, 409);
      }
      item.name = newName;
    }
    if (input.description !== undefined) item.description = validateText(input.description, "Description", 0, 500);
    if (collection === "Designations" && input.department_id !== undefined) {
      if (input.department_id && !data.Departments.some(entry => entry.id === input.department_id)) {
        throw new EmployeeError("Choose an existing department");
      }
      item.department_id = input.department_id || null;
    }
  }
  if (newName && collection === "Departments") {
    for (const employee of data.Employees.filter(entry => entry.department_id === item.id || entry.department === oldValue.name)) {
      const previous = employee.department;
      employee.department = newName;
      employee.updated_at = new Date().toISOString();
      audit(data, actor, "EMPLOYEE_DEPARTMENT_RENAMED", "Employee", employee.id, { department: previous }, { department: newName });
    }
  }
  if (newName && collection === "Designations") {
    for (const employee of data.Employees.filter(entry => entry.designation_id === item.id || entry.designation === oldValue.name)) {
      const previous = employee.designation;
      employee.designation = newName;
      employee.updated_at = new Date().toISOString();
      audit(data, actor, "EMPLOYEE_DESIGNATION_RENAMED", "Employee", employee.id, { designation: previous }, { designation: newName });
    }
  }
  if (newName && collection === "WorkLocations") {
    for (const employee of data.Employees.filter(entry => entry.work_location === oldValue.name)) {
      const previous = employee.work_location;
      employee.work_location = newName;
      employee.updated_at = new Date().toISOString();
      audit(data, actor, "EMPLOYEE_WORK_LOCATION_RENAMED", "Employee", employee.id, { work_location: previous }, { work_location: newName });
    }
  }
  audit(data, actor, `${collection.toUpperCase()}_UPDATED`, collection.slice(0, -1), item.id, oldValue, item);
  saveData(data);
  return item;
}

function checkIn(input, actor) {
  requireSelfOrManager(actor);
  const data = readData();
  const employee = actor.role === "EMPLOYEE"
    ? data.Employees.find(item => item.user_id === actor.id)
    : getEmployee(data, validateText(input.employee_id, "Employee"), actor);
  if (!employee || employee.status !== "ACTIVE") throw new EmployeeError("An active employee account is required", 403);
  const date = input.date ? validateDate(input.date, "Date") : new Date().toISOString().slice(0, 10);
  if (actor.role === "EMPLOYEE" && date !== new Date().toISOString().slice(0, 10)) {
    throw new EmployeeError("Employees can only check in for today", 403);
  }
  const attendance = data.Attendance.find(item => item.employee_id === employee.id && item.date === date);
  if (attendance?.status === "LEAVE") {
    throw new EmployeeError("Check-in is unavailable on an approved leave day", 409);
  }
  if (attendance?.check_in) throw new EmployeeError("Check-in is already recorded for this date", 409);
  const now = new Date().toISOString();
  const record = attendance || {
    id: id("ATT"), employee_id: employee.id, date, check_in: null, check_out: null,
    work_location: employee.work_location || "", status: "PRESENT", remarks: "", created_at: now
  };
  record.check_in = now;
  record.status = "PRESENT";
  if (!attendance) data.Attendance.push(record);
  audit(data, actor, "ATTENDANCE_CHECK_IN", "Attendance", record.id, undefined, { employee_id: employee.id, date, check_in: now });
  saveData(data);
  return record;
}

function checkOut(input, actor) {
  requireSelfOrManager(actor);
  const data = readData();
  const employee = actor.role === "EMPLOYEE"
    ? data.Employees.find(item => item.user_id === actor.id)
    : getEmployee(data, validateText(input.employee_id, "Employee"), actor);
  if (!employee || employee.status !== "ACTIVE") throw new EmployeeError("An active employee account is required", 403);
  const date = input.date ? validateDate(input.date, "Date") : new Date().toISOString().slice(0, 10);
  if (actor.role === "EMPLOYEE" && date !== new Date().toISOString().slice(0, 10)) {
    throw new EmployeeError("Employees can only check out for today", 403);
  }
  const record = data.Attendance.find(item => item.employee_id === employee.id && item.date === date);
  if (!record?.check_in) throw new EmployeeError("Check-in must be recorded before check-out", 409);
  if (record.check_out) throw new EmployeeError("Check-out is already recorded for this date", 409);
  record.check_out = new Date().toISOString();
  record.working_hours = Math.round(((Date.parse(record.check_out) - Date.parse(record.check_in)) / 3600000) * 100) / 100;
  audit(data, actor, "ATTENDANCE_CHECK_OUT", "Attendance", record.id, undefined, { check_out: record.check_out, working_hours: record.working_hours });
  saveData(data);
  return record;
}

function recordAttendance(input, actor) {
  requireManager(actor);
  const data = readData();
  const employee = getEmployee(data, validateText(input.employee_id, "Employee"), actor);
  if (employee.status !== "ACTIVE") throw new EmployeeError("Attendance cannot be recorded for an inactive employee", 409);
  const date = validateDate(input.date, "Date");
  const status = String(input.status || "").toUpperCase();
  if (!attendanceStatuses.includes(status)) throw new EmployeeError("Choose a valid attendance status");
  let record = data.Attendance.find(item => item.employee_id === employee.id && item.date === date);
  const oldValue = record ? { ...record } : undefined;
  if (!record) {
    record = { id: id("ATT"), employee_id: employee.id, date, created_at: new Date().toISOString() };
    data.Attendance.push(record);
  }
  for (const key of ["check_in", "check_out", "work_location", "remarks"]) {
    if (input[key] !== undefined) record[key] = String(input[key]).slice(0, 500);
  }
  record.status = status;
  if (record.check_in && record.check_out) {
    record.working_hours = Math.max(0, Math.round((Date.parse(record.check_out) - Date.parse(record.check_in)) / 36000) / 100);
  }
  audit(data, actor, "ATTENDANCE_RECORDED", "Attendance", record.id, oldValue, { ...record });
  saveData(data);
  return record;
}

function submitLeave(input, actor) {
  requireSelfOrManager(actor);
  const data = readData();
  const employee = actor.role === "EMPLOYEE"
    ? data.Employees.find(item => item.user_id === actor.id)
    : getEmployee(data, validateText(input.employee_id, "Employee"), actor);
  if (!employee || employee.status !== "ACTIVE") throw new EmployeeError("An active employee account is required", 403);
  const startDate = validateDate(input.start_date, "Start date");
  const endDate = validateDate(input.end_date, "End date");
  if (endDate < startDate) throw new EmployeeError("End date must not be before start date");
  if (data.LeaveRequests.some(leave =>
    leave.employee_id === employee.id &&
    ["PENDING", "APPROVED"].includes(leave.status) &&
    startDate <= leave.end_date &&
    endDate >= leave.start_date
  )) {
    throw new EmployeeError("This leave request overlaps an existing pending or approved request", 409);
  }
  const leave = {
    id: id("LVE"), employee_id: employee.id,
    leave_type: validateText(input.leave_type, "Leave type", 2, 60),
    start_date: startDate, end_date: endDate,
    reason: validateText(input.reason, "Reason", 2, 1000),
    supporting_document: String(input.supporting_document || "").slice(0, 300000),
    supporting_document_name: String(input.supporting_document_name || "").slice(0, 180),
    supporting_document_type: String(input.supporting_document_type || "").slice(0, 100),
    status: "PENDING",
    requested_at: new Date().toISOString()
  };
  if (leave.supporting_document && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(leave.supporting_document)) {
    throw new EmployeeError("Supporting document content must be valid base64");
  }
  data.LeaveRequests.push(leave);
  audit(data, actor, "LEAVE_SUBMITTED", "LeaveRequest", leave.id, undefined, safeLeave(leave));
  saveData(data);
  return safeLeave(leave);
}

function safeLeave(leave) {
  const {
    supporting_document: content,
    supporting_document_name: name,
    supporting_document_type: type,
    ...safe
  } = leave;
  if (content) safe.supporting_document = { file_name: name, mime_type: type };
  return safe;
}

function getLeaveDocument(leaveId, user) {
  const data = readData();
  const leave = data.LeaveRequests.find(item => item.id === leaveId);
  if (!leave || !leave.supporting_document) throw new EmployeeError("Supporting document not found", 404);
  const employee = getEmployee(data, leave.employee_id, user);
  if (user.role === "EMPLOYEE" && employee.user_id !== user.id) {
    throw new EmployeeError("You cannot access this leave document", 403);
  }
  audit(data, user, "LEAVE_DOCUMENT_DOWNLOADED", "LeaveRequest", leave.id, undefined, { employee_id: employee.id });
  saveData(data);
  return {
    content_base64: leave.supporting_document,
    file_name: leave.supporting_document_name || "leave-supporting-document",
    mime_type: leave.supporting_document_type || "application/octet-stream"
  };
}

function cancelLeave(leaveId, actor) {
  const data = readData();
  const leave = data.LeaveRequests.find(item => item.id === leaveId);
  if (!leave) throw new EmployeeError("Leave request not found", 404);
  const employee = getEmployee(data, leave.employee_id, actor);
  if (actor.role !== "EMPLOYEE" || employee.user_id !== actor.id) {
    throw new EmployeeError("Only the employee who submitted this leave can cancel it", 403);
  }
  if (leave.status !== "PENDING") throw new EmployeeError("Only pending leave requests can be cancelled", 409);
  const oldValue = { ...leave };
  leave.status = "CANCELLED";
  leave.cancelled_at = new Date().toISOString();
  audit(data, actor, "LEAVE_CANCELLED", "LeaveRequest", leave.id, safeLeave(oldValue), safeLeave(leave));
  saveData(data);
  return leave;
}

function decideLeave(leaveId, decision, input, actor) {
  requireManager(actor);
  const data = readData();
  const leave = data.LeaveRequests.find(item => item.id === leaveId);
  if (!leave) throw new EmployeeError("Leave request not found", 404);
  const employee = getEmployee(data, leave.employee_id, actor);
  if (leave.status !== "PENDING") throw new EmployeeError("Only pending leave requests can be decided", 409);
  if (decision === "approve" && employee.status !== "ACTIVE") {
    throw new EmployeeError("Leave cannot be approved for an inactive employee", 409);
  }
  if (decision === "approve" && data.Attendance.some(item =>
    item.employee_id === employee.id &&
    item.date >= leave.start_date &&
    item.date <= leave.end_date &&
    (item.check_in || item.check_out)
  )) {
    throw new EmployeeError("Leave cannot be approved for a day with recorded check-in or check-out", 409);
  }
  const status = decision === "approve" ? "APPROVED" : "REJECTED";
  const oldValue = { ...leave };
  leave.status = status;
  leave.reviewed_by = actor.id;
  leave.reviewed_at = new Date().toISOString();
  leave.review_remarks = String(input.remarks || "").slice(0, 500);
  if (status === "APPROVED") {
    let day = new Date(`${leave.start_date}T00:00:00Z`);
    const last = new Date(`${leave.end_date}T00:00:00Z`);
    while (day <= last) {
      const date = day.toISOString().slice(0, 10);
      let attendance = data.Attendance.find(item => item.employee_id === employee.id && item.date === date);
      if (!attendance) {
        attendance = { id: id("ATT"), employee_id: employee.id, date, status: "LEAVE", remarks: `Approved leave ${leave.id}`, created_at: new Date().toISOString() };
        data.Attendance.push(attendance);
      } else attendance.status = "LEAVE";
      day.setUTCDate(day.getUTCDate() + 1);
    }
  }
  data.Notifications.push({
    id: id("NTF"), employee_id: employee.id, type: "LEAVE_DECISION",
    message: `Your leave request (${leave.start_date} to ${leave.end_date}) was ${status.toLowerCase()}.`,
    created_at: new Date().toISOString(), read: false
  });
  audit(data, actor, `LEAVE_${status}`, "LeaveRequest", leave.id, safeLeave(oldValue), safeLeave(leave));
  saveData(data);
  return leave;
}

function createTarget(input, actor) {
  requireManager(actor);
  const data = readData();
  const employee = getEmployee(data, validateText(input.employee_id, "Employee"), actor);
  if (employee.status !== "ACTIVE") throw new EmployeeError("Targets can only be assigned to active employees", 409);
  const targetValue = Number(input.target_value);
  const achievement = Number(input.achievement || 0);
  if (!Number.isFinite(targetValue) || targetValue <= 0 || !Number.isFinite(achievement) || achievement < 0) {
    throw new EmployeeError("Target must be positive and achievement cannot be negative");
  }
  const target = {
    id: id("TGT"), employee_id: employee.id,
    department: String(input.department || employee.department),
    designation: String(input.designation || employee.designation),
    period: validateText(input.period, "Target period", 4, 30),
    target_type: validateText(input.target_type, "Target type", 2, 60),
    target_value: targetValue, achievement,
    achievement_percentage: Math.round(achievement / targetValue * 10000) / 100,
    status: achievement >= targetValue ? "ACHIEVED" : "IN_PROGRESS",
    created_by: actor.id, created_at: new Date().toISOString()
  };
  target.rating = ratingFromAchievement(target.achievement_percentage);
  data.Targets.push(target);
  data.PerformanceRecords.push({
    id: id("PRF"), employee_id: employee.id, target_id: target.id,
    achievement_percentage: target.achievement_percentage, rating: target.rating,
    recorded_at: target.created_at
  });
  audit(data, actor, "TARGET_CREATED", "Target", target.id, undefined, target);
  saveData(data);
  return target;
}

function updateTarget(targetId, input, actor) {
  requireManager(actor);
  const data = readData();
  const target = data.Targets.find(item => item.id === targetId);
  if (!target) throw new EmployeeError("Target not found", 404);
  const employee = getEmployee(data, target.employee_id, actor);
  if (employee.status !== "ACTIVE") throw new EmployeeError("Targets cannot be changed for an inactive employee", 409);
  const oldValue = { ...target };
  if (input.target_value !== undefined) {
    const value = Number(input.target_value);
    if (!Number.isFinite(value) || value <= 0) throw new EmployeeError("Target value must be positive");
    target.target_value = value;
  }
  if (input.achievement !== undefined) {
    const value = Number(input.achievement);
    if (!Number.isFinite(value) || value < 0) throw new EmployeeError("Achievement cannot be negative");
    target.achievement = value;
  }
  for (const key of ["period", "target_type"]) {
    if (input[key] !== undefined) target[key] = validateText(input[key], key, 2, 60);
  }
  target.achievement_percentage = Math.round(target.achievement / target.target_value * 10000) / 100;
  target.status = target.achievement >= target.target_value ? "ACHIEVED" : "IN_PROGRESS";
  target.rating = ratingFromAchievement(target.achievement_percentage);
  target.updated_at = new Date().toISOString();
  const performance = data.PerformanceRecords.find(item => item.target_id === target.id);
  if (performance) {
    performance.achievement_percentage = target.achievement_percentage;
    performance.rating = target.rating;
    performance.recorded_at = target.updated_at;
  }
  audit(data, actor, "TARGET_UPDATED", "Target", target.id, oldValue, { ...target, employee_id: employee.id });
  saveData(data);
  return target;
}

function addDocument(employeeId, input, actor) {
  requireSelfOrManager(actor, "Only an employee or authorized manager can upload employee documents");
  const data = readData();
  const employee = getEmployee(data, employeeId, actor);
  if (actor.role === "EMPLOYEE" && employee.user_id !== actor.id) throw new EmployeeError("You can only upload your own documents", 403);
  const content = typeof input.content_base64 === "string" ? input.content_base64 : "";
  if (!content || content.length > 4194304) throw new EmployeeError("Document content is required and must be no larger than 3 MB");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
    throw new EmployeeError("Document content must be valid base64");
  }
  const type = validateText(input.document_type, "Document type", 2, 80);
  const document = {
    id: id("DOC"), employee_id: employee.id, document_type: type,
    file_name: validateText(input.file_name, "File name", 1, 180),
    mime_type: String(input.mime_type || "application/octet-stream").slice(0, 100),
    content_base64: content,
    expiry_date: input.expiry_date ? validateDate(input.expiry_date, "Expiry date") : null,
    status: "ACTIVE", uploaded_by: actor.id, uploaded_at: new Date().toISOString()
  };
  if (!allowedDocumentTypes.has(document.mime_type)) {
    throw new EmployeeError("Choose a PDF, Word document, image, or text file");
  }
  data.EmployeeDocuments.push(document);
  audit(data, actor, "DOCUMENT_UPLOADED", "EmployeeDocument", document.id, undefined, {
    employee_id: employee.id, document_type: type, file_name: document.file_name
  });
  saveData(data);
  return publicDocument(document);
}

function publicDocument(document) {
  const { content_base64, ...metadata } = document;
  return metadata;
}

function getDocuments(employeeId, user) {
  return listCollection("EmployeeDocuments", user, employeeId).map(publicDocument);
}

function downloadDocument(documentId, user) {
  const data = readData();
  const document = data.EmployeeDocuments.find(item => item.id === documentId && item.status === "ACTIVE");
  if (!document) throw new EmployeeError("Document not found", 404);
  const employee = getEmployee(data, document.employee_id, user);
  if (user.role === "EMPLOYEE" && employee.user_id !== user.id) throw new EmployeeError("You cannot download this document", 403);
  audit(data, user, "DOCUMENT_DOWNLOADED", "EmployeeDocument", document.id, undefined, { employee_id: employee.id });
  saveData(data);
  return document;
}

function deleteDocument(documentId, user) {
  requireManager(user, "Only an administrator or authorized franchise manager can remove employee documents");
  const data = readData();
  const document = data.EmployeeDocuments.find(item => item.id === documentId && item.status === "ACTIVE");
  if (!document) throw new EmployeeError("Document not found", 404);
  getEmployee(data, document.employee_id, user);
  document.status = "ARCHIVED";
  document.content_base64 = "";
  document.deleted_at = new Date().toISOString();
  audit(data, user, "DOCUMENT_ARCHIVED", "EmployeeDocument", document.id, { status: "ACTIVE" }, { status: "ARCHIVED" });
  saveData(data);
  return document;
}

function dashboard(user) {
  const data = readData();
  const employees = data.Employees.filter(item => employeeVisible(data, item, user));
  const today = new Date().toISOString().slice(0, 10);
  const todayRecords = data.Attendance.filter(item => item.date === today && employees.some(employee => employee.id === item.employee_id));
  const activeIds = new Set(employees.filter(item => item.status === "ACTIVE").map(item => item.id));
  const targets = data.Targets.filter(item => activeIds.has(item.employee_id));
  const achievement = targets.length
    ? Math.round(targets.reduce((total, item) => total + Number(item.achievement_percentage || 0), 0) / targets.length)
    : 0;
  return {
    employees: employees.length,
    active_employees: employees.filter(item => item.status === "ACTIVE").length,
    inactive_employees: employees.filter(item => item.status !== "ACTIVE").length,
    new_employees: employees.filter(item => item.joining_date === today).length,
    attendance_today: todayRecords.filter(item => item.status === "PRESENT").length,
    pending_leave: data.LeaveRequests.filter(item => item.status === "PENDING" && employees.some(employee => employee.id === item.employee_id)).length,
    target_achievement: achievement
  };
}

function reports(query, user) {
  const data = readData();
  const employees = data.Employees.filter(item => employeeVisible(data, item, user));
  const allAttendance = data.Attendance.filter(item => employees.some(employee => employee.id === item.employee_id));
  const from = query.from ? validateDate(String(query.from), "From date") : "";
  const to = query.to ? validateDate(String(query.to), "To date") : "";
  if (from && to && from > to) throw new EmployeeError("From date must not be after to date");
  if (from && to && Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400000) {
    throw new EmployeeError("Employee reports support date ranges of up to one year");
  }
  const inPeriod = record => (!from || record.date >= from) && (!to || record.date <= to);
  const employeeIds = new Set(employees.map(item => item.id));
  const attendance = allAttendance.filter(item => employeeIds.has(item.employee_id) && inPeriod(item));
  const targets = data.Targets.filter(item => employeeIds.has(item.employee_id) && (!from || item.period >= from.slice(0, 7)) && (!to || item.period <= to.slice(0, 7)));
  const groupCount = (key) => employees.reduce((groups, item) => {
    const value = item[key] || "Unassigned";
    groups[value] = (groups[value] || 0) + 1;
    return groups;
  }, {});
  const franchiseSummary = employees.reduce((groups, employee) => {
    const key = employee.franchise_id || "UNASSIGNED";
    if (!groups[key]) groups[key] = {
      franchise_id: key,
      franchise: employee.franchise_name || "Unassigned",
      employees: 0,
      active_employees: 0,
      attendance_records: 0,
      present: 0,
      target: 0,
      achievement: 0
    };
    const summary = groups[key];
    summary.employees += 1;
    if (employee.status === "ACTIVE") summary.active_employees += 1;
    const employeeAttendance = attendance.filter(item => item.employee_id === employee.id);
    summary.attendance_records += employeeAttendance.length;
    summary.present += employeeAttendance.filter(item => ["PRESENT", "HALF_DAY"].includes(item.status)).length;
    const employeeTargets = targets.filter(item => item.employee_id === employee.id);
    summary.target += employeeTargets.reduce((sum, item) => sum + Number(item.target_value || 0), 0);
    summary.achievement += employeeTargets.reduce((sum, item) => sum + Number(item.achievement || 0), 0);
    return groups;
  }, {});
  for (const summary of Object.values(franchiseSummary)) {
    summary.attendance_percentage = summary.attendance_records
      ? Math.round(summary.present / summary.attendance_records * 10000) / 100 : 0;
    summary.achievement_percentage = summary.target
      ? Math.round(summary.achievement / summary.target * 10000) / 100 : 0;
  }
  const observedDates = allAttendance.map(item => item.date).sort();
  const periodStart = from || observedDates[0] || "";
  const periodEnd = to || observedDates[observedDates.length - 1] || "";
  let expectedWorkdays = 0;
  let attendedWorkdays = 0;
  if (periodStart && periodEnd) {
    for (const employee of employees.filter(item => item.status === "ACTIVE" && item.joining_date <= periodEnd)) {
      const employeeStart = employee.joining_date > periodStart ? employee.joining_date : periodStart;
      const records = new Map(attendance
        .filter(item => item.employee_id === employee.id)
        .map(item => [item.date, item]));
      const day = new Date(`${employeeStart}T00:00:00Z`);
      const finalDay = new Date(`${periodEnd}T00:00:00Z`);
      while (day <= finalDay) {
        const weekday = day.getUTCDay();
        const date = day.toISOString().slice(0, 10);
        const record = records.get(date);
        if (weekday !== 0 && weekday !== 6 && !["LEAVE", "HOLIDAY", "WEEK_OFF"].includes(record?.status)) {
          expectedWorkdays += 1;
          if (record?.status === "PRESENT") attendedWorkdays += 1;
          if (record?.status === "HALF_DAY") attendedWorkdays += 0.5;
        }
        day.setUTCDate(day.getUTCDate() + 1);
      }
    }
  }
  return {
    employees: {
      total: employees.length,
      active: employees.filter(item => item.status === "ACTIVE").length,
      inactive: employees.filter(item => item.status !== "ACTIVE").length,
      by_department: groupCount("department"),
      by_designation: groupCount("designation"),
      by_franchise: groupCount("franchise_name"),
      franchise_summary: Object.values(franchiseSummary)
    },
    attendance: {
      present: attendance.filter(item => item.status === "PRESENT").length,
      absent: attendance.filter(item => item.status === "ABSENT").length,
      leave: attendance.filter(item => item.status === "LEAVE").length,
      attendance_percentage: expectedWorkdays
        ? Math.round(attendedWorkdays / expectedWorkdays * 10000) / 100 : 0
    },
    targets: {
      target: targets.reduce((sum, item) => sum + Number(item.target_value || 0), 0),
      achievement: targets.reduce((sum, item) => sum + Number(item.achievement || 0), 0),
      achievement_percentage: targets.length ? Math.round(targets.reduce((sum, item) => sum + Number(item.achievement_percentage || 0), 0) / targets.length * 100) / 100 : 0,
      below_target: targets.filter(item => Number(item.achievement_percentage || 0) < 100).length
    }
  };
}

function auditHistory(user) {
  const data = readData();
  if (isAdmin(user)) return data.AuditLogs.filter(log => ["Employee", "Department", "Designation", "WorkLocation", "Attendance", "LeaveRequest", "Target", "EmployeeDocument", "EmployeeAPI"].includes(log.entity)).slice().reverse();
  if (!isManager(user)) throw new EmployeeError("Only authorized staff can view employee audit history", 403);
  const visibleIds = new Set(data.Employees.filter(employee => employeeVisible(data, employee, user)).map(employee => employee.id));
  return data.AuditLogs.filter(log => {
    if (log.entity === "Employee") return visibleIds.has(log.entity_id);
    return ["Attendance", "LeaveRequest", "Target", "EmployeeDocument"].includes(log.entity) &&
      data[log.entity === "Attendance" ? "Attendance" : log.entity === "LeaveRequest" ? "LeaveRequests" : log.entity === "Target" ? "Targets" : "EmployeeDocuments"]
        .some(record => record.id === log.entity_id && visibleIds.has(record.employee_id));
  }).slice().reverse();
}

function employeeProfile(employeeId, user) {
  const data = readData();
  const employee = getEmployee(data, employeeId, user);
  const attendance = data.Attendance.filter(item => item.employee_id === employee.id);
  const targets = data.Targets.filter(item => item.employee_id === employee.id);
  const documents = data.EmployeeDocuments.filter(item => item.employee_id === employee.id && item.status === "ACTIVE").map(publicDocument);
  const relatedIds = new Set([
    ...attendance.map(item => item.id),
    ...targets.map(item => item.id),
    ...documents.map(item => item.id)
  ]);
  const activityHistory = data.AuditLogs.filter(log =>
    (log.entity === "Employee" && log.entity_id === employee.id) || relatedIds.has(log.entity_id)
  ).slice().reverse();
  const expected = attendance.length;
  const attended = attendance.filter(item => ["PRESENT", "HALF_DAY"].includes(item.status)).length;
  return {
    ...safeEmployee(employee),
    attendance_summary: {
      records: attendance.length,
      present: attendance.filter(item => item.status === "PRESENT").length,
      absent: attendance.filter(item => item.status === "ABSENT").length,
      leave: attendance.filter(item => item.status === "LEAVE").length,
      attendance_percentage: expected ? Math.round(attended / expected * 10000) / 100 : 0
    },
    target_summary: {
      target: targets.reduce((sum, item) => sum + Number(item.target_value || 0), 0),
      achievement: targets.reduce((sum, item) => sum + Number(item.achievement || 0), 0),
      achievement_percentage: targets.length
        ? Math.round(targets.reduce((sum, item) => sum + Number(item.achievement_percentage || 0), 0) / targets.length * 100) / 100 : 0,
      rating: targets.length
        ? ratingFromAchievement(targets.reduce((sum, item) => sum + Number(item.achievement_percentage || 0), 0) / targets.length) : "UNRATED"
    },
    documents,
    activity_history: activityHistory
  };
}

function getNotifications(user) {
  if (user.role !== "EMPLOYEE") throw new EmployeeError("Only employees can access their notifications", 403);
  const data = readData();
  const employee = data.Employees.find(item => item.user_id === user.id);
  if (!employee) throw new EmployeeError("Employee profile not found", 404);
  return data.Notifications.filter(item => item.employee_id === employee.id).slice().reverse();
}

function editNotification(notificationId, input, user) {
  if (user.role !== "EMPLOYEE") throw new EmployeeError("Only employees can update their notifications", 403);
  const data = readData();
  const employee = data.Employees.find(item => item.user_id === user.id);
  const notification = data.Notifications.find(item =>
    item.id === notificationId && item.employee_id === employee?.id
  );
  if (!notification) throw new EmployeeError("Notification not found", 404);
  notification.read = Boolean(input.read);
  saveData(data);
  return notification;
}

if (!store.mongoEnabled) ensureEmployeeCollections();

module.exports = {
  EmployeeError,
  ensureEmployeeCollections,
  addDocument,
  auditHistory,
  cancelLeave,
  checkIn,
  checkOut,
  createEmployee,
  createTarget,
  dashboard,
  decideLeave,
  deleteDocument,
  downloadDocument,
  getDocuments,
  getNotifications,
  employeeProfile,
  getLeaveDocument,
  getEmployee: (employeeId, user) => safeEmployee(getEmployee(readData(), employeeId, user)),
  listCollection,
  listEmployees,
  recordAttendance,
  reports,
  saveReferenceCollection,
  submitLeave,
  updateEmployee,
  updateEmployeeStatus,
  updateReferenceCollection,
  updateTarget,
  editNotification
};
