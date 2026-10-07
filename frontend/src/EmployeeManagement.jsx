import { useCallback, useEffect, useState } from "react";
import "./EmployeeManagement.css";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:5050";
const ownerPages = ["Overview", "All Employees", "Add Employee", "Departments", "Designations", "Attendance", "Leave", "Targets & KPIs", "Documents", "Reports"];
const adminPages = ["Overview", "All Employees", "Franchise Employees", "Add Employee", "Departments", "Designations", "Work Locations", "Attendance", "Leave", "Targets & KPIs", "Documents", "Reports", "Audit Logs"];
const employeePages = ["My Profile", "My Attendance", "My Leave", "My Targets", "My Documents", "My Performance", "My Notifications"];
const emptyEmployee = {
  name: "", employee_id: "", zin_id: "", mobile: "", email: "", password: "", date_of_birth: "",
  gender: "", address: "", state: "", district: "", department: "", designation: "",
  profile_photo_url: "", employment_type: "FULL_TIME", joining_date: "", reporting_manager: "", work_location: "", franchise_id: ""
};
const dateToday = () => new Date().toISOString().slice(0, 10);

async function request(path, options = {}) {
  const token = localStorage.getItem("zyngram_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${response.status})`);
  }
  return response;
}

async function get(path) {
  return (await request(path)).json();
}

async function send(path, method, body) {
  return (await request(path, { method, body: JSON.stringify(body) })).json();
}

function EmployeeManagement({ session, notify }) {
  const isEmployee = session.role === "EMPLOYEE";
  const isAdmin = session.role === "ADMIN";
  const canManage = isAdmin || ["COMMAND", "HUB", "CENTER"].includes(session.role);
  const pages = isEmployee ? employeePages : isAdmin ? adminPages : ownerPages;
  const [page, setPage] = useState(isEmployee ? "My Profile" : "Overview");
  
  // Auto-filter by franchise when on Franchise Employees page
  const handlePageChange = newPage => {
    if (newPage === "Franchise Employees" && session.franchise_id) {
      setFilters(prev => ({ ...prev, franchise_id: session.franchise_id }));
    } else if (page === "Franchise Employees" && newPage !== "Franchise Employees") {
      setFilters(prev => ({ ...prev, franchise_id: "" }));
    }
    setPage(newPage);
    setSelectedEmployee(null);
  };
  const [employees, setEmployees] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [workLocations, setWorkLocations] = useState([]);
  const [franchises, setFranchises] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [targets, setTargets] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [dashboard, setDashboard] = useState({});
  const [reports, setReports] = useState({});
  const [profile, setProfile] = useState(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ status: "", department: "", designation: "", employment_type: "", state: "", district: "", franchise_id: "", fromJoiningDate: "", toJoiningDate: "" });
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeeProfileDetail, setEmployeeProfileDetail] = useState(null);
  const [editEmployee, setEditEmployee] = useState(null);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [designationForm, setDesignationForm] = useState({ name: "", department_id: "" });
  const [workLocationName, setWorkLocationName] = useState("");
  const [leaveForm, setLeaveForm] = useState({ leave_type: "Annual", start_date: "", end_date: "", reason: "" });
  const [leaveFile, setLeaveFile] = useState(null);
  const [targetForm, setTargetForm] = useState({ employee_id: "", period: "", target_type: "Business", target_value: "", achievement: "0" });
  const [attendanceForm, setAttendanceForm] = useState({ employee_id: "", date: dateToday(), status: "PRESENT", remarks: "" });
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState("ID Proof");
  const [documentExpiry, setDocumentExpiry] = useState("");

  const loadEmployees = useCallback(async () => {
    if (isEmployee) return;
    const params = new URLSearchParams({
      page: String(pageNumber),
      pageSize: "10",
      sortBy: sortField,
      sortOrder: sortDirection
    });
    if (search.trim()) params.set("search", search.trim());
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    try {
      const result = await get(`/api/employees?${params.toString()}`);
      setEmployees(result.employees || []);
      setEmployeeCount(result.count || 0);
      setPageCount(result.pages || 1);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [filters, isEmployee, pageNumber, search, sortDirection, sortField]);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const calls = isEmployee
        ? await Promise.all([
          get("/api/employees/me"), get("/api/attendance"), get("/api/leaves"),
          get("/api/targets"), get("/api/departments"), get("/api/designations"), get("/api/employees/notifications")
        ])
        : await Promise.all([
          get("/api/employees?page=1&pageSize=100"), get("/api/departments"), get("/api/designations"),
          get("/api/work-locations"), get("/api/attendance"), get("/api/leaves"), get("/api/targets"),
          get("/api/employees/dashboard"), get("/api/employees/reports"), get("/api/franchises"),
          ...(isAdmin ? [get("/api/employees/audit")] : [])
        ]);
      if (isEmployee) {
        const [me, at, lv, tg, deps, desigs, notificationResult] = calls;
        setProfile(me.employee);
        setEmployees([me.employee]);
        setAttendance(at.attendance || []);
        setLeaves(lv.leaves || []);
        setTargets(tg.targets || []);
        setDepartments(deps.departments || []);
        setDesignations(desigs.designations || []);
        setNotifications(notificationResult.notifications || []);
      } else {
        const [employeeResult, deps, desigs, locations, at, lv, tg, dash, report, franchiseResult, audit] = calls;
        setEmployeeOptions(employeeResult.employees || []);
        setDepartments(deps.departments || []);
        setDesignations(desigs.designations || []);
        setWorkLocations(locations.work_locations || []);
        setAttendance(at.attendance || []);
        setLeaves(lv.leaves || []);
        setTargets(tg.targets || []);
        setDashboard(dash.dashboard || {});
        setReports(report.reports || {});
        setFranchises(franchiseResult.franchises || []);
        if (isAdmin) setAuditLogs(audit.logs || []);
      }
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }, [isEmployee, isAdmin]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => loadEmployees(), 250);
    return () => clearTimeout(timer);
  }, [loadEmployees]);

  useEffect(() => {
    if (page !== "Documents" && page !== "My Documents") return;
    const employeeId = selectedEmployee?.id || profile?.id || (isEmployee ? employees[0]?.id : null);
    if (!employeeId) return;
    get(`/api/employees/${encodeURIComponent(employeeId)}/documents`)
      .then(result => setDocuments(result.documents || []))
      .catch(loadError => setError(loadError.message));
  }, [page, selectedEmployee, profile, employees, isEmployee]);

  useEffect(() => {
    if (!selectedEmployee) return;
    get(`/api/employees/${encodeURIComponent(selectedEmployee.id)}`)
      .then(result => setEmployeeProfileDetail(result.employee))
      .catch(loadError => setError(loadError.message));
  }, [selectedEmployee]);

  const finish = async message => {
    notify(message);
    setShowEmployeeForm(false);
    setEditEmployee(null);
    setFile(null);
    await Promise.all([load(), loadEmployees()]);
  };

  const saveEmployee = async event => {
    event.preventDefault();
    try {
      if (editEmployee) {
        const changes = Object.fromEntries(Object.entries(employeeForm).filter(([key]) => key !== "password"));
        await send(`/api/employees/${encodeURIComponent(editEmployee.id)}`, "PUT", changes);
      } else {
        await send("/api/employees", "POST", employeeForm);
        setPage("All Employees");
      }
      await finish(editEmployee ? "Employee updated" : "Employee created. Share the initial password securely.");
    } catch (saveError) { setError(saveError.message); }
  };

  const changeStatus = async (employee, status) => {
    try {
      await send(`/api/employees/${encodeURIComponent(employee.id)}/status`, "PATCH", { status });
      await finish(`Employee status changed to ${status.toLowerCase()}`);
    } catch (statusError) { setError(statusError.message); }
  };

  const createDepartment = async event => {
    event.preventDefault();
    try { await send("/api/departments", "POST", { name: departmentName }); setDepartmentName(""); await finish("Department created"); }
    catch (saveError) { setError(saveError.message); }
  };

  const createDesignation = async event => {
    event.preventDefault();
    try { await send("/api/designations", "POST", designationForm); setDesignationForm({ name: "", department_id: "" }); await finish("Designation created"); }
    catch (saveError) { setError(saveError.message); }
  };

  const createWorkLocation = async event => {
    event.preventDefault();
    try { await send("/api/work-locations", "POST", { name: workLocationName }); setWorkLocationName(""); await finish("Work location created"); }
    catch (saveError) { setError(saveError.message); }
  };

  const toggleReferenceStatus = async (collection, item) => {
    try { await send(`/api/${collection}/${item.id}/status`, "PATCH", { status: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }); await load(); }
    catch (statusError) { setError(statusError.message); }
  };

  const editReference = async (collection, item) => {
    const name = window.prompt("Update name", item.name);
    if (name === null) return;
    const description = window.prompt("Update description", item.description || "");
    if (description === null) return;
    try {
      await send(`/api/${collection}/${item.id}`, "PUT", { name, description });
      await finish("Record updated");
    } catch (editError) { setError(editError.message); }
  };

  const markNotificationRead = async notification => {
    try {
      await send(`/api/employees/notifications/${notification.id}`, "PATCH", { read: !notification.read });
      const result = await get("/api/employees/notifications");
      setNotifications(result.notifications || []);
    } catch (notificationError) { setError(notificationError.message); }
  };

  const submitLeave = async event => {
    event.preventDefault();
    try {
      let attachment = {};
      if (leaveFile) {
        if (leaveFile.size > 200 * 1024) throw new Error("Supporting documents must be no larger than 200 KB");
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Unable to read supporting document"));
          reader.readAsDataURL(leaveFile);
        });
        attachment = { supporting_document: content, supporting_document_name: leaveFile.name, supporting_document_type: leaveFile.type };
      }
      await send("/api/leaves", "POST", { ...leaveForm, ...attachment });
      setLeaveForm({ leave_type: "Annual", start_date: "", end_date: "", reason: "" });
      setLeaveFile(null);
      await finish("Leave request submitted");
    }
    catch (saveError) { setError(saveError.message); }
  };

  const decideLeave = async (leave, decision) => {
    try { await send(`/api/leaves/${leave.id}/${decision}`, "PATCH", {}); await finish(`Leave ${decision}d`); }
    catch (decisionError) { setError(decisionError.message); }
  };

  const cancelLeaveRequest = async leave => {
    try { await send(`/api/leaves/${leave.id}/cancel`, "PATCH", {}); await finish("Leave request cancelled"); }
    catch (cancelError) { setError(cancelError.message); }
  };

  const createTarget = async event => {
    event.preventDefault();
    try { await send("/api/targets", "POST", targetForm); setTargetForm({ employee_id: "", period: "", target_type: "Business", target_value: "", achievement: "0" }); await finish("Target saved"); }
    catch (saveError) { setError(saveError.message); }
  };

  const updateTargetAchievement = async target => {
    const achievement = window.prompt("Enter updated achievement value", String(target.achievement));
    if (achievement === null) return;
    try {
      await send(`/api/targets/${target.id}`, "PUT", { achievement: Number(achievement) });
      await finish("Target achievement updated");
    } catch (targetError) { setError(targetError.message); }
  };

  const recordAttendance = async event => {
    event.preventDefault();
    try { await send("/api/attendance", "POST", attendanceForm); await finish("Attendance saved"); }
    catch (saveError) { setError(saveError.message); }
  };

  const checkAttendance = async action => {
    try { await send(`/api/attendance/check-${action}`, "POST", {}); await finish(`Checked ${action}`); }
    catch (attendanceError) { setError(attendanceError.message); }
  };

  const uploadDocument = async event => {
    event.preventDefault();
    const employeeId = selectedEmployee?.id || profile?.id || (isEmployee ? employees[0]?.id : null);
    if (!file || !employeeId) return setError("Choose an employee and a document file");
    if (file.size > 3 * 1024 * 1024) return setError("Documents must be no larger than 3 MB");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await send(`/api/employees/${encodeURIComponent(employeeId)}/documents`, "POST", {
          file_name: file.name, mime_type: file.type, document_type: documentType,
          expiry_date: documentExpiry || undefined,
          content_base64: String(reader.result).split(",")[1]
        });
        await finish("Document uploaded");
        const result = await get(`/api/employees/${encodeURIComponent(employeeId)}/documents`);
        setDocuments(result.documents || []);
      } catch (uploadError) { setError(uploadError.message); }
    };
    reader.onerror = () => setError("Unable to read selected document");
    reader.readAsDataURL(file);
  };

  const downloadDocument = async document => {
    try {
      const response = await request(`/api/documents/${encodeURIComponent(document.id)}/download`);
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = document.file_name;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) { setError(downloadError.message); }
  };

  const deleteDocument = async document => {
    try {
      await send(`/api/documents/${document.id}`, "DELETE", {});
      notify("Document archived");
      const employeeId = selectedEmployee?.id || profile?.id || (isEmployee ? employees[0]?.id : null);
      if (employeeId) {
        const result = await get(`/api/employees/${encodeURIComponent(employeeId)}/documents`);
        setDocuments(result.documents || []);
      }
    } catch (deleteError) { setError(deleteError.message); }
  };

  const downloadLeaveDocument = async leave => {
    try {
      const response = await request(`/api/leaves/${leave.id}/document`);
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = leave.supporting_document.file_name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (downloadError) { setError(downloadError.message); }
  };

  const pageTitle = page === "Overview" ? "Employee Management" : page;

  return <section className="employee-module">
    <div className="employee-module-head">
      <div><span className="employee-eyebrow">{isEmployee ? "EMPLOYEE SELF-SERVICE" : isAdmin ? "CENTRAL PEOPLE OPERATIONS" : "FRANCHISE PEOPLE OPERATIONS"}</span><h2>{pageTitle}</h2><p>{isEmployee ? "Your work profile, attendance and requests." : "Manage people and day-to-day employee operations."}</p></div>
      <button className="employee-refresh" onClick={() => Promise.all([load(), loadEmployees()])} disabled={busy}>{busy ? "Refreshing…" : "Refresh data"}</button>
    </div>
    <nav className="employee-tabs" aria-label="Employee management">
      {pages.map(item => <button key={item} className={page === item ? "selected" : ""} onClick={() => handlePageChange(item)}>{item}</button>)}
    </nav>
    {error && <div className="employee-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    {busy && !employees.length ? <p className="employee-loading">Loading employee workspace…</p> : <>
      {page === "Overview" && <Overview dashboard={dashboard} reports={reports} onOpen={handlePageChange}/>}
      {(page === "All Employees" || page === "Franchise Employees") && <section className="employee-card">
        <div className="employee-toolbar"><div><h3>{page}</h3><p>{employeeCount} people in your authorized scope</p></div>{canManage && <button className="employee-primary" onClick={() => { setEditEmployee(null); setEmployeeForm({ ...emptyEmployee, franchise_id: session.franchise_id || "" }); setShowEmployeeForm(true); }}>Add employee</button>}</div>
        <div className="employee-filters">
          <input aria-label="Search employees" placeholder="Search ID, ZIN ID, name, phone…" value={search} onChange={event => { setSearch(event.target.value); setPageNumber(1); }}/>
          {[
            ["status", ["ACTIVE", "INACTIVE", "RESIGNED", "TERMINATED"]],
            ["department", departments.map(item => item.name)],
            ["designation", designations.map(item => item.name)],
            ["employment_type", ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]]
          ].map(([key, options]) => <select key={key} aria-label={`Filter by ${key}`} value={filters[key]} onChange={event => { setFilters({ ...filters, [key]: event.target.value }); setPageNumber(1); }}>
            <option value="">{key.replace("_", " ").replace(/\b\w/g, letter => letter.toUpperCase())}: all</option>
            {options.map(value => <option key={value} value={value}>{value}</option>)}
          </select>)}
          <label>Joined from<input type="date" value={filters.fromJoiningDate} onChange={event => { setFilters({ ...filters, fromJoiningDate: event.target.value }); setPageNumber(1); }}/></label>
          <label>Joined to<input type="date" value={filters.toJoiningDate} onChange={event => { setFilters({ ...filters, toJoiningDate: event.target.value }); setPageNumber(1); }}/></label>
          <input aria-label="Filter by state" placeholder="State" value={filters.state} onChange={event => { setFilters({ ...filters, state: event.target.value }); setPageNumber(1); }}/>
          <input aria-label="Filter by district" placeholder="District" value={filters.district} onChange={event => { setFilters({ ...filters, district: event.target.value }); setPageNumber(1); }}/>
          <select aria-label="Filter by franchise" value={filters.franchise_id} onChange={event => { setFilters({ ...filters, franchise_id: event.target.value }); setPageNumber(1); }}><option value="">Franchise: all</option>{franchises.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select aria-label="Sort employees" value={`${sortField}:${sortDirection}`} onChange={event => { const [field, direction] = event.target.value.split(":"); setSortField(field); setSortDirection(direction); setPageNumber(1); }}><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="employee_id:asc">Employee ID</option><option value="joining_date:desc">Newest joined</option></select>
        </div>
        <EmployeeTable employees={employees} canManage={canManage} onView={setSelectedEmployee} onEdit={employee => { setEditEmployee(employee); setEmployeeForm({ ...emptyEmployee, ...employee, password: "" }); setShowEmployeeForm(true); }} onStatus={changeStatus}/>
        <div className="employee-pagination"><span>Page {pageNumber} of {pageCount}</span><button disabled={pageNumber <= 1} onClick={() => setPageNumber(pageNumber - 1)}>Previous</button><button disabled={pageNumber >= pageCount} onClick={() => setPageNumber(pageNumber + 1)}>Next</button></div>
        {selectedEmployee && <EmployeeProfile employee={selectedEmployee} details={employeeProfileDetail?.id === selectedEmployee.id ? employeeProfileDetail : null} attendance={attendance} targets={targets} onClose={() => setSelectedEmployee(null)} onDocuments={() => { setPage("Documents"); setSelectedEmployee(selectedEmployee); }}/>}
      </section>}
      {page === "Add Employee" && <section className="employee-card"><h3>Add an employee</h3><p>Create a profile and a linked employee sign-in account.</p>{canManage && <button className="employee-primary" onClick={() => { setEditEmployee(null); setEmployeeForm({ ...emptyEmployee, franchise_id: session.franchise_id || "" }); setShowEmployeeForm(true); }}>Open employee form</button>}</section>}
      {page === "Departments" && <ReferencePage title="Departments" items={departments} onCreate={canManage ? createDepartment : null} value={departmentName} onChange={setDepartmentName} onToggle={canManage ? item => toggleReferenceStatus("departments", item) : null} onEdit={canManage ? item => editReference("departments", item) : null}/>}
      {page === "Designations" && <section className="employee-card"><div className="employee-toolbar"><div><h3>Designations</h3><p>Connect roles to departments.</p></div></div>
        {canManage && <form className="employee-inline-form" onSubmit={createDesignation}><input required minLength="2" placeholder="Designation name" value={designationForm.name} onChange={event => setDesignationForm({ ...designationForm, name: event.target.value })}/><select value={designationForm.department_id} onChange={event => setDesignationForm({ ...designationForm, department_id: event.target.value })}><option value="">No department</option>{departments.filter(item => item.status !== "INACTIVE").map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="employee-primary">Add designation</button></form>}
        <ReferenceTable items={designations} onToggle={canManage ? item => toggleReferenceStatus("designations", item) : null} onEdit={canManage ? item => editReference("designations", item) : null}/>
      </section>}
      {page === "Work Locations" && <ReferencePage title="Work locations" items={workLocations} onCreate={canManage ? createWorkLocation : null} value={workLocationName} onChange={setWorkLocationName} onToggle={canManage ? item => toggleReferenceStatus("work-locations", item) : null} onEdit={canManage ? item => editReference("work-locations", item) : null}/>}
      {(page === "Attendance" || page === "My Attendance") && <AttendancePage attendance={attendance} employees={employeeOptions} isEmployee={isEmployee} canManage={canManage} onCheckIn={() => checkAttendance("in")} onCheckOut={() => checkAttendance("out")} onRecord={recordAttendance} form={attendanceForm} setForm={setAttendanceForm}/>}
      {(page === "Leave" || page === "My Leave") && <LeavePage leaves={leaves} employees={isEmployee ? employees : employeeOptions} isEmployee={isEmployee} canManage={canManage} form={leaveForm} setForm={setLeaveForm} supportingFile={leaveFile} setSupportingFile={setLeaveFile} onSubmit={submitLeave} onDecision={decideLeave} onCancel={cancelLeaveRequest} onDownloadDocument={downloadLeaveDocument}/>}
      {(page === "Targets & KPIs" || page === "My Targets" || page === "My Performance") && <TargetsPage targets={targets} employees={isEmployee ? employees : employeeOptions} isEmployee={isEmployee} canManage={canManage} form={targetForm} setForm={setTargetForm} onCreate={createTarget} onUpdate={updateTargetAchievement} performance={page === "My Performance"}/>}
      {(page === "Documents" || page === "My Documents") && <DocumentsPage documents={documents} employees={isEmployee ? employees : employeeOptions} selectedEmployee={selectedEmployee} onSelect={setSelectedEmployee} setFile={setFile} documentType={documentType} setDocumentType={setDocumentType} documentExpiry={documentExpiry} setDocumentExpiry={setDocumentExpiry} onUpload={uploadDocument} onDownload={downloadDocument} onDelete={deleteDocument} isEmployee={isEmployee} canManage={canManage}/>}
      {page === "My Profile" && <MyProfile employee={profile} attendance={attendance} targets={targets} onAttendance={checkAttendance} onOpen={setPage}/>}
      {page === "My Notifications" && <section className="employee-card"><h3>My notifications</h3><div className="employee-notifications">{notifications.map(item => <article key={item.id} className={item.read ? "read" : ""}><div><b>{item.type.replaceAll("_", " ")}</b><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()}</small></div><button onClick={() => markNotificationRead(item)}>{item.read ? "Mark unread" : "Mark read"}</button></article>)}{!notifications.length && <p>No notifications yet.</p>}</div></section>}
      {page === "Reports" && <ReportsPage reports={reports} onRangeChange={async event => { const range = event.target.value; const days = range ? new Date(Number(range.slice(0, 4)), Number(range.slice(5, 7)), 0).getDate() : 1; try { const result = await get(`/api/employees/reports${range ? `?from=${range}-01&to=${range}-${String(days).padStart(2, "0")}` : ""}`); setReports(result.reports || {}); } catch (reportError) { setError(reportError.message); } }}/>}
      {page === "Audit Logs" && <AuditPage logs={auditLogs}/>}
      {showEmployeeForm && <EmployeeForm employee={employeeForm} setEmployee={setEmployeeForm} editing={Boolean(editEmployee)} departments={departments} designations={designations} workLocations={workLocations} franchises={franchises} session={session} onClose={() => setShowEmployeeForm(false)} onSubmit={saveEmployee}/>}
    </>}
  </section>;
}

function Overview({ dashboard, reports, onOpen }) {
  const cards = [
    ["Employees", dashboard.employees, "All in authorized scope"],
    ["Active employees", dashboard.active_employees, "Currently active"],
    ["Inactive employees", dashboard.inactive_employees, "Inactive or separated"],
    ["New employees", dashboard.new_employees, "Joined today"],
    ["Attendance today", dashboard.attendance_today, "Marked present"],
    ["Pending leave", dashboard.pending_leave, "Awaiting decision"],
    ["Target achievement", `${dashboard.target_achievement || 0}%`, "Average across active targets"]
  ];
  return <><div className="employee-stat-grid">{cards.map(([title, value, hint]) => <article className="employee-stat" key={title}><span>{title}</span><strong>{value ?? 0}</strong><small>{hint}</small></article>)}</div>
    <div className="employee-overview-grid"><section className="employee-card"><div className="employee-toolbar"><div><h3>People snapshot</h3><p>Workforce by department</p></div><button className="employee-link" onClick={() => onOpen("Reports")}>View reports →</button></div><Breakdown data={reports.employees?.by_department}/></section>
    <section className="employee-card"><div className="employee-toolbar"><div><h3>Quick actions</h3><p>Open an employee workflow</p></div></div><div className="employee-quick-links">{["All Employees", "Attendance", "Leave", "Targets & KPIs"].map(item => <button key={item} onClick={() => onOpen(item)}>{item}<span>→</span></button>)}</div></section></div>
  </>;
}

function EmployeeTable({ employees, canManage, onView, onEdit, onStatus }) {
  return <div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>Employee</th><th>Department / role</th><th>Franchise</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    {employees.map(item => <tr key={item.id}><td><button className="employee-person" onClick={() => onView(item)}><b>{item.name}</b><small>{item.employee_id} · {item.zin_id || "No ZIN ID"}</small><small>{item.mobile} · {item.email}</small></button></td><td>{item.department || "—"}<small>{item.designation || "—"}</small></td><td>{item.franchise_name || item.franchise_id || "—"}</td><td>{item.joining_date || "—"}</td><td><span className={`employee-status status-${item.status?.toLowerCase()}`}>{item.status}</span></td><td className="employee-actions"><button onClick={() => onView(item)}>Profile</button>{canManage && <><button onClick={() => onEdit(item)}>Edit</button><select aria-label={`Change status for ${item.name}`} value={item.status} onChange={event => onStatus(item, event.target.value)}>{["ACTIVE", "INACTIVE", "RESIGNED", "TERMINATED"].map(status => <option key={status}>{status}</option>)}</select></>}</td></tr>)}
    {!employees.length && <tr><td colSpan="6" className="employee-empty">No employees match these filters.</td></tr>}
  </tbody></table></div>;
}

function EmployeeProfile({ employee, details, attendance, targets, onClose, onDocuments }) {
  const personAttendance = attendance.filter(item => item.employee_id === employee.id);
  const personTargets = targets.filter(item => item.employee_id === employee.id);
  return <div className="employee-profile-panel"><div className="employee-toolbar"><div className="employee-profile-title">{employee.profile_photo_url && <img src={employee.profile_photo_url} alt=""/>}<div><h3>{employee.name}</h3><p>{employee.employee_id} · {employee.designation || "Employee"}</p></div></div><button onClick={onClose}>Close</button></div><div className="employee-profile-grid">{[["Email", employee.email], ["Mobile", employee.mobile], ["Department", employee.department], ["Employment type", employee.employment_type], ["Joining date", employee.joining_date], ["Manager", employee.reporting_manager], ["Franchise", employee.franchise_name], ["Work location", employee.work_location], ["Address", employee.address]].map(([label, value]) => <div key={label}><small>{label}</small><b>{value || "—"}</b></div>)}</div><div className="employee-profile-summary"><span>Attendance records <b>{details?.attendance_summary?.records ?? personAttendance.length}</b></span><span>Targets <b>{personTargets.length}</b></span><span>Achievement <b>{details?.target_summary?.achievement_percentage ?? (personTargets.length ? `${Math.round(personTargets.reduce((total, item) => total + Number(item.achievement_percentage || 0), 0) / personTargets.length)}%` : "—")}</b></span><span>Rating <b>{details?.target_summary?.rating || "UNRATED"}</b></span><button onClick={onDocuments}>Documents ({details?.documents?.length ?? 0})</button></div><section className="employee-activity"><h4>Recent activity</h4>{(details?.activity_history || []).slice(0, 8).map(item => <div key={item.id}><b>{item.action}</b><span>{new Date(item.timestamp || item.created_at).toLocaleString()}</span></div>)}{!details?.activity_history?.length && <p>No activity recorded.</p>}</section></div>;
}

function EmployeeForm({ employee, setEmployee, editing, departments, designations, workLocations, franchises, session, onClose, onSubmit }) {
  const change = event => {
    const value = event.target.value;
    setEmployee({ ...employee, [event.target.name]: value });
    // Clear designation if department changes and it doesn't belong to the new department
    if (event.target.name === "department" && employee.designation) {
      const selectedDept = departments.find(d => d.name === value);
      const currentDesignation = designations.find(d => d.name === employee.designation);
      if (selectedDept && currentDesignation && currentDesignation.department_id !== selectedDept.id) {
        setEmployee(prev => ({ ...prev, department: value, designation: "" }));
      }
    }
  };
  const fields = [
    ["name", "Full name", true], ["employee_id", "Employee ID", false], ["zin_id", "ZIN ID", false],
    ["mobile", "Mobile", true], ["email", "Email", true], ...(!editing ? [["password", "Initial login password (8+ characters)", true]] : []),
    ["date_of_birth", "Date of birth", false, "date"], ["gender", "Gender", false],
    ["profile_photo_url", "Profile photo URL", false], ["address", "Address", false], ["state", "State", false], ["district", "District", false],
    ["joining_date", "Joining date", true, "date"], ["reporting_manager", "Reporting manager", false],
    ["work_location", "Work location", false], ["employment_type", "Employment type", true]
  ];
  return <div className="employee-modal-backdrop" role="presentation" onClick={onClose}><form className="employee-modal" onSubmit={onSubmit} onClick={event => event.stopPropagation()}><div className="employee-toolbar"><div><h3>{editing ? "Edit employee" : "Add employee"}</h3><p>Employee login credentials are created with this profile.</p></div><button type="button" onClick={onClose}>×</button></div><div className="employee-form-grid">
    {fields.map(([name, label, required, type = "text"]) => <label key={name}>{label}<input required={required} minLength={name === "password" ? 8 : undefined} type={type} name={name} value={employee[name] || ""} onChange={change}/></label>)}
    <label>Department<select required name="department" value={employee.department || ""} onChange={change}><option value="">Select</option>{departments.filter(item => item.status !== "INACTIVE").map(item => <option value={item.name} key={item.id}>{item.name}</option>)}</select></label>
    <label>Designation<select required name="designation" value={employee.designation || ""} onChange={change}><option value="">Select</option>{(() => {
      const selectedDept = departments.find(d => d.name === employee.department);
      return designations.filter(item => item.status !== "INACTIVE" && (!selectedDept || item.department_id === selectedDept.id)).map(item => <option value={item.name} key={item.id}>{item.name}</option>);
    })()}</select></label>
    <label>Franchise<select required name="franchise_id" value={employee.franchise_id || session.franchise_id || ""} onChange={change}><option value="">Select</option>{franchises.map(item => <option key={item.id} value={item.id}>{item.name} · {item.level}</option>)}</select></label>
    <label>Work location<select required name="work_location" value={employee.work_location || ""} onChange={change}><option value="">Select</option>{workLocations.filter(item => item.status !== "INACTIVE").map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
  </div><div className="employee-modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="employee-primary">{editing ? "Save changes" : "Create employee"}</button></div></form></div>;
}

function ReferencePage({ title, items, onCreate, value, onChange, onToggle, onEdit }) {
  return <section className="employee-card"><div className="employee-toolbar"><div><h3>{title}</h3><p>Manage active and inactive records.</p></div></div>{onCreate && <form className="employee-inline-form" onSubmit={onCreate}><input required minLength="2" placeholder={`New ${title.toLowerCase().slice(0, -1)} name`} value={value} onChange={event => onChange(event.target.value)}/><button className="employee-primary">Add</button></form>}<ReferenceTable items={items} onToggle={onToggle} onEdit={onEdit}/></section>;
}

function ReferenceTable({ items, onToggle, onEdit }) {
  return <div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>Name</th><th>Description</th><th>Status</th><th>Action</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.description || item.department_id || "—"}</td><td>{item.status}</td><td className="employee-actions">{onEdit && <button onClick={() => onEdit(item)}>Edit</button>}{onToggle && <button onClick={() => onToggle(item)}>{item.status === "ACTIVE" ? "Deactivate" : "Activate"}</button>}</td></tr>)}{!items.length && <tr><td className="employee-empty" colSpan="4">No records yet.</td></tr>}</tbody></table></div>;
}

function AttendancePage({ attendance, employees, isEmployee, canManage, onCheckIn, onCheckOut, onRecord, form, setForm }) {
  return <section className="employee-card"><div className="employee-toolbar"><div><h3>{isEmployee ? "My attendance" : "Attendance"}</h3><p>Daily check-in, check-out and attendance status.</p></div>{isEmployee && <div className="employee-button-row"><button className="employee-primary" onClick={onCheckIn}>Check in</button><button onClick={onCheckOut}>Check out</button></div>}</div>
    {canManage && <form className="employee-inline-form" onSubmit={onRecord}><select required value={form.employee_id} onChange={event => setForm({ ...form, employee_id: event.target.value })}><option value="">Select employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name} · {item.employee_id}</option>)}</select><input required type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })}/><select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEK_OFF"].map(item => <option key={item}>{item}</option>)}</select><input placeholder="Remarks" value={form.remarks} onChange={event => setForm({ ...form, remarks: event.target.value })}/><button className="employee-primary">Record</button></form>}
    <div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>Date</th><th>Employee</th><th>Check-in</th><th>Check-out</th><th>Hours</th><th>Location</th><th>Status</th></tr></thead><tbody>{attendance.map(item => <tr key={item.id}><td>{item.date}</td><td>{employees.find(person => person.id === item.employee_id)?.name || item.employee_id}</td><td>{item.check_in ? new Date(item.check_in).toLocaleTimeString() : "—"}</td><td>{item.check_out ? new Date(item.check_out).toLocaleTimeString() : "—"}</td><td>{item.working_hours ?? "—"}</td><td>{item.work_location || "—"}</td><td>{item.status}</td></tr>)}{!attendance.length && <tr><td colSpan="7" className="employee-empty">No attendance records yet.</td></tr>}</tbody></table></div>
  </section>;
}

function LeavePage({ leaves, employees, isEmployee, canManage, form, setForm, setSupportingFile, onSubmit, onDecision, onCancel, onDownloadDocument }) {
  return <section className="employee-card"><div className="employee-toolbar"><div><h3>{isEmployee ? "My leave" : "Leave requests"}</h3><p>Submit requests and review pending leave.</p></div></div>{isEmployee && <form className="employee-inline-form leave-form" onSubmit={onSubmit}><select value={form.leave_type} onChange={event => setForm({ ...form, leave_type: event.target.value })}>{["Annual", "Sick", "Personal", "Unpaid", "Other"].map(item => <option key={item}>{item}</option>)}</select><label>From<input required type="date" value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value })}/></label><label>To<input required type="date" value={form.end_date} onChange={event => setForm({ ...form, end_date: event.target.value })}/></label><input required placeholder="Reason" value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })}/><label>Supporting document<input type="file" onChange={event => setSupportingFile(event.target.files?.[0] || null)}/></label><button className="employee-primary">Request leave</button></form>}
    <div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Reason</th><th>Supporting document</th><th>Status</th><th>Decision</th></tr></thead><tbody>{leaves.map(item => <tr key={item.id}><td>{employees.find(person => person.id === item.employee_id)?.name || item.employee_id}</td><td>{item.leave_type}</td><td>{item.start_date} – {item.end_date}</td><td>{item.reason}</td><td>{item.supporting_document && <button onClick={() => onDownloadDocument(item)}>Download</button>}</td><td>{item.status}</td><td>{canManage && item.status === "PENDING" ? <span className="employee-button-row"><button onClick={() => onDecision(item, "approve")}>Approve</button><button className="danger" onClick={() => onDecision(item, "reject")}>Reject</button></span> : isEmployee && item.status === "PENDING" ? <button onClick={() => onCancel(item)}>Cancel</button> : "—"}</td></tr>)}{!leaves.length && <tr><td colSpan="7" className="employee-empty">No leave requests yet.</td></tr>}</tbody></table></div>
  </section>;
}

function TargetsPage({ targets, employees, isEmployee, canManage, form, setForm, onCreate, onUpdate, performance }) {
  return <section className="employee-card"><div className="employee-toolbar"><div><h3>{performance ? "My performance" : isEmployee ? "My targets" : "Targets & KPIs"}</h3><p>Achievement percentage is calculated by the backend.</p></div></div>{canManage && <form className="employee-inline-form" onSubmit={onCreate}><select required value={form.employee_id} onChange={event => setForm({ ...form, employee_id: event.target.value })}><option value="">Employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input required placeholder="Period e.g. 2026-10" value={form.period} onChange={event => setForm({ ...form, period: event.target.value })}/><input required placeholder="Target type" value={form.target_type} onChange={event => setForm({ ...form, target_type: event.target.value })}/><input required type="number" min="0.01" step="any" placeholder="Target value" value={form.target_value} onChange={event => setForm({ ...form, target_value: event.target.value })}/><input type="number" min="0" step="any" placeholder="Achievement" value={form.achievement} onChange={event => setForm({ ...form, achievement: event.target.value })}/><button className="employee-primary">Save target</button></form>}
    <div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>Employee</th><th>Period</th><th>Type</th><th>Target</th><th>Achievement</th><th>Achievement %</th><th>Rating</th><th>Status</th>{canManage && <th>Action</th>}</tr></thead><tbody>{targets.map(item => <tr key={item.id}><td>{employees.find(person => person.id === item.employee_id)?.name || item.employee_id}</td><td>{item.period}</td><td>{item.target_type}</td><td>{item.target_value}</td><td>{item.achievement}</td><td>{item.achievement_percentage}%</td><td>{item.rating || "UNRATED"}</td><td>{item.status}</td>{canManage && <td><button onClick={() => onUpdate(item)}>Update achievement</button></td>}</tr>)}{!targets.length && <tr><td colSpan={canManage ? "9" : "8"} className="employee-empty">No targets recorded.</td></tr>}</tbody></table></div>
  </section>;
}

function DocumentsPage({ documents, employees, selectedEmployee, onSelect, setFile, documentType, setDocumentType, documentExpiry, setDocumentExpiry, onUpload, onDownload, onDelete, isEmployee, canManage }) {
  return <section className="employee-card"><div className="employee-toolbar"><div><h3>{isEmployee ? "My documents" : "Employee documents"}</h3><p>Stored files can only be downloaded through the authorized API.</p></div></div>{!isEmployee && <label className="employee-document-person">Employee<select value={selectedEmployee?.id || ""} onChange={event => onSelect(employees.find(item => item.id === event.target.value) || null)}><option value="">Select employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name} · {item.employee_id}</option>)}</select></label>}{(canManage || isEmployee) && <form className="employee-inline-form" onSubmit={onUpload}><input required type="file" onChange={event => setFile(event.target.files?.[0] || null)}/><select value={documentType} onChange={event => setDocumentType(event.target.value)}>{["ID Proof", "Address Proof", "Qualification", "Offer / Agreement", "Other"].map(type => <option key={type}>{type}</option>)}</select><label>Expires<input type="date" value={documentExpiry} onChange={event => setDocumentExpiry(event.target.value)}/></label><button className="employee-primary">Upload document</button></form>}<div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>File</th><th>Type</th><th>Expiry</th><th>Status</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>{documents.map(item => <tr key={item.id}><td>{item.file_name}</td><td>{item.document_type}</td><td>{item.expiry_date || "—"}</td><td>{item.status}</td><td>{new Date(item.uploaded_at).toLocaleDateString()}</td><td className="employee-actions"><button onClick={() => onDownload(item)}>Download</button>{canManage && <button className="danger" onClick={() => onDelete(item)}>Archive</button>}</td></tr>)}{!documents.length && <tr><td colSpan="6" className="employee-empty">No documents uploaded.</td></tr>}</tbody></table></div></section>;
}

function MyProfile({ employee, attendance, targets, onAttendance, onOpen }) {
  if (!employee) return <section className="employee-card"><p>Your employee profile is not available.</p></section>;
  return <><section className="employee-card"><div className="employee-toolbar"><div><h3>{employee.name}</h3><p>{employee.employee_id} · {employee.designation || "Employee"} · {employee.status}</p></div><div className="employee-button-row"><button className="employee-primary" onClick={() => onAttendance("in")}>Check in</button><button onClick={() => onAttendance("out")}>Check out</button></div></div><div className="employee-profile-grid">{[["Email", employee.email], ["Mobile", employee.mobile], ["Department", employee.department], ["Franchise", employee.franchise_name], ["Employment type", employee.employment_type], ["Joining date", employee.joining_date], ["Manager", employee.reporting_manager], ["Work location", employee.work_location], ["Address", employee.address]].map(([label, value]) => <div key={label}><small>{label}</small><b>{value || "—"}</b></div>)}</div></section><div className="employee-stat-grid"><article className="employee-stat"><span>Attendance records</span><strong>{attendance.length}</strong><small>Attendance history</small></article><article className="employee-stat"><span>Targets</span><strong>{targets.length}</strong><small>Assigned KPIs</small></article><button className="employee-stat employee-stat-action" onClick={() => onOpen("My Attendance")}>Open attendance →</button><button className="employee-stat employee-stat-action" onClick={() => onOpen("My Leave")}>Request leave →</button></div></>;
}

function Breakdown({ data = {} }) {
  const rows = Object.entries(data || {});
  return <div className="employee-breakdown">{rows.length ? rows.map(([name, count]) => <div key={name}><span>{name}</span><b>{count}</b></div>) : <p>Department reporting will appear when employees are assigned.</p>}</div>;
}

function ReportsPage({ reports, onRangeChange }) {
  return <section className="employee-card"><div className="employee-toolbar"><div><h3>Employee reports</h3><p>Headcount, attendance and target performance in your authorized scope.</p></div><label>Month filter<input type="month" onChange={onRangeChange}/></label></div><div className="employee-report-grid"><article><h4>Employees</h4><p>Total <b>{reports.employees?.total || 0}</b></p><p>Active <b>{reports.employees?.active || 0}</b></p><p>Inactive <b>{reports.employees?.inactive || 0}</b></p><Breakdown data={reports.employees?.by_department}/></article><article><h4>Attendance</h4><p>Present <b>{reports.attendance?.present || 0}</b></p><p>Absent <b>{reports.attendance?.absent || 0}</b></p><p>Leave <b>{reports.attendance?.leave || 0}</b></p><p>Attendance <b>{reports.attendance?.attendance_percentage || 0}%</b></p></article><article><h4>Targets</h4><p>Target <b>{reports.targets?.target || 0}</b></p><p>Achievement <b>{reports.targets?.achievement || 0}</b></p><p>Achievement <b>{reports.targets?.achievement_percentage || 0}%</b></p><p>Below target <b>{reports.targets?.below_target || 0}</b></p></article></div><h4 className="employee-franchise-report-title">Franchise breakdown</h4><div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>Franchise</th><th>Employees</th><th>Active</th><th>Attendance %</th><th>Target</th><th>Achievement</th><th>Achievement %</th></tr></thead><tbody>{(reports.employees?.franchise_summary || []).map(item => <tr key={item.franchise_id}><td>{item.franchise}</td><td>{item.employees}</td><td>{item.active_employees}</td><td>{item.attendance_percentage}%</td><td>{item.target}</td><td>{item.achievement}</td><td>{item.achievement_percentage}%</td></tr>)}{!reports.employees?.franchise_summary?.length && <tr><td colSpan="7" className="employee-empty">No franchise performance data.</td></tr>}</tbody></table></div></section>;
}

function AuditPage({ logs }) {
  return <section className="employee-card"><div className="employee-toolbar"><div><h3>Employee audit history</h3><p>Changes and access decisions are recorded by the API.</p></div></div><div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>Time</th><th>Actor</th><th>Role</th><th>Action</th><th>Entity</th><th>Entity ID</th></tr></thead><tbody>{logs.map(log => <tr key={log.id}><td>{new Date(log.timestamp || log.created_at).toLocaleString()}</td><td>{log.actor_id}</td><td>{log.role}</td><td>{log.action}</td><td>{log.entity}</td><td>{log.entity_id}</td></tr>)}{!logs.length && <tr><td colSpan="6" className="employee-empty">No employee audit events yet.</td></tr>}</tbody></table></div></section>;
}

export default EmployeeManagement;
