# ADR-0002: Pilot re-target — platform-eng lead → AI Ops function reporting to the CFO

Status: accepted · 2026-07-03

## Context

ADR-0001 locked the pilot as "platform-engineering lead administering AI coding tools at the employer" (employer de-named — public repo), derived from the retrospective's market analysis before any stakeholder contact. The first stakeholder interview (`research/sources/stakeholder-interview-2026-07-03-nino-chavez.md`) contradicts that framing on the ownership question: at the employer, the AI-spend question is owned by **an AI Ops function reporting to the CFO** (interviewee's words: "ai ops that reports to CFO"), not by platform engineering. The disqualifier for the prior profile is direct: the buyer whose walkthrough this tool must win sits on the finance side of the org, and aiming the pilot at platform-eng would repeat the retired builds' failure of serving a buyer who doesn't own the question.

## Decision

Re-target the pilot to **AI Ops under the CFO at the employer**, with the interviewee (Product Architect) as internal champion and his interview as the proxy walkthrough artifact. The pilot's first-screen priority comes from the interview: org spend rollup (by provider, trend, budget threshold) — not the per-developer cost table ADR-0001's market framing would have predicted.

This softens, but does not delete, ADR-0001's out-of-scope line "Finance/FinOps chargeback buyer (Finout/CloudZero/Vantage territory)": general **cloud-infra** FinOps remains out of scope; a finance-reporting owner of **AI-tool** spend specifically is now the pilot. Consequence for competitors_in_scope: cloud FinOps suites with AI add-ons (Finout-class) move from out-of-scope to in-scope, since a CFO-side buyer would plausibly evaluate them.

## Gate posture

`walkthrough_citation` now points at a real artifact, satisfying the mechanical lock. Two honest caveats travel with it, recorded in the artifact itself: (1) it is a proxy interview — the AI Ops owner's direct walkthrough is a Stage 1 validation task and remains the retrospective's kill-gate; (2) the interviewee reports **no specific trigger incident** — demand at the employer is anticipated, not demonstrated, so Stage 1 must test local demand directly rather than import market-level demand statistics.

## Consequences

- Stage 1 re-derives competitive scope for a CFO-side buyer (add Finout-class; re-weight Larridin/Torii, who sell to this buyer).
- Build-vs-buy is an open interview question (asked, unanswered) — Stage 1 must produce the buy-side comparison honestly rather than presume build.
- If the AI Ops owner's walkthrough contradicts the champion's account of the current process ("per-provider dashboards + hand assembly"), the profile re-amends and Stage 1 artifacts re-derive.
