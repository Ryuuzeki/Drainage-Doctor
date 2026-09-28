# DrainageDoctor implementation status

V4 binds engineering conclusions to the solver evidence that supports them. The canonical object has one diagnosis, an equivalent cross-asset repair search, selected-candidate forcing evidence and an enforced global run budget.

## Integrity rules

- Every solve passes the central budget and input/engine checks; failed calls count too.
- Autopsy uses 5/10/20% changes from the original baseline; elasticity uses hotspot flood volume and a median across valid points.
- A non-monotonic response is retained and penalized, never silently presented as a strong dominant diagnosis.
- Candidates receive the same ascending grid, clipped only by declared family limits; cached identical autopsy attempts are reused.
- Repair selection completes before stress testing. Each stress pair includes the selected spec and expected input hashes.
- PASS is derived from complete valid pairs. Other candidates are UNTESTED. Interrupted analyses retain evidence with INCOMPLETE execution status.
- UI and paginated PDF consume the same read-only adapter; historical V2/V3 numbers are retained without recomputation.

## Validation and boundaries

See [V4 audit](docs/v4-audit.md) for coverage, real-solver integration, browser/PDF checks and known limitations. No production deployment has been performed.

Calibration, rainfall provenance, construction feasibility, costs, terrain/GIS, multi-asset optimization and real-world causal proof remain outside this release. Fixed tailwater, explicit supported inlet Qmax and existing functional storage are the supported perturbations; custom RATING inlet curves do not respond to Qmax in SWMM. Flooding duration is distinct from surcharge duration.

Service restarts cannot recover an in-flight worker's unsaved intermediate evidence; the interrupted job is marked failed. Normal cancellation after a completed baseline preserves analysis evidence. Single-run and pre-baseline failure records do not claim completed hydraulic conclusions.
