# Methodology amendments — quantifai-next

Append-only, newest-first. Scopes: Per-initiative · Candidate for methodology promotion · Already promoted.

## 2026-07-03 — METHODOLOGY.md names reviewers that don't exist as executables

**Scope:** Candidate for methodology promotion.
**What happened:** METHODOLOGY.md's Stage 1 gates cite `research-sibling-scanner` (METHODOLOGY.md:137-148) and `research-reference-grader` (METHODOLOGY.md:173-189) as blocking reviewers. `blueprint review --list` (CLI 0.4.1) discovers neither; the executable set covers the same intent only partially via `research-completeness-reviewer` (leg presence + persona/JTBD/funnel coherence — no sibling-scan or reference-grading check at all).
**Workaround:** authored the sibling scan (`research/current-state/sibling-project-scan.md`, ADRs read and quoted) and the reference grading table (`docs/content/research-comparables.md § Reference grading`) to the METHODOLOGY spec, self-enforced.
**Why it matters:** a consumer following only the executable gates ships Stage 1 without a sibling scan or graded references — the exact silent under-processing the skip-justification machinery exists to prevent, here caused by the methodology itself over-promising its tooling.

## 2026-07-03 — Skill/reviewer disagree on research directory layout

**Scope:** Candidate for methodology promotion.
**What happened:** the `blueprint-research` skill instructs saving to `research/competitive-analysis/`; `research-completeness-reviewer` (greenfield/consumer-app) BLOCKs unless the legs are exactly `research/competitive/`, `research/personas/`, `research/funnel/` (plus current-state). Same class of break as the photography consumer's blueprint.yml-location conflict (hook vs reviewers): two methodology organs disagreeing about paths.
**Workaround:** renamed to `research/competitive/`; authored `personas/` (JTBD frontmatter with exact-match `surface:` slugs — the matcher requires slug identity between persona jtbd and funnel `surface:` lines, undocumented) and `funnel/`.
**Why it matters:** every greenfield consumer following the skill text verbatim hits a mechanical BLOCK and has to reverse-engineer the matcher's slug rules from error output.
