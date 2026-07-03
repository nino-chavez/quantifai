---
jtbd:
  - job: "Price a unit of work — what did this initiative/project/session cost across providers, subscription and API combined"
    surface: "unit-of-work-ledger"
    time_budget: "30 seconds at initiative close; zero during work (passively collected)"
    acceptance: "Any initiative or project shows total cost with provenance mix (subscription-amortized / API-metered / estimated) and session count, without manual tagging beyond what project paths already encode"
  - job: "Validate model-routing decisions — did the cheaper-tier fan-out save money at equal outcome"
    surface: "routing-calibration"
    time_budget: "5 minutes when re-anchoring the Blueprint cost dial"
    acceptance: "A fan-out shows per-tier cost split; the Blueprint cost dial's provisional anchors can be re-anchored from real dollars instead of duration_ms"
  - job: "Substantiate the leverage claim with practice-level numbers"
    surface: "practice-numbers"
    time_budget: "10 minutes when updating the positioning doc or a case study"
    acceptance: "The positioning one-pager's bracket metrics (cost and output per project, deploys/week, inference-spend-in-lieu-of-team) are exportable as of a date, with methodology attached"
  - job: "Bill or margin-check AI cost per client project"
    surface: "client-billing"
    time_budget: "10 minutes at invoice time (v2 — agency revenue hypothesis, ADR-0003 KQ-3)"
    acceptance: "A project maps to a client; its unit-of-work costs export as an invoice-ready line item"
---

# Persona — solo AI-heavy operator (user #0: the operator)

Date: 2026-07-03 · Grounded in `research/sources/walkthrough-2026-07-03-user0-practice-pricing.md` — a first-party walkthrough, not a proxy (ADR-0003). Prior persona `ai-ops-cfo-owner` deleted with ADR-0003; recoverable from git.

## Who

An architect/consultant whose execution layer is agents rather than an engineering team: ~65 projects, 4 GitHub orgs, a production SaaS, a blog, subcontract work; Claude Code as primary engine with multi-agent orchestration as standard practice; cross-provider by nature (Claude Code, OpenAI, OpenRouter, occasional Cursor/Copilot exposure). Their spend mixes subscription amortization and metered API — which is precisely what makes every provider-native surface insufficient: none can answer a cross-provider, per-unit-of-work question.

## What they do today

`/cost` spot-checks per session, provider console month-views, and a methodology cost dial calibrated on a duration proxy its own ADR disclaims. No per-project, per-initiative, or cost-vs-output view exists.

## What this persona is NOT (drift guards, per pilot_profile.out_of_scope_pilots)

Not an enterprise AI Ops function (retired pilot); not a small team yet (growth path — earn it when a second user asks); not an eng-productivity buyer (no cycle-time scoring); not a cloud-FinOps practitioner. Vocabulary is the operator's own: initiative, session, fan-out, project, margin — not seats, showback, or org rollups.

## Known unknowns

Whether 30 days of dogfood changes a real decision (ADR-0003 KQ-2); whether anyone external pulls (KQ-3); how much of the practice's spend is subscription-amortized vs metered (the instrument itself will answer this — first dogfood output).
