# DrainageDoctor implementation status

The v3 workflow executes trusted server-side SWMM baselines, normalized multi-magnitude hypotheses, a cross-asset bounded repair search and three paired forcing scenarios. See [README](README.md) for setup, supported experiment families, execution limits, architecture and engineering limitations.

## Evidence and interpretation

The automatic workflow uses the original model independently for each hypothesis. It records parameter changes, input/report/output/engine hashes, execution timestamps, original units, numerical quality, plausibility warnings and network effects. Failed experiments remain visible and cannot outrank valid experiments.

A selected intervention is the first admissible magnitude tested on one selected physical asset. Other combinations are not searched. Tailwater and supplied-runoff sensitivity do not automatically become physical recommendations. Stress results are actual paired solver runs. Multipliers do not imply design return periods or probabilities.

V3 stores `evidence.version = 3` with per-family response curves at 5%, 10% and 20%, local elasticity, monotonicity, normalized ranking, partial-failure counts, cross-asset repair candidates, scenario provenance and solver hashes. V2 evidence remains readable because the legacy hypothesis, search and storm fields are retained. The engineering report endpoint renders the immutable evidence into a downloadable PDF; source JSON, INP, RPT and OUT artifacts remain available.

## Current boundaries

- Custom RATING inlet curves ignore Qmax in SWMM and are excluded from Qmax experiments.
- Only fixed tailwater and existing functional storage are supported.
- Numerical screening uses report values at report precision; surcharge duration is not yet parsed.
- Other-node screening is conservative and includes maximum depth changes, even when flooding does not increase.
- Uploaded storm-model sets, calibration, GIS, monetary cost, multi-asset optimization and real-world causality validation remain future work.
- Legacy illustrative dashboards and browser-run history remain explicitly labeled. New completed results originate from the trusted solver service.
- Production deployment must configure real authentication, Cloudflare bindings and a reachable authenticated solver service. Local configuration is not a production deployment.

The source tests exercise the real engine and trusted HTTP service. GitHub Actions checks TypeScript, tests and the portable production build on every push and pull request.
