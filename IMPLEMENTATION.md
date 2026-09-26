# DrainageDoctor implementation

This release is a functional intake and engineering-review application with an explicitly illustrative diagnostic workspace. It does not satisfy the full production PRD.

## Implemented

- Responsive project workspace, network diagram, node selection and zoom.
- Private account-owned projects in D1; request-side authorization for every data endpoint.
- SWMM INP intake with explicit unit preservation, structural checks, SHA-256 provenance, and original bytes in R2.
- Immutable model version records and server-side audit events.
- Illustrative hotspot evidence, cause ranking, candidate comparison, and storm matrix.
- Saved candidate selection, review notes, project editing, original model download, CSV hydrograph export, and Markdown evidence export.
- Real imported models never inherit example hydraulic results.

## Production work still required

- Version-pinned SWMM execution workers, asynchronous queue, cancellation/retry, mass-balance and benchmark verification.
- Actual deterministic counterfactual generation, hydraulic result ingestion, intervention scoring, and multi-storm simulation.
- Organization memberships and RBAC, secure sharing, approval signatures, SSO/MFA, quotas and billing.
- GIS overlays, calibration workflows, durable rainfall libraries, optimization, AI grounded explanation, PDF reports.
- Complete audit UI, revision conflict handling for concurrent reviewers, backups, observability and operational acceptance.

## Local development

Install dependencies and run `npm run dev`. The portable server uses port 5173. Windows environments with a broken npm command shim can invoke their installed `npm-cli.js` directly with Node. The starter's local sign-in helper supplies a development identity; hosted private Sites supplies trusted authenticated-user headers.

Generate migrations with `npm run db:generate`, build, and apply the generated SQL to the local DB using the README procedure. Hosted publishing applies migrations automatically. Never reuse local demo identity in production.

## Verification

Run `node --test tests/intake.test.mjs`, `npx tsc --noEmit`, and `npm run build`. API smoke tests should verify persisted projects, invalid INP rejection, file-byte round trips, foreign-owner rejection, and missing-auth rejection. No hydraulic solver benchmarks are claimed.

## Data limits

INP uploads: 5 MB; network display: first 500 connected nodes; project list: latest 100; review notes: 100 notes, 2,000 characters each. Unsupported sections are preserved in the original file and disclosed. Intake is not a replacement for SWMM input validation.
