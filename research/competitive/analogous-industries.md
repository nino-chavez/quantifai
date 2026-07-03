# Analogous-industry patterns — TEM, SaaS spend management, cloud FinOps

Date: 2026-07-03 · Produced by the Stage 1 analogous-industries sweep (web research; URLs per claim). Organized by pattern per the research skill's synthesis rule.

## Flag for the kill-question (cross-check with vendor sweep)

DX (getdx.com) already ships an AI cost management report unifying spend/token data across Claude, Cursor, and GitHub Copilot with team/individual breakdowns, cost-per-PR efficiency, forecasting, and a push API for other tools ([DX AI cost report](https://getdx.com/blog/meet-the-new-ai-cost-management-report/)). CloudZero and Amnic pull Anthropic/OpenAI billing APIs into cost-per-feature views. This is not a green field; differentiation must be CFO-side framing (budget thresholds, showback/chargeback, unmanaged-spend detection) vs DX's engineering-metrics framing.

## Pattern 1 — Multi-vendor normalization layer (TEM) · ADOPT

TEM platforms (Tangoe, Calero-MDSL, Sakon) ingest carrier bills via EDI/API/OCR and normalize to one service-level schema; EDI preferred over PDF for component-level charge breakout ([Tangoe](https://www.tangoe.com/telecom-expense-management/), [Sociumit](https://www.sociumit.com/telecom-expense-management-software)). Identical shape to four AI providers with four export formats. Adopt as the foundational primitive: adapter-per-tool → common schema; prefer API feeds over CSV exactly as TEM ranks EDI over paper.

## Pattern 2 — Showback first, chargeback as a gated mode (TEM + FinOps) · ADAPT

TEM automates cost-center chargeback ([Tangoe](https://www.tangoe.com/telecom-expense-management/invoice-management/)), but FinOps Foundation data cuts against "chargeback = maturity": 57% of mature FinOps orgs run showback primary, 18% pure chargeback, ~25% hybrid — an accounting-policy choice, not a maturity ladder ([CloudZero](https://www.cloudzero.com/blog/chargeback-vs-showback/)). FinOps cites ~90% attribution coverage before chargeback is dispute-proof. For AI tools, per-seat spend attributes near-100%; shared team API keys don't — surface that gap in the UI instead of forcing allocation. v1: showback default, chargeback behind a coverage threshold.

## Pattern 3 — Utilization scoring with dormancy flags (SaaS spend mgmt) · ADOPT

Zylo/Productiv/Torii score per-seat engagement (Productiv: 50+ dimensions, not just login) and trigger reclaim ahead of renewal. Benchmarks: industry seat utilization 47% (2024) → 54% (2025), best-in-class 90%+ ([Zylo SaaS Management Index](https://zylo.com/reports/2025-saas-management-index/)); 30-day inactivity is the most common reclaim trigger ([CloudEagle](https://www.cloudeagle.ai/blogs/how-to-identify-and-cut-the-unused-saas-licenses-before-renewal)); renewal prep at 120 days out maximizes leverage. Adopt for the per-developer drill-down: utilization = active-usage-days/period, default 30-day dormant flag, rendered as "$X/month on N dormant seats."

## Pattern 4 — Shadow-spend discovery (SaaS spend mgmt) · ADAPT, scoped down

Torii/Vendr correlate SSO logs, corporate-card feeds, and browser telemetry to find unsanctioned tools ([Torii](https://www.toriihq.com/saas-visibility)). AI spend hides in expensed personal Pro subscriptions and untracked team API keys. Full correlation is a multi-quarter build — reject for v1. Adapt: a "detected but unmanaged spend" bucket from expense-line keyword matching against known AI vendor names.

## Pattern 5 — FOCUS-aligned schema, no FOCUS pipeline (FinOps) · ADOPT philosophy only

FOCUS v1.4 (ratified 2026-06-04) added virtual-currency lifecycle support — token purchase, burn-down, exhaustion forecasting — aimed at AI token spend ([FOCUS spec](https://focus.finops.org/focus-specification/), [Amnic guide](https://amnic.com/blogs/finops-open-cost-and-usage-specification-guide-2026)). But validators land Q3 2026 and no provider (Anthropic/OpenAI/GitHub/Cursor) emits FOCUS-conformant exports today. Design the internal schema to map onto FOCUS dimensions (ChargeCategory, PricingUnit, CommitmentDiscountStatus); build no ingestion/export pipeline against it yet.

## Regulatory/audit angle — thin; do not lead with it

No AI-specific mandate requires spend rollups. SOX/SOC-1 controls apply to AI spend as ordinary opex ([BitSight](https://www.bitsight.com/learn/compliance/sox-compliance-checklist)); the EU AI Act / ISO 42001 require risk-classified inventories of AI *systems*, not spend ([ModelOp](https://www.modelop.com/ai-governance/ai-regulations-standards/eu-ai-act-vs-iso-42001)). The tool's inventory is adjacent evidence for ISO 42001, as a secondary benefit. The driver is CFO cost visibility, not compliance.

## Ranked: five patterns for the v1 org-spend-rollup screen

1. Multi-vendor normalization layer — the product is impossible without it; adapter-per-tool, API-first.
2. Per-developer utilization + 30-day dormancy flag — the cheapest CFO-legible waste signal.
3. Showback-first with coverage-gated chargeback — avoids forcing allocation before it's trustworthy.
4. FOCUS-dimension-aligned data model with zero FOCUS plumbing — near-free optionality against a 12–18-month standardization wave.
5. Unmanaged-AI-spend bucket via expense keyword match — the shadow-IT story at a fraction of Torii's build cost.

Rejected for v1: full SSO/browser shadow-IT correlation, FOCUS-conformant pipelines, compliance-led positioning.
