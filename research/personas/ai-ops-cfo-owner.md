---
jtbd:
  - job: "Report total AI spend by provider with trend to the CFO at month-end"
    surface: "org-spend-rollup"
    time_budget: "5 minutes at month-end, replacing hours of console-hopping + spreadsheet assembly"
    acceptance: "One screen yields the month's total, per-provider split, and direction vs prior month without opening a provider console"
  - job: "Catch unexpected spend movement before the invoice lands"
    surface: "org-spend-rollup (budget threshold)"
    time_budget: "Zero — alert-driven, not checked"
    acceptance: "Threshold breach notifies mid-cycle; no surprise line items at invoice time"
  - job: "Identify dormant seats with their dollar cost ahead of renewals"
    surface: "per-developer-drilldown"
    time_budget: "15 minutes per renewal cycle"
    acceptance: "Seats inactive ≥30 days listed with monthly $ attached, exportable as the renewal-negotiation evidence"
  - job: "Surface AI spend hiding in expense reports outside sanctioned seats"
    surface: "unmanaged-spend-bucket"
    time_budget: "Review-only, monthly"
    acceptance: "Expense lines matching AI vendors appear as an unmanaged bucket distinct from metered/allocated spend"
---

# Persona — AI Ops owner, reporting to the CFO (Commerce.com)

Date: 2026-07-03 · Grounded in `research/sources/stakeholder-interview-2026-07-03-nino-chavez.md` (proxy interview — internal champion, not the owner; every claim below is champion-reported or derived, pending the owner's direct walkthrough per KQ-a). Pilot lock: `blueprint.yml pilot_profile` + ADR-0002.

## Who

A finance-side operations function ("AI Ops that reports to CFO" — interview Q1a, verbatim) responsible for answering what Commerce.com spends on AI tooling. Not platform engineering (they administer tools), not an eng director (they own delivery outcomes). Their instrument today is per-provider consoles plus hand-assembled spreadsheets (interview Q2). Four tool families are in play: Claude Code/Anthropic, GitHub Copilot, Cursor, ChatGPT/OpenAI (interview Q3).

## Jobs to be done

| # | Job (when/want/so) | Evidence | Today's workaround |
|---|---|---|---|
| JTBD-1 | When month-end reporting comes, I want total AI spend by provider with trend, so the CFO gets one number with a direction, not four screenshots. | Interview Q5: first screen = org spend rollup by provider, trend line, budget threshold | Four consoles → spreadsheet (Q2) |
| JTBD-2 | When spend moves unexpectedly, I want threshold alerts before the invoice lands, so surprises surface mid-cycle. | Q5 names "budget threshold" in the first screen; 78% of IT leaders report unexpected AI charges ([helpnetsecurity](https://helpnetsecurity.com/2026/05/01), market-level) | None — invoice is the alert |
| JTBD-3 | When renewals or expansion asks come, I want seats-held vs seats-used per tool, so I can cut dormant spend with evidence. | Pilot pain_point; SaaS-mgmt benchmarks (54% industry utilization, 30-day dormancy trigger — `research/competitive/analogous-industries.md`) | Not answerable today |
| JTBD-4 | When someone expenses a personal AI subscription, I want it surfaced as unmanaged spend, so the sanctioned-tool picture isn't fiction. | Adapted pattern (Torii-class discovery, scoped to expense keyword match) — derived, not interview-stated | Invisible |

JTBD-1 and JTBD-2 define the pilot's first screen. JTBD-3 is the drill-down. JTBD-4 is a v1.x candidate.

## What this persona is NOT (drift guards, from pilot_profile.out_of_scope_pilots)

Not a solo developer tracking their own usage; not a cloud-FinOps practitioner allocating infra; not an eng-productivity buyer measuring AI ROI in delivery metrics (DX/Faros territory). Copy and IA must speak finance-operations language (spend, budget, utilization, attribution), not engineering telemetry (tokens, sessions, models) — tokens appear only as drill-down detail under dollars.

## Known unknowns (owner walkthrough must resolve — KQ-a/KQ-d)

Whether AI spend is already a named budget line the CFO org tracks; the owner's reporting cadence and current spreadsheet's actual columns; whether "no trigger incident yet" (Q4) means low spend or low visibility; seat counts per tool; who beyond the owner consumes the rollup.
