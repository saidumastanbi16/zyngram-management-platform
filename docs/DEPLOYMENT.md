# Deployment guide and release gate

This guide applies only to the `zyngram-day10` repository. The selected target is Netlify for the frontend, Render for the API, and MongoDB Atlas for persistence. A local MongoDB snapshot/mirror adapter is available, but it is single-instance, aggregate-state based and size-capped; production writes use multi-document transactions only on a replica set or sharded cluster. **Do not deploy this adapter as a production financial/recharge service**. Complete the database/session/object-storage blockers in `DAY12_PRODUCTION_READINESS.md` first.

## Local build and smoke test

```powershell
cd backend
npm test
npm start
```

`backend/.env` is a developer-local, ignored file configured for the supplied `mongodb://localhost:27017` URI and database `zyngram_day10`. `localhost` from a Render service is the Render container, not this computer. Never use this URI in Render. `ZYNGRAM_DATA_FILE` explicitly forces isolated JSON mode for test fixtures.

In another terminal:

```powershell
cd frontend
npm run lint
npm run build
```

Verify `GET http://127.0.0.1:5050/api/health` and `GET http://127.0.0.1:5050/api/ready`. Mongo readiness reports `storage: mongodb` and whether multi-document transactions are supported. Stop the API before running `npm run verify:mongodb` from `backend`: verification creates and deletes a test session and should not race with the running server's cached state. Restart the API after verification.

## Local database migration

The importer is one-time and refuses to overwrite an existing database:

```powershell
cd backend
npm run migrate:mongodb -- --dry-run
npm run migrate:mongodb
npm run verify:mongodb
```

It validates source rows and cross-collection references, stores a SHA-256/count receipt, seeds the service catalogue, imports the aggregate application state, creates per-entity Mongo collections/indexes, and verifies row counts. `Customers` and `FranchiseOwners` are derived projections from Users and franchise owner references; franchise owner references without an account are marked `UNLINKED` and must be reconciled before production. The JSON source file is left unchanged. The current application still uses a cached whole-state snapshot as canonical data and updates mirrored collections; this is a migration bridge, not the final normalized repository. Production startup rejects MongoDB topologies without transaction support. Keep one backend instance.

## Environment configuration

Copy `backend/.env.example` to an untracked local `.env`. For a production-like backend, set:

- `NODE_ENV=production`
- `PORT` to the port supplied by the hosting platform
- `HOST=0.0.0.0` where the platform requires a public container listener
- `CORS_ORIGINS` to the exact comma-separated HTTPS frontend origins; `*` is rejected
- `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters; the local demo password is rejected
- `ZYNGRAM_DATA_FILE` only for isolated local/test JSON files (not as a substitute for a production DB)

Set `VITE_API_URL` from `frontend/.env.example` to the HTTPS API origin before creating a frontend build. Vite embeds this value into the static bundle, so rebuild when it changes. Keep real secrets out of source control and frontend environment variables.

## Netlify frontend + Render API

The Netlify project is connected to `saidumastanbi16/zyngram-management-platform`, auto-publishes `main`, and its production site is public at `https://zyngram-management-platform.netlify.app`. [`netlify.toml`](../netlify.toml) configures the frontend base directory, build command, and publish directory for Git builds.

The Netlify production environment has `VITE_API_URL` set to `https://zyngram-management-platform.onrender.com`. The production build intentionally fails if this value is missing or malformed. This value is public frontend configuration; never put MongoDB credentials or administrator secrets in Netlify. Production admin sign-in fields are blank by default; local demo credentials are prefilled only in development mode.

Render's public API origin is `https://zyngram-management-platform.onrender.com`. Its current deployment is live; `GET /api/health` returns HTTP 200 and `GET /api/ready` returns `ready: true` with `storage: mongodb`. Requests to both endpoints from the Netlify origin also succeed. Render has masked `MONGODB_URI`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` variables configured. `CORS_ORIGINS` is set to the Netlify production origin.

The Atlas `Cluster0` database `zyngram_day10` was initially empty. The guarded `MONGODB_BOOTSTRAP_EMPTY=true` setting created a blank app state only because the database had no collections; it refused to initialize over existing collections. After readiness was verified, the one-time flag was removed and Render was redeployed successfully. The local JSON fixture and its demo/customer records were not imported. To recover a known administrator account, set a strong `ADMIN_PASSWORD` and `ADMIN_PASSWORD_RESET_ON_BOOT=true` in Render, deploy, verify the account, then remove the reset flag and redeploy. The reset flag only updates an existing ADMIN account matching `ADMIN_EMAIL`, revokes that account's sessions, writes an audit entry, and removes itself from the running process; it fails startup if no matching administrator exists. Do not leave the flag configured across restarts. Admin sign-in has not yet been independently verified.

The frontend is public at `https://zyngram-management-platform.netlify.app` and currently serves the landing page. Verify registration, sign-in, and allowed API requests before relying on those workflows. The included app remains a demo and is not cleared for live financial/recharge traffic; follow the release gate below.

The API limits login to 10 attempts per client IP per 15 minutes and registration to 10 attempts per client IP per hour. The limiter uses in-memory per-instance state, so keep the configured single backend instance or replace it with a shared store before scaling. Production trusts one reverse-proxy hop to obtain client IPs; review that setting if the hosting topology changes.

## Release checklist

1. Back up the Day 10 store and record per-entity counts/checksums.
2. Complete and test the selected database migration, verify relationships and constraints, and reconcile record counts.
3. Provision durable sessions, private object storage, HTTPS, secrets, backups, monitoring and alerts.
4. Deploy the backend and verify health/readiness, auth, CORS, logs and database connectivity.
5. Build and deploy the frontend with the production `VITE_API_URL`; verify registration and allowed API access over HTTPS.
6. Run the end-to-end customer → location → mapped franchise → service order → attribution → commission → ledger workflow in staging.
7. Run the authorization/security scenarios: altered customer/franchise IDs, cross-franchise reads, employee access to admin routes, private document access, inactive login, duplicate order key and duplicate commission settlement.
8. Confirm real recharge/payment provider readiness separately. The included Mobile Recharge flow is explicitly demo-only: its staff completion status is `DEMO_COMPLETED`, commissions are demo ledger entries, and no telecom recharge is submitted.
9. Obtain an approval and rollback plan before production traffic.

## Render + MongoDB Atlas deployment status

[`render.yaml`](../render.yaml) declares a single-instance backend and static frontend. The Netlify frontend and Render API are live, and the API is ready against Atlas. The public URLs are `https://zyngram-management-platform.netlify.app` and `https://zyngram-management-platform.onrender.com`. The live Atlas database was initialized as a blank app state; local demo data was not imported. This verifies hosting, database connectivity and cross-origin API access, **not** production suitability or complete customer/admin workflows. Do not use the snapshot/mirror store as a production franchise/order/ledger system.

Before accepting real production traffic:

1. Complete the production blockers in [the readiness report](./DAY12_PRODUCTION_READINESS.md), especially normalized transactional storage and private object storage.
2. Review Atlas network access and least-privilege database credentials; configure backups and rehearse restore on a separate staging database.
3. Verify the Render `ADMIN_EMAIL` and strong `ADMIN_PASSWORD` through the secret UI and confirm administrator sign-in. Never paste secrets into chat, commit them, expose them as `VITE_*`, or include them in logs.
4. Keep backend `CORS_ORIGINS` restricted to the exact static-site HTTPS origin and frontend `VITE_API_URL` pointed at the backend HTTPS origin.
5. Run health/readiness, end-to-end, and security flows in staging. Promote only after approval and rollback/backup rehearsal.

The public demo is available at the URLs above; it is not approved for real financial/recharge traffic until the production release gate passes.
