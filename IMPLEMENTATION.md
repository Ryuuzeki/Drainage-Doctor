# DrainageDoctor implementation

This release supports real SWMM baseline execution in an isolated browser worker alongside an explicitly illustrative causal-diagnostic workspace. It does not satisfy the full production PRD.

## Implemented

- Responsive project workspace, network diagram, node selection and zoom.
- Private account-owned projects in D1; request-side authorization for every data endpoint.
- SWMM INP intake with explicit unit preservation, structural checks, SHA-256 provenance, and original bytes in R2.
- Immutable model version records and server-side audit events.
- Illustrative hotspot evidence, cause ranking, candidate comparison, and storm matrix.
- Saved candidate selection, review notes, project editing, original model download, CSV hydrograph export, and Markdown evidence export.
- Real imported models never inherit example hydraulic results.
- Real EPA SWMM 5.2.2 baseline runs using the original uploaded INP bytes, with cancellation and a 120-second timeout.
- Saved run history tied to model SHA-256; immutable terminal run records and content-addressed original RPT files.
- Server-side report parsing, original-unit node flooding/depth/conduit tables, mass-balance and convergence warnings.
- Current-model evidence filtering, real audit history, evidence JSON and raw solver report downloads.

## Execution and trust boundary

The pinned `@fileops/swmm-wasm-web@0.0.4` package contains EPA SWMM 5.2.2. Its unmodified bundle is served from this application. Bundle SHA-256: `ddad7d4c6b685973f3252b46f5a015499dbe88c3141b2fd5c89802c3817450ec`.

The browser computes results in a Web Worker; the server checks identity, model ownership/hash, units, node count, report completeness, and engine version before storing the parsed report. This is **client execution**, not independently verified or signed server execution. A malicious client can submit fabricated report contents; results are labeled accordingly and never treated as engineering approval.

Self-contained files only: external rainfall, hotstart, and other file references require preprocessing. Inputs and dates are preserved. The app reads ponded depth only when SWMM reports a Depth column; kinematic-wave ponded volume is never reinterpreted as depth. Node flood volume is not equivalent to net system flood loss when ponding returns water to the network. All report precision and warnings are retained.

## Production work still required

- Independently verified server-side SWMM workers, durable job queue, retries, broader hydraulic benchmarks, and large-model execution.
- Actual deterministic counterfactual generation, hydraulic result ingestion, intervention scoring, and multi-storm simulation.
- Organization memberships and RBAC, secure sharing, approval signatures, SSO/MFA, quotas and billing.
- GIS overlays, calibration workflows, durable rainfall libraries, optimization, AI grounded explanation, PDF reports.
- Model version browsing, revision conflict handling for concurrent reviewers, backups, observability and operational acceptance.

## Local development

Install dependencies and run `npm run dev`. The portable server uses port 5173. Windows environments with a broken npm command shim can invoke their installed `npm-cli.js` directly with Node. The starter's local sign-in helper supplies a development identity; hosted private Sites supplies trusted authenticated-user headers.

Generate migrations with `npm run db:generate`, build, and apply the generated SQL to the local DB using the README procedure. Hosted publishing applies migrations automatically. Never reuse local demo identity in production.

## Verification

Run `node --test tests/intake.test.mjs tests/solver.test.mjs`, `npx tsc --noEmit`, and `npm run build`. `tests/api-smoke.mjs` and `tests/runs-api.mjs` run against a local built Worker on port 8787 and create local test records only.

The actual browser solver was run twice on the synthetic inflow fixture with identical parsed numerical results. A native `swmm-toolkit==0.17.0` run (SWMM 5.2.4) is recorded in `tests/fixtures/native-swmm-5.2.4.rpt`: peak ponded depth differs by 0.001 m and total rounded flood volume matches. The regression tolerance is 0.002 m/0.002 million liters on this single fixture, not a claim of comprehensive engine equivalence. Native and browser versions differ and are disclosed.

Additional engine tests cover imperial units, no-flooding runs, kinematic routing's distinct ponded-volume semantics, solver rejection, missing summaries, mass-balance warnings, external files, and execution limits.

## Data limits

INP uploads: 5 MB; browser solver: 500 nodes, 2,000 conduits, 7 simulation days, 12,000 reporting periods, report step at least 30 seconds, execution timeout 120 seconds. Network display: first 500 connected nodes; project list: latest 100; run history: latest 50; review notes: 100 notes, 2,000 characters each. Unsupported intake sections are preserved for the solver. Intake is not a replacement for SWMM input validation.
