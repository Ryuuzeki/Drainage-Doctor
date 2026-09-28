# V4 evidence-integrity audit

Scope: V4 implementation against the supplied audit PRD, following V3 commit b28f347. This is an implementation and regression audit, not certification of hydraulic inputs or an independent engineering review.

## Critical regression coverage

| Question / defect | Verified behavior |
| --- | --- |
| Untested repair displayed PASS | Empty candidate stress evidence yields UNTESTED; non-selected candidates never inherit scenarios. |
| Partial scenarios | Missing rows or incomplete pairs yield INCOMPLETE; failed rows yield FAIL. |
| Selected repair identity | Every generated scenario applies the selected spec to the scenario baseline; input SHA-256 is checked before accepting solver output. |
| Absolute benefit outranks elasticity | Controlled A=40%, E=.8 versus B=25%, E=2 ranks B first with equal quality. |
| Conflicting dominant labels | V4 has only diagnosis.dominant; summary/PDF use the common adapter and match ranking[0] when a supported dominant exists. |
| Unfair candidate grids | Round-robin grids are equivalent within family bounds; C1 first passes at 50%, C2 at 30%, and C2 is selected and stress-tested. |
| Chained modifications | Each attempt hash matches generation from the original baseline. |
| Budget overrun | Tests at budgets 1, 7, 11, 15 and 24 count actual solve calls; baseline and failures are counted, stress is reserved, and no hidden autopsy retry occurs. |
| Non-monotonic response | 5→10, 10→8, 20→30 remains visible and UNRELIABLE; a valid monotonic alternative ranks above it. |
| Last-point elasticity | Median resists an outlier; colon-containing asset IDs remain intact. |
| Numerical failure / network harm | Invalid points cannot support STRONG diagnosis; harmful repair attempts never pass selection. |
| Interrupted final scenario | Cancellation during the final solve still yields INCOMPLETE, never PASS. |
| Failed hypothesis | Successful evidence survives and the analysis reports INCOMPLETE with explicit failure rows. |
| PDF truncation | Wrapped, paginated output retains final warnings, long labels, hashes and limitations. |
| Legacy evidence | V2/V3 stored metrics are preserved without reanalysis; unbound historical robustness is not certified as V4 PASS. |
| Taxonomy | Structured domain codes win; specific security/time/hydrology/numerical patterns precede generic input errors. |

The controlled response tests exercise algorithm decisions. Separate real SWMM tests cover pipe/friction/storage/inlet/tailwater response, rainfall-runoff, mass balance, units, transferred flooding and the full autopsy pipeline. Trusted HTTP tests verify authentication, immutable jobs, artifact hashes, genuine worker execution and timeout handling.

## Local application evidence

The smoke workflow creates a clearly named local verification project and checks upload, baseline, V4 autopsy, original RPT, PDF, budget and rejection of forged reports. On the supplied synthetic demo, the preferred repair is C1 roughness reduction at 10%; two forcing scenarios pass and the 1.25x case fails. Overall robustness is correctly FAIL, while execution completes. This is an observed sample outcome, not a claim that all inputs behave alike.

Browser QA checks desktop and 390px mobile layouts, elasticity-based bar widths, selected robustness and browser errors. PDF QA parses the real endpoint output and renders all pages for inspection. The sample report is 10 pages and retains the final limitations. Local generated evidence is ignored under outputs/v4 rather than treated as a reusable fixture.

## Known limits / final gate

- Reliability thresholds and percent-magnitude repair ordering are disclosed screening choices, not probabilities or cost equivalence across physical interventions.
- Non-Latin PDF labels are preserved as explicit Unicode code-point escapes by the portable built-in-font renderer; no text is silently dropped.
- A service restart before immutable result persistence cannot preserve in-flight partial evidence. Normal timeout/cancellation after baseline completion is handled.
- No regulatory approval, validated return period, calibration claim, optimal repair guarantee or production deployment is implied.

Required release checks are npm test, npm run typecheck, npm run build and GitHub CI for the pushed revision. Deployment stays deferred until final review and demo-data freeze.
