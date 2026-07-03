# Blueprint Reviewer Agents

Stage-gate agents that block premature stage completion. Variant-aware: each gate behaves differently per `blueprint.yml` `variant:` declaration.

Canonical reference: `tools/blueprint/docs/variant-selection.md`.

## Roster

| Agent | Gate | Variants |
|---|---|---|
| `stateful-claim-lint-reviewer` | Cadence + `doctor` check 8 (counts/versions/latest-claims vs sources of truth) | All (checks skip where sources are absent) |
| `pilot-profile-lock-reviewer` | Stage 0 → Stage 1 | All |
| `research-completeness-reviewer` | Stage 1 → Stage 2 | All |
| `design-principles-reviewer` | Stage 2 → Stage 3 | Greenfield |
| `prescription-evidence-reviewer` | Stage 2 → Stage 3 | Midstream, Brownfield |
| `prescription-jtbd-traceability-reviewer` | Stage 2 → Stage 3 (runs alongside `prescription-evidence-reviewer`) | Midstream, Brownfield |
| `portal-pattern-a-conformance-reviewer` | Stage 3 completion (Pattern A) **and** any commit touching `apps/portal/` | All initiatives at Tier 1+ on Pattern A |
| `portal-pattern-b-conformance-reviewer` | Stage 3 completion (Pattern B) **and** any commit touching `portal/` or `blueprint/portal/` | All initiatives at Tier 1+ on Pattern B |
| `portal-chrome-canonical-reviewer` | Stage 3 completion (Pattern B) **and** any commit touching `portal/` or `blueprint/portal/` | All initiatives at Tier 1+ on Pattern B (Pattern A audit deferred) |
| `prototype-forge-provenance-reviewer` | Stage 3 completion (after portal-conformance + chrome-canonical pass) | All initiatives with substantive prototype (≥500 HTML/CSS lines); skips on explicit `forge_pipeline.skip: true` declaration |
| `fact-check-loop-reviewer` | Stage 4 convergence orchestrator | All |
| `doc-quality-auditor` | Stage 5 → Stage 6 | All |
| `terminology-linter` | Stage 5 → Stage 6 (parallel with doc-quality-auditor) | All |
| `prototype-smoke-runner` | Stage 6 ship gate | Greenfield, Midstream, Brownfield-if-prototype |
| `defrag-reviewer` | Cadence pass (per wave / pre-release) — NOT a stage gate; never blocks | All |
| `doc-currency-reviewer` | Continuous — runs inside `blueprint doctor`; also Stage 5 → Stage 6 alongside doc-quality-auditor | All |

### Pattern selection for the portal-conformance gate

Run exactly one of the two portal-conformance reviewers per initiative — whichever matches the pattern declared in `blueprint.yml` (or inferred from the directory layout: `apps/portal/` ⇒ Pattern A, `portal/` or `blueprint/portal/` ⇒ Pattern B). Running both is a configuration error; running neither at Stage 3 on a Tier 1+ initiative is a methodology violation (the failure mode is the v1-with-deliberation-shape, 11-variants-walking portal the blog session shipped pre-2026-05-25).

**Exception — bespoke portal (neither pattern fits the archetype).** An initiative whose archetype fits neither Pattern A nor B (e.g. an operator-facing process console; first instance `ai-content-engine`) runs *neither* conformance reviewer — and that is not a violation **iff** a divergence ADR is present in `decisions/` recording why neither pattern fits (per `docs/portal-and-tier-ladder.md` § "When neither pattern fits the archetype"). The gate inverts here: for a bespoke portal it is the **absence of the divergence ADR** that is the violation, not the absence of a conformance run. Do not down-declare such an initiative to Tier 0 to dodge the gate — a portal's existence makes the tier ≥ 1. **Automated as of wave 48**: `blueprint doctor` enforces this — when `blueprint.yml` declares `portal_pattern: bespoke`, doctor runs neither conformance reviewer and instead checks for a divergence ADR in `decisions/`; present → `portal-conformance: pass`, absent → `fail` (`template/tools/lib/doctor.mjs` § `findDivergenceAdr`). The second bespoke instance — this methodology's own product-site portal (`decisions/02-portal-bespoke-product-site.md`) — triggered the promotion, per the wave-46 "automate on the 2nd instance" rule.

The "any portal-touching commit" trigger applies to midstream and brownfield variants — those variants can edit a portal anywhere along the pipeline, not just at Stage 3. Greenfield gets the gate at Stage 3 completion only (no portal exists earlier).

### Chrome-canonical pairing (Pattern B)

`portal-chrome-canonical-reviewer` runs *alongside* `portal-pattern-b-conformance-reviewer`, not in place of it. They check different things: the conformance reviewer checks whether the consumer's portal has the right *shape* (required files exist, drawers are populated, comparison toggle is wired, I-2/I-3/I-5 invariants hold). The chrome-canonical reviewer checks whether the consumer's chrome files (`shared.css`, `_portal-shell.js`, `proto-nav.js`, `proto-annotate.js`, `_headers`, `_redirects`) are byte-identical to `template/portal/` canonical. The shape can be conformant while the chrome has silently drifted — and the silent-chrome-drift case is the 2026-05-25 v3 bug that motivated this reviewer's existence.

Run order: `portal-pattern-b-conformance-reviewer` first (shape), then `portal-chrome-canonical-reviewer` (chrome), then `prototype-forge-provenance-reviewer` (provenance + JTBD satisfaction). Each layer checks something the others don't — shape, chrome integrity, and content origin / JTBD trace respectively. All three must pass for Stage 3 completion on a substantive prototype.

### Forge-provenance pairing with JTBD-trace

`prototype-forge-provenance-reviewer` (Stage 3) closes the loop opened by `prescription-jtbd-traceability-reviewer` (Stage 2 → 3). The Stage 2 reviewer verifies prescription items trace to Stage 1 JTBDs via `serves_jtbd:` fields; the Stage 3 reviewer verifies the prototype contains surfaces that COULD plausibly satisfy those same JTBDs (structural check; behavioral verification is Stage 6 `prototype-smoke-runner`). Both run under the same ADR-0004 decision — together they prevent JTBD discontinuity end-to-end. See ADR-0004 for the full decision and the website-nc-v3 failures that motivated both reviewers.

## Behavior model

- **Read-only audit, with one exception.** Most reviewers audit; they do not patch. The calling agent owns the fix. The exception is `prototype-smoke-runner`, which actively boots the prototype + drives browse-tool to capture screenshots — it produces artifacts (`.smoke-screenshots/`) but does not modify source files.
- **Variant-aware.** Each reviewer reads `blueprint.yml` to determine variant and adjusts checks accordingly.
- **Block on failure.** A reviewer's verdict is binary — PASS or BLOCKED. The calling agent must resolve all findings before re-invoking. Exception: `defrag-reviewer` is WARN-only by design — it is a cadence coherence pass, not a gate, and blocking on drift would punish in-flight work for consolidation it hasn't had a chance to do yet.
- **Flag only correctness-or-requirement gaps.** A reviewer told to find gaps will manufacture them even when the work is sound — that is what it was asked to do. A BLOCKED verdict is reserved for findings that violate a stated requirement, a JTBD trace, an invariant, or factual accuracy. Stylistic preferences, speculative hardening, and "could also" suggestions are NON-blocking: list them as optional and PASS. Chasing every reviewer finding is how a sound deliverable accretes defensive scope, extra abstraction, and tests for cases that can't happen.
- **Convergence cap.** `fact-check-loop-reviewer` caps at 5 iterations before escalating to the operator. Persistent failure after 5 loops is a signal that the underlying claims are unsupportable, not that more loops will help.
- **Visual gates beat protocol gates.** `prototype-smoke-runner` requires viewport screenshots + CSS-coverage checks alongside the `@smoke` Playwright run. A 200 response from curl is not enough; a green `@smoke` is not enough. Both are blind to unstyled chrome (see `docs/case-studies/case-study-v3-portal-css-gap.md`).

## Location convention

Reviewers live in the **shared template** at `template/.claude/agents/blueprint/reviewers/`. Per-initiative overrides go in the consumer's `.claude/agents/blueprint/reviewers/` and merge on top — but override only for threshold tuning (e.g., a project that needs 6 research legs instead of 4), never for behavior change.

## Runtime model

Reviewers run inside a single orchestrator agent (`fact-check-loop-reviewer` orchestrates the fact-check sub-reviewers; non-fact-check reviewers are invoked directly at their respective gates). Worktree-per-reviewer isolation is deferred until reviewers gain write authority — none of the current set has it.

## Origin

Promoted from the v2 patch Increment 2 deferred set (archived; see `docs/_archive/handoffs/METHODOLOGY-v2-harness-engineering-patch.md` for the original §"Open questions to resolve before increment 2"). The v3 variant taxonomy provided the missing per-variant gating that made the reviewer set codifiable; its current home is `docs/variant-selection.md`.
