# ADR-0001: Pilot profile — Commerce.com AI-tool admin, gated on a real stakeholder artifact

Status: accepted · 2026-07-03

## Context

This initiative is the gated successor to the retired QuantifAI builds (quantifai-lite, quantifai-platform v2, quantifai-sync, quantifai-landing). The retrospective (`research/sources/retrospective-review-2026-07.md`) found the prior builds' central failure was an undeclared buyer: the landing page asked visitors what FinOps question they were trying to answer, three distinct market buyers (IT/procurement, finance, platform-eng) were never chosen between, and no external person ever used the product. There is no prior pilot profile — the prior initiative predates Blueprint adoption; "no declared pilot" is the prior state this profile replaces.

## Decision

Pilot: **platform-engineering lead administering AI coding tools at Commerce.com** (`commerce-ai-tool-admin`), internal-first. Chosen over the two out-of-scope buyers because (a) the July-2026 market scan shows the finance and productivity-ROI positions are held by funded players (Finout/CloudZero/Vantage; Faros/Jellyfish/DX) while cross-provider per-developer seat-plus-token attribution for an org admin is the demonstrably unclaimed slice, and (b) Commerce.com is the one deployment where a captive stakeholder exists — the retired platform's own stated target (`quantifai-platform/CLAUDE.md:3`, "Internal-first deployment at Commerce.com").

`walkthrough_citation` is deliberately empty. Per the retrospective's verdict, this initiative carries an explicit kill-gate: Stage 1 does not begin until a real artifact from a named Commerce.com stakeholder exists (interview notes, a walkthrough of how they answer AI-spend questions today, screenshots of the current process). If no stakeholder artifact materializes, the initiative ends as a documented retire — that outcome is a success condition of the gate, not a failure of the initiative.

Competitors in scope are derived from this pilot (what an org admin would evaluate instead): the three provider-native admin surfaces (Anthropic Console/Claude Code Analytics, Cursor Organizations, Copilot metrics) and the three dedicated cross-provider entrants (Larridin, Torii, Olakai). They are pre-seeded from the retrospective's market scan rather than from the (not-yet-existing) walkthrough; when the citation lands, re-check each against it and re-derive per the reviewer's §6.

## Consequences

- Stage 1 research scope, when unblocked, derives from this profile only; targeting the solo-developer or finance buyer requires a new ADR naming the disqualifier of this one.
- Downstream artifacts to re-evaluate if this profile is amended: `research/sources/README.md` (salvage map assumes org-admin ingestion via provider APIs), the cost-dial anchors (sized for a lean internal pilot).
