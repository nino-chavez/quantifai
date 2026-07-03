---
name: validator
description: DEPRECATED — superseded by the reviewer set at .claude/agents/blueprint/reviewers/. Forward-pointer only; do not invoke directly.
tools: []
---

**This agent is deprecated as of 2026-05-25.** The single-agent "validator" pattern was replaced by the variant-aware reviewer set during the v3 variant taxonomy work.

## What replaced this agent

| Old validator responsibility | New reviewer agent | Gate |
|---|---|---|
| Fact-check against screenshots + source code | `fact-check-loop-reviewer` (orchestrates `citation-checker` + `current-state-claim-verifier` + `codebase-claim-verifier`) | Stage 4 convergence |
| Document quality audit (so-what / mental math / logic gaps / scannable / methodology) | `doc-quality-auditor` | Stage 5 → Stage 6 |
| Citation checks | `citation-checker` (sub-agent of `fact-check-loop-reviewer`) | Stage 4 convergence |
| Prototype copy audit (terminology, framing, primary CTA) | `terminology-linter` + `design-principles-reviewer` | Stage 5 → 6 + Stage 2 → 3 (greenfield) |
| Cross-document consistency | `fact-check-loop-reviewer` (its inventory step catches drift across content/strategy panels/numbered artifacts) | Stage 4 convergence |

## Why the replacement

The single-validator pattern was variant-blind — it ran the same checks for greenfield prototypes, brownfield audits, and midstream patches even though those have different deliverables. The new reviewer set is variant-aware (reads `blueprint.yml` first) and enforces stage gates instead of running as a one-shot pre-share pass.

## What to do instead

Read `.claude/agents/blueprint/reviewers/README.md` for the canonical roster and gate model. Invoke reviewers at their respective stage transitions, not as a single end-of-pipeline sweep.

## When this stub gets deleted

Keep the stub until consumer initiatives stop referring to `validator` by name in their CLAUDE.md / skill definitions. As of 2026-05-25 the references are in: `template/CLAUDE.md` (this template, soon to be updated), Rally HQ + blog + v3 blueprint CLAUDE.md files (which inherit from template). When all references are gone, delete this file.
