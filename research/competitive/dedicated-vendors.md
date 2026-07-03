# Dedicated vendors — Larridin, Torii, Olakai, Finout (+ DX cross-check)

Date: 2026-07-03 · Stage 1 vendor sweep, evaluated as the CFO-side buyer would. Verified vs vendor-claimed vs inferred marked throughout.

## Kill-question verdict

**None of the four demonstrably ships a cross-provider (Claude Code + Copilot + Cursor + ChatGPT), per-developer, seat-plus-token cost view today.** No vendor shows a real screenshot of such a table — an absence that is itself a signal, and one the provider-feasibility sweep explains: clean per-developer dollars only exist via API for Anthropic and Cursor. Build-vs-buy read: **build-with-partial-borrow** for an internal pilot.

Cross-check from the analogous-industries sweep: **DX (getdx.com)** claims a unified AI cost report across Claude/Cursor/Copilot with team/individual breakdowns ([DX blog](https://getdx.com/blog/meet-the-new-ai-cost-management-report/)) — the closest shipped claim anywhere, vendor-sourced, engineering-metrics-framed rather than CFO-framed. Given the feasibility findings, DX's Copilot "individual" numbers are likely allocation- or telemetry-derived, not API-metered dollars. **Fact-check stage must verify DX's actual grain before any strategy doc claims the gap is open.**

## Per-vendor summary

| Vendor | Closest capability | Mechanism | Validation | Notes |
|---|---|---|---|---|
| **Finout** | Per-user cost for **Cursor only** (Admin API → MegaBill, user/model/charge-type/day) [verified] | Direct API for Cursor; Claude Code/Copilot attribution admitted unsolved — "Virtual Tags" is a blog framework, not a feature ([finout.io blog](https://www.finout.io/blog/finops-for-ai-agents-a-four-step-allocation-framework)) | Strong classic G2/Gartner presence, predating the AI angle | ~$6k/yr entry, ~1% of bill (third-party, [G2](https://www.g2.com/products/finout/pricing)); SaaS-only. AI page lists OpenAI/Anthropic/Bedrock/SageMaker/Vertex/Cursor — no Claude Code, no Copilot ([finout.io/artificial-intelligence](https://www.finout.io/artificial-intelligence)) |
| **Torii** | Broadest claim: per-employee seat+token across the four tools ([toriihq.com/ai-dashboard](https://www.toriihq.com/ai-dashboard)) [vendor-claimed] | **Presence detection, not metering**: SSO logs, OAuth grants, browser activity, expense feeds ([their methodology](https://www.toriihq.com/articles/five-claude-code-usage-dashboards-and-monitoring-tools)) | G2 #1 in SaaS Management — for the legacy product; AI Dashboard is ~2 months old | SOC2 Type II. Overlap-detection card (redundant Claude Code+Copilot+Cursor spend, dollarized) is the standout idea |
| **Olakai** | Names admin-API integrations for Cursor/Anthropic/Copilot explicitly ([olakai.ai/platform](https://olakai.ai/platform/)) [vendor-claimed, unverifiable] | Direct APIs + browser extension for shadow-AI; pairs cost with AI-assisted vs unassisted PR cycle time — best cost-to-outcome linkage of the four | **Zero third-party validation** (no G2, no Gartner); AI Fund-backed | No SOC2 claim found; PLG demo (no account needed); pricing undisclosed |
| **Larridin** | Vaguest on grain: attribution to "department, team, agents, and project" — never "developer" ([larridin.com](https://larridin.com/)) | APIs for Bedrock/GCP/OpenAI/Codex/Cursor/Claude + gateways + **manual CSV invoice fallback** (signals incomplete API coverage) ([token-spend blog](https://larridin.com/blog/token-spend-and-insights)) | None found beyond own PR (no G2/Gartner listing) despite $17M seed | $50K–500K/yr third-party estimate ([exceeds.ai](https://blog.exceeds.ai/larridin-pricing-guide-2026/)); SOC2/HIPAA/GDPR claimed via Drata |

## Patterns to adopt

1. **Finout's drill-down grid ordering** — user → model → charge-type → day; copy the dimension order for the spend-detail screen.
2. **Torii's overlap-detection insight card** — "paying for Claude Code AND Copilot AND Cursor; here's the redundant $" — first-class CFO insight, not a filterable table.
3. **Olakai's cost-to-outcome pairing** — spend plotted against an engineering outcome (PR cycle time). A rollup that never answers "so what" doesn't get reopened after week two.

## Patterns to reject

1. **Larridin's grain-vagueness** — copy that implies more precision than the data supports. If it's per-developer, say it; if it's allocated, label it (converges with the feasibility sweep's metered-vs-allocated rule).
2. **Torii's presence-as-metering conflation** — SSO detection proves an account exists, not what it cost. Invest in billing/usage APIs per tool.
3. **Finout's framework-as-feature blogging** — roadmap dressed as capability; the retired QuantifAI landing made the same error (Copilot/Cursor claims with no code). GA vs planned stays explicit in all our copy.

## R-dimension coverage note (honest limit)

Real product UIs are behind enterprise sales walls for all four; R-1/R-2 findings above derive from product pages, docs, and described screenshots — R-3 (visual language) and R-4 (motion) could not be observed for any vendor. If `prototype.design_system: custom` is chosen at Stage 2, R-3/R-4 anchors must come from accessible references (Finout's public screenshots, provider consoles the operator has seats for) rather than these vendors.
