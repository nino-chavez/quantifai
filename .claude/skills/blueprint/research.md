---
name: blueprint-research
description: Research phase of a Blueprint initiative. Produces competitive analysis, codebase exploration, and market comparables. Use during Stage 1 of a new Blueprint initiative when defining scope and identifying reference patterns.
---

# /blueprint-research

Research phase of a Blueprint initiative. Produces competitive analysis, codebase exploration, and market comparables.

## When to use
At the start of an initiative, or when new competitive/market context is needed.

## What it does

1. **Current-state analysis** — If `research.screenshots_path` is set in blueprint.yml, read all screenshots and document what exists today: components, terminology, data displayed, navigation patterns, gaps.

2. **Codebase exploration** — If `research.codebase_path` is set, explore the production repo to assess:
   - What data is available for the proposed features
   - What models, controllers, and services exist
   - What integration points are available (APIs, databases, external services)
   - What UI patterns and CSS frameworks are in use
   Save findings to `research/current-state/codebase-analysis.md`.

3. **Competitive analysis** — For each competitor listed in `research.competitors`, cover the **five research dimensions** from `$BLUEPRINT_HOME/docs/case-studies/design-system-audit.md` (R-1 through R-5):
   - **R-1 IA + dynamic-surface mechanics** — default-view logic, freshness contract, filter/sort affordances above the fold, scale budget, server-side filter/sort (per ux-ui-auditor Phase 8)
   - **R-2 Voice + microcopy** — imperative vs declarative; chrome vs framing; empty-state voice; CTA labels (audit actual UI copy, not marketing)
   - **R-3 Visual language** — palette anchors, type families + display/body split, density, elevation strategy, border strategy
   - **R-4 Motion + micro-interaction** — hover/focus treatment, page transitions, optimistic UI, loading-state pattern (skeleton vs spinner)
   - **R-5 Onboarding / first-60-seconds** — empty canvas vs starter-kit; guided tour vs jump-into-product; where the IA reveals itself
   Document specific patterns with screenshots or descriptions; note what they do well and what they do poorly. If `blueprint.yml prototype.design_system: custom`, all five dimensions are mandatory.
   Save to `research/competitive-analysis/` AND `research/visual-voice-motion-research.md` (or extend existing).

4. **Analogous industry research** — For each industry in `research.analogous_industries`:
   - Search for how that industry solves the same problem
   - Look for call deflection / self-service resolution benchmarks
   - Find regulatory precedent if applicable
   Save to `research/competitive-analysis/`.

5. **Pattern synthesis** — Compile all research into a comparables doc:
   - Organize by pattern category (not by source)
   - For each pattern: what it is, who does it, how it maps, recommendation
   - What to adopt, what to reject, and why
   Save to `docs/content/research-comparables.md`.

## Output files
- `research/current-state/` — screenshots analysis, codebase findings
- `research/competitive-analysis/` — per-competitor and per-industry analysis
- `docs/content/research-comparables.md` — synthesized comparables doc

## Specchain integration

If `specchain.enabled` is true in blueprint.yml:
- Use specchain's `project-discovery` pattern for codebase exploration (four-pass protocol: structure → patterns → data flow → integration points)
- Governance principles from `specchain/governance/principles.md` apply to how findings are reported (scope minimization, traceability, boundary validation)
- In squad mode, parallelize: one agent on codebase exploration, one on competitive research, one on cross-industry research
- Write findings to STATE.md for session persistence across conversations

If specchain is not available, the researcher agent performs all research sequentially using standard search and file reading tools.

## Quality checks
- Every claim cites a source (URL, screenshot reference, or code path)
- Patterns are organized by category, not by source
- Each pattern has a concrete "adopt/reject" recommendation
- **R-1 through R-5 each have at least one per-anchor finding** (per `$BLUEPRINT_HOME/docs/case-studies/design-system-audit.md`). A research pass that covers IA + behavior (R-1, R-2) but skips visual/motion/onboarding (R-3, R-4, R-5) is incomplete when `prototype.design_system: custom`.
- The synthesis includes a cross-cutting patterns section + a "what's distinctive to one anchor" section + recommended Design Principles (DP-N entries)

## Output discipline

Research is the widest read surface in the pipeline — screenshots, codebases, competitors, the web. What each research agent (and this skill) returns is the **synthesis, not the corpus**: claims and patterns organized by category, every load-bearing claim carrying a `file:line` / URL / screenshot pointer, sized to the conclusion. Handing back raw file contents or untrimmed tool output makes the orchestrator re-read what the agent already read — the read fan-out only pays off if the finding, not the input, crosses back. Canonical rule + tier dial: `$BLUEPRINT_HOME/template/docs/methodology/agent-output-discipline-pattern.md`.
