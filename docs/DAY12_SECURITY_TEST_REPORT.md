# Zyngram Day 12 Security Test Report

**Scope:** `zyngram-day10` only. Backend tests run against isolated JSON fixtures; Mongo smoke checks used local `mongodb://localhost:27017`. No public staging environment or penetration test was available.
**Result:** 34 backend tests passed, including login/registration throttling, registered-customer GPS mapping and attribution, migration relationship validation (including historical commission-owner snapshots), MongoDB customer/owner projection checks, and franchise-scoped customer access. A separate startup check confirmed production mode rejects standalone MongoDB. This demonstrates tested application controls, not an independent security certification.

The local Mongo demo branch was also exercised: a Center owner could see its mapped demo customer, two orders, scoped dashboard metrics and Point/Center commission entries within its branch; a new ₹199 demo recharge generated Point/Center/Hub/Command ledger rows using explicit TEST_CONFIGURATION rates. A demo employee was created under the Center; owner-scoped attendance, approved leave, target/KPI and reports were verified, while the employee's direct customer-list and global-commission access attempts were rejected with 403. These rates and records are demonstration-only and are not approved production policy.

## Test evidence

| Security scenario | Result | Evidence |
|---|---|---|
| Missing/invalid login credentials and duplicate registration | PASS | `backend/test/auth.test.js` |
| Inactive user/session rejection | PASS | `backend/test/auth.test.js`, `backend/test/employeeManagement.test.js` |
| Staff role and franchise parent-chain validation | PASS | `backend/test/auth.test.js`, `backend/test/franchiseValidation.test.js`, `backend/test/roleAccess.test.js` |
| Franchise owner customer list/detail restricted to mapped hierarchy | PASS | `backend/test/franchiseCustomerAccess.test.js` |
| Customer attempts to supply a different customer ID / order ownership | PASS | `backend/test/orderWorkflowApi.test.js`, `backend/test/orderAccess.test.js` |
| Client changes service amount / invalid service, low-accuracy and unmapped locations | PASS | `backend/test/orderWorkflowApi.test.js` |
| Customer attempts commission rule or protected operation | PASS | `backend/test/orderWorkflowApi.test.js`, `backend/test/roleAccess.test.js` |
| Duplicate commission calculation / settlement | PASS | `backend/test/orderWorkflowApi.test.js`, `backend/test/commissionLifecycle.test.js` |
| Employee calls management/admin APIs, accesses out-of-scope records or documents | PASS | `backend/test/employeeManagement.test.js` |
| Customer location/franchise mapping is server-calculated | PASS | `backend/test/geoLocationApi.test.js`, `backend/test/orderWorkflowApi.test.js` |
| Registered customer GPS capture returns existing active franchise mapping, creates an attribution snapshot, calculates Point/Center/Hub/Command commissions, settles each wallet credit once, and rejects an unmapped order | PASS | `backend/test/customerGeoAttributionFlow.test.js`; browser permission prompt itself is not automated |
| Recharge number/operator/circle/amount validation and duplicate request key | PASS | `backend/test/orderWorkflowApi.test.js` |
| Login throttling after 10 attempts per IP within 15 minutes | PASS | `backend/test/authRateLimit.test.js` |
| Registration throttling after 10 attempts per IP within one hour | PASS | `backend/test/authRateLimit.test.js` |
| Migration rejects broken order/customer, commission/rule, and employee/department references | PASS | `backend/test/mongoMigrationValidation.test.js` |
| Production startup rejects standalone MongoDB without multi-document transactions | PASS | Direct production-mode startup gate check |
| MongoDB persistence after a new Node process starts | PASS | `npm run verify:mongodb` |

## Not tested / release blockers

- No live Render/Atlas deployment, public HTTPS endpoint, independent penetration test, fuzzing, load/race test, dependency-policy scan, or operational backup/restore rehearsal.
- The Mongo adapter keeps a canonical cached aggregate snapshot and mirrors entity collections. Production writes use transactions on replica-set/sharded topology, but this is not a normalized repository; the design must not be horizontally scaled or used for production financial/recharge traffic.
- The browser flow cannot prove or execute a real mobile recharge. No telecom or payment provider is configured.
- Documents are protected by the application API but stored as base64 in the app state; no private object storage, malware scanning or expiring download links are configured.
- Password recovery/email verification and production abuse monitoring are not enabled. The login/registration rate limiters use an in-memory store and are suitable only for the configured single-instance deployment.

## Go-live security actions

1. Replace the snapshot/mirror adapter with transaction-backed Mongo collections and test duplicate/concurrent requests against a replica set.
2. Use a private Atlas connection from Render, strong secrets in the provider secret store, HTTPS-only origins and a single controlled deployment pipeline.
3. Move documents to private object storage and test cross-franchise and employee access with provider policies.
4. Run independent staging penetration, load and backup/restore tests; resolve all findings before launch approval.
