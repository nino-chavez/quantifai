# Funnel — internal adoption path (Commerce.com pilot)

Date: 2026-07-03 · This initiative is internal-first (ADR-0002): the "funnel" is an adoption ladder inside Commerce.com, not a marketing funnel. Commercial motion is explicitly deferred until the pilot proves (pilot_profile.monetization_side).

Persona: `ai-ops-cfo-owner` (see `research/personas/ai-ops-cfo-owner.md`) — every ladder stage below moves that persona; the champion (Product Architect) is the vehicle, not the target.

surface: org-spend-rollup (persona: ai-ops-cfo-owner — JTBD-1, JTBD-2)
surface: per-developer-drilldown (persona: ai-ops-cfo-owner — JTBD-3)
surface: unmanaged-spend-bucket (persona: ai-ops-cfo-owner — JTBD-4, v1.x)

## Ladder

| Stage | Actor | Artifact that moves them | Exit criterion | Status |
|---|---|---|---|---|
| 1. Champion engaged | Product Architect (interviewee) | Stakeholder interview | Done — `research/sources/stakeholder-interview-2026-07-03-nino-chavez.md` | ✅ 2026-07-03 |
| 2. Owner walkthrough | AI Ops owner (reports to CFO) | 30-minute walkthrough of how they answer spend questions today (their spreadsheet, their cadence) | Real walkthrough artifact replaces the proxy citation; KQ-a and KQ-d resolve | **OPEN — gates Stage 3** |
| 3. Prototype demo | Owner + champion | Stage 3 one-screen prototype: org spend rollup (by provider, trend, threshold) fed by at least one real connector (Anthropic Cost API is the cheapest real feed — `research/competitive/provider-api-feasibility.md`) | Owner asks for a second screen or names it in a report | Pending 2 |
| 4. Pilot deployment | AI Ops function | Deployed internal instance, org credentials for 2+ providers | Owner produces one real month-end report from it | Pending 3 |
| 5. Org rollout / commercial fork | CFO org; separately, ADR if commercial | Pilot evidence | New ADR either way | Out of Stage 1 scope |

## Drop-off risks and counters

- **2→3 is the kill-gate** (retrospective verdict): if the owner declines the walkthrough, the initiative retires as documented. Counter: none — that outcome is the gate working.
- **3→4 credential risk**: org admin keys for Anthropic/OpenAI are CFO-org-sanctioned secrets; the appsec checklist (static CRON_SECRET, key rotation — `research/current-state/sibling-project-scan.md`) must be closed before real credentials land. Counter: prototype runs on the champion's own admin-visible data first.
- **Enterprise-tier gates**: Cursor Admin API and ChatGPT Compliance API require Enterprise plans; if Commerce.com's tiers don't match, those connectors downgrade to CSV import for the pilot (feasibility table). Counter: the demo leads with Anthropic + OpenAI API-side, the two ungated feeds.
- **Demand risk (KQ-d)**: no trigger incident exists yet. Counter: the walkthrough question set includes "is AI spend a named budget line yet?" — if no, park with a revisit trigger (e.g., spend crossing a threshold the champion can observe) rather than build into a vacuum.
