# Zyngram Franchise Cloud

A React and Express prototype for customer accounts, location capture, franchise hierarchy, order attribution, commission calculation, audit logging, and administrator reporting.

## Run locally

Use two terminals from the project folder.

```powershell
cd backend
npm install
npm start
```

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. For production, set `VITE_API_URL` as described in `frontend/.env.example` before building.

## Demo administrator

- Email: `admin@zyngram.com`
- Password: `admin123` (local demo only)

The backend bootstraps this account once in `backend/data/schema.json`. Override it with `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env`. Production startup rejects the demo password; never publish these local demo credentials. Copy `backend/.env.example` as a local starting point.

Only an administrator can provision HQ, Command, Hub, and Center staff accounts. Command, Hub, and Center accounts must be assigned to an active franchise at their matching level, and sign-in revalidates the complete active parent chain. Their franchise reads and dashboards are scoped to their assignment; HQ has organization-wide read access but cannot provision privileged staff. Customer management lists expose customer profiles only; HQ can view customer details, while customer create/update remains administrator-only. `backend/test/roleAccess.test.js` exercises staff access scopes, and `backend/test/managementApi.test.js` verifies customer and franchise management permissions.

Customers can register with an email address and password, then sign in to capture and inspect saved locations, see the mock-geocoded area and configured Point → Center → Hub → Command mapping, book a service from an eligible location, and view only their own booking statuses. Email verification and email-based password recovery are not enabled. Passwords are stored as salted scrypt hashes and cannot be retrieved in plain text. Location views use an interactive Leaflet/OpenStreetMap map with accuracy circles, live movement trails, and the matched GeoJSON franchise boundary. Live GPS tracking is opt-in, remains active only until the customer stops it or leaves the page, and does not automatically save updates; saving a location is a separate customer action. Map tiles are loaded from OpenStreetMap, so map use requires internet access. A booking requires a configured franchise match and GPS accuracy of 100 m or better.

The administrator workspace supports searchable customer and franchise lists, franchise activation, hierarchy-validated franchise creation, GeoJSON Point boundaries, audited per-location mapping corrections, live booking and attribution inspection, versioned commission rules, commission lifecycle transitions (Calculated → Eligible → Approved → Settled, or Reversed), and date-filtered backend commission reporting. Reversing a settled commission creates an idempotent wallet debit and requires an audit reason. The physical franchise hierarchy is Command → Hub → Center → Point; the optional digital hierarchy Nation → Region → Territory → Zone → Node can be configured above a Command and is included in mapping and attribution snapshots when present.

The service catalogue includes a backend-validated Mobile Recharge **demo order** (Indian number, configured operator/circle, and ₹10–₹10,000 whole-rupee amount). Requests accept an `Idempotency-Key` to make network retries safe and use the existing attribution/commission lifecycle. No telecom or payment provider is connected, so this is not an actual completed recharge.

## End-to-end demo walkthrough

1. Start both services, sign in as the demo administrator, and provision the Command → Hub → Center → Point franchise chain. Create an active GeoJSON polygon boundary for the Point.
2. Register a customer, then capture a saved location inside the polygon with GPS accuracy of 100 m or better. The customer location view should show the matched hierarchy and boundary.
3. As the customer, choose a configured service and create a booking. Verify the backend-selected service price and `CREATED` status; client-submitted prices are ignored.
4. As authorized staff, confirm the booking. Inspect its attribution snapshot for the mapped physical hierarchy, mapping version, coordinates, GPS metadata, and exact commission-rule versions selected for the order.
5. Verify the order's commission ledger entries for each configured level. Change or add a later commission rule and confirm the existing order again; its stored attribution and commission entries should remain unchanged and no duplicate entries should be created.
6. As an administrator, settle a commission entry. The owner wallet should receive one corresponding credit, and repeating settlement should not add a second credit. Dashboard metrics and the date-filtered commission report show total, settled, pending, and per-level amounts.
7. Try a customer-only session against an administrator-only commission action and an order belonging to a different customer. Both requests should be denied; authorization-denial audit records should be visible in the administrator audit history.

## Main API routes

| Method | Route | Access / purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create a customer account |
| `POST` | `/api/auth/login` | Authenticate any active account |
| `GET` | `/api/auth/me` | Current authenticated account |
| `POST` | `/api/auth/logout` | Revoke current in-memory session |
| `POST` | `/api/auth/admins` | Admin-only staff account provisioning |
| `GET`, `POST`, `PATCH` | `/api/users` | Admin/HQ customer listing; admin customer create/edit/status |
| `POST` | `/api/locations/capture` | Customer saves own coordinates; admin can capture for a customer |
| `GET` | `/api/locations/user/:userId` | Customer reads own locations; admin/HQ can read customer locations |
| `POST` | `/api/geo-mapping/map` | Resolve a coordinate against configured boundaries |
| `POST` | `/api/geo/reverse-geocode` | Clearly marked mock geography lookup |
| `GET` | `/api/geo/franchise-map?lat=…&lon=…` | Resolve hierarchy from coordinates |
| `POST` | `/api/geo/mapping-corrections` | Admin-only location correction with reason and audit entry |
| `GET`, `POST`, `PATCH` | `/api/franchises` | Read scoped hierarchy; admin/HQ create or update franchises |
| `GET`, `POST`, `PATCH` | `/api/geo-boundaries` | Read scoped boundaries; admin/HQ create/version or activate/deactivate polygons |
| `POST` | `/api/orders` | Customer self-booking or admin/HQ-assisted booking for a saved location |
| `GET` | `/api/orders` | Own customer bookings or orders within an assigned franchise |
| `GET` | `/api/services` | List demo services and backend-configured demo prices |
| `GET` | `/api/ready` | Unauthenticated readiness check for the current JSON data store |
| `POST` | `/api/orders/:id/confirm` | Server-side mapping, immutable attribution, commissions |
| `GET` | `/api/attributions/:orderId` | Admin/HQ, assigned staff, or that order's customer |
| `GET` | `/api/commissions` | Admin/HQ commission ledger |
| `GET` | `/api/commissions/:ownerId` | Admin or matching owner ledger |
| `GET`, `POST` | `/api/commissions/rules` | Staff rule listing; admin-only versioned rule creation |
| `POST` | `/api/commissions/:ledgerId/settle` | Admin settlement status and audit event |
| `POST` | `/api/commissions/:ledgerId/eligible` | Admin marks a calculated commission eligible |
| `POST` | `/api/commissions/:ledgerId/approve` | Admin approves an eligible commission |
| `POST` | `/api/commissions/:ledgerId/reverse` | Admin reverses a commission with a required reason; settled reversals debit wallet |
| `GET` | `/api/dashboard` | Role-scoped metrics, including pending/settled commissions and wallet balance |
| `GET` | `/api/reports/commissions` | Admin/HQ date-filterable commission report with level and settlement summaries |
| `GET` | `/api/audit-logs` | Admin audit history |

Protected API requests use `Authorization: Bearer <token>`. Booking prices come from the backend service catalog; the API ignores client-supplied amounts and customer IDs for customer accounts. Commission processing resolves orders, locations, and attribution from backend data; it does not accept frontend-supplied recipients or amounts. Customers cannot confirm orders or trigger commission settlement; authorized staff confirm bookings. Reconfirming an order reuses existing ledger entries.

## Data and geo provider

The developer-local `backend/.env` uses the supplied `mongodb://localhost:27017` URI and database `zyngram_day10`; the file is ignored by Git. JSON fixtures supplied through `ZYNGRAM_DATA_FILE` force isolated JSON mode for tests. The Mongo adapter keeps an aggregate state snapshot and mirrors 25 entity collections with indexes. It is a single-instance migration bridge, not a production transactional repository; do not use it for public ledger/recharge traffic. Mongo-backed sessions are SHA-256 hashed, expire after seven days and survive process restarts. Production CORS origins and administrator secrets are validated at startup.

The reverse-geocoding route deliberately uses a `TEST_MOCK` provider for the configured Visakhapatnam demo area and returns `UNRESOLVED` elsewhere. Franchise assignment uses configured polygon boundaries only; an unmapped point stays unmapped unless an administrator explicitly records a correction, including its reason, actor, and mapping version. Mapped lookups return the active polygon geometry so the UI can display the exact boundary used for the assignment. Browser geolocation requires permission and a secure browser context (localhost is supported). Interactive map tiles come from OpenStreetMap and are not part of the local demo geocoder.

## Checks

```powershell
cd frontend
npm run lint
npm run build
cd ..\backend
npm test
```

The backend tests include invalid and unmapped booking inputs, low-accuracy locations, missing IDs, duplicate confirmation/settlement, authorization denials, report date validation, and dashboard/report metric assertions.

## Employee management (Day 11)

Employee management is integrated into the authenticated Admin and franchise staff dashboards under **Employees**. Admins have organization-wide access. Existing `COMMAND`, `HUB`, and `CENTER` accounts are the franchise-manager roles and can create/update employees, approve leave, and manage targets only within their assigned active franchise and its descendants. `HQ` has read-only centralized access. Employee records create linked `EMPLOYEE` sign-in accounts; the initial password is supplied at creation. Employee status changes synchronize the account status, and every authenticated API request rechecks it, so inactive, resigned, and terminated employees cannot continue to use existing sessions.

The employee self-service workspace is available after signing in with the created employee email and initial password. Employees can view their profile, submit/cancel leave, check in/out, view their attendance and targets, upload/download their own documents, and view their notifications.

| Method | Route | Purpose / authorization |
| --- | --- | --- |
| `GET`, `POST` | `/api/employees` | List employees in the caller's scope with search, filters, pagination and sorting; managers create employees |
| `GET` | `/api/employees/:id` | Employee profile, visible to Admin/HQ, in-scope franchise managers, or the employee |
| `PUT`, `PATCH` | `/api/employees/:id`, `/api/employees/:id/status` | Scoped manager edits and soft lifecycle status changes |
| `GET` | `/api/employees/me` | Employee's own profile |
| `GET`, `POST`, `PUT`, `PATCH` | `/api/departments`, `/api/departments/:id` | View, create, edit, activate/deactivate departments |
| `GET`, `POST`, `PUT`, `PATCH` | `/api/designations`, `/api/designations/:id` | View, create, edit, activate/deactivate department-linked designations |
| `GET`, `POST`, `PUT`, `PATCH` | `/api/work-locations` | Work location listing; Admin-only maintenance |
| `POST`, `GET` | `/api/attendance/check-in`, `/api/attendance/check-out`, `/api/attendance` | Self check-in/out, manager attendance entry, or scope-filtered attendance read |
| `POST`, `GET`, `PATCH` | `/api/leaves`, `/api/leaves/:id/approve`, `/api/leaves/:id/reject`, `/api/leaves/:id/cancel`, `/api/leaves/:id/document` | Leave request, scoped decision and supporting-document download, and employee cancellation; approvals update attendance |
| `POST`, `GET`, `PUT` | `/api/targets` | Scoped targets and backend-calculated achievement percentages |
| `POST`, `GET` | `/api/employees/:id/documents` | Upload/list metadata for employee documents |
| `GET`, `DELETE` | `/api/documents/:id/download`, `/api/documents/:id` | Authorized download and manager-only archival |
| `GET` | `/api/employees/dashboard`, `/api/employees/reports`, `/api/employees/audit` | Scope-aware employee metrics, date-filtered reports, and employee audit history |
| `GET`, `PATCH` | `/api/employees/notifications`, `/api/employees/notifications/:id` | Employee-owned notification feed and read state |

Employee search query parameters include `search`, `department`, `designation`, `franchise_id`, `state`, `district`, `employment_type`, `status`, `fromJoiningDate`, `toJoiningDate`, `page`, `pageSize`, `sortBy`, and `sortOrder`; filter parameters can be combined. Employee lifecycle states are `ACTIVE`, `INACTIVE`, `RESIGNED`, and `TERMINATED`. At startup the JSON schema is migrated with `Employees`, `Departments`, `Designations`, `WorkLocations`, `EmployeeFranchiseMapping`, `Attendance`, `LeaveRequests`, `Targets`, `PerformanceRecords`, `EmployeeDocuments`, and `Notifications`; entity shapes are listed in `backend/src/models/dataModels.js`.

Employee and document records are included in the imported Mongo entity collections when MongoDB mode is enabled, or remain in the JSON fixture in isolated test mode. Document content is limited to 3 MB per upload and is only returned by the authenticated download endpoint. It is still stored in the aggregate application snapshot; move it to private object storage before production.

## Day 12 readiness and deployment

See [the production readiness report](./docs/DAY12_PRODUCTION_READINESS.md), [security test report](./docs/DAY12_SECURITY_TEST_REPORT.md), and [deployment guide](./docs/DEPLOYMENT.md). Run `npm run migrate:mongodb -- --dry-run`, then `npm run migrate:mongodb` and `npm run verify:mongodb` from `backend` to import and verify local Day 10 data. A Render blueprint exists, but public production launch remains blocked by the snapshot/mirror persistence design, the developer-local-only Mongo URI, private object storage, and real recharge/payment provider integration.

### Day 11 demo walkthrough

1. Sign in as the administrator and open **Employees**. Create an active department, a designation linked to that department, and a work location.
2. In the existing **Staff Access** area, create or use a `COMMAND`, `HUB`, or `CENTER` account assigned to an active franchise. Sign in as that manager and confirm the employee workspace is limited to its franchise hierarchy.
3. As the manager, open **Add Employee** and create an active employee with the required profile, department, designation, franchise, work location, and initial password. Sign in with the employee's email and that password to verify the linked self-service account.
4. As the manager, search and filter the employee list, open the employee profile, update permitted fields, and confirm the profile and audit history reflect the change.
5. As the employee, open **My Attendance** and check in, then check out. Confirm the attendance record and working hours are visible in self-service and in the manager's scoped attendance view.
6. As the employee, submit a leave request. As the assigned manager, approve or reject it and verify the decision appears in the employee's leave list; approval creates the corresponding leave attendance records.
7. As the manager, assign a target and update its achievement. Confirm the achievement percentage is calculated by the backend and visible under **My Targets** and **Reports**.
8. Upload an employee document and verify authorized users can download it while an out-of-scope manager cannot. Archive the document and confirm it is no longer downloadable.
9. In the administrator workspace, review organization-wide reports and **Audit Logs**. Repeat employee, attendance, leave, and target reads as the other franchise manager to verify they remain scoped.
10. Verify negative access cases with the integration test: an employee cannot access management APIs or another employee's data, an out-of-scope manager cannot read or change the employee, and a resigned employee cannot continue using an existing session or log in again.

Run `node --test test/employeeManagement.test.js` from `backend` for the employee workflow and authorization checks, or run `npm test` there for the complete backend suite. The integration test uses an isolated temporary JSON data file and does not alter the demo database.
