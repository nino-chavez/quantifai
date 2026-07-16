# Stakeholder interview — Nino Chavez, Product Architect (employer de-named — public repo)

Date: 2026-07-03 · Method: structured interview in-session (multiple-choice with free-text override), conducted by the initiative agent. Verbatim selections below; free-text answers quoted exactly. This is the `walkthrough_citation` artifact for `pilot_profile` in `blueprint.yml`. This pilot was retired by ADR-0003 (owner unreachable) — kept as historical record of the research gate working as designed.

## Stakeholder status — read this first

Nino Chavez is a real employee (Product Architect) at a commerce-platform company, with direct observation of how AI-tool spend questions are handled, but he is **not the owner of the spend question** — by his own answer, that owner is an AI Ops function reporting to the CFO. This artifact is therefore a **proxy walkthrough from an internal champion**, not the owner's walkthrough. Stage 1 carries an explicit validation task: obtain the AI Ops owner's direct walkthrough before any Stage 3 prototype investment. If that walkthrough can't be obtained, the retrospective's kill-gate fires (retire, documented).

## Q&A (verbatim)

**Q1. Who answers "what did we spend on AI tools this month" at the employer today — and what's your relationship to that question?**
A: "Someone else owns it" — IT/finance/platform-eng owns the question; interviewee is an architect adjacent to it who would champion a tool internally.

**Q1a. Who is the "someone else" that owns the AI-spend question — whose walkthrough would this tool actually have to win?**
A (free text): **"ai ops that reports to CFO"**

**Q2. When an AI-spend or usage question comes up today, what does the current process look like?**
A: "Per-provider dashboards + hand assembly" — someone logs into each vendor console and stitches numbers into a doc/spreadsheet.

**Q3. Which AI coding/assistant tools does the employer actually run today, org-wide or in your slice?**
A: All four — Claude Code / Anthropic, GitHub Copilot, Cursor, ChatGPT / OpenAI. (Seat counts not captured in this interview — Stage 1 follow-up.)

**Q4. Is there a real incident — a specific question that went unanswered or took painful effort to answer?**
A: **"No specific incident."** The pain is projected from where the org is heading, not yet experienced as a named unanswered question. (This is load-bearing for research posture: demand at the employer is anticipated, not demonstrated.)

**Q5. If the tool existed today, which single screen would the owner open first?**
A: "Org spend rollup" — total AI spend this month by provider, trend line, budget threshold. (This defines the Stage 3 one-screen prototype target.)

**Q6. Why wouldn't the employer just use the four provider dashboards, or buy Larridin/Torii? What makes an internal build viable?**
A: "Cross-provider view is the gap" — provider dashboards are fine per-tool; nobody stitches them, and that's the actual pain. (Note: this answers why not provider dashboards; it does **not** answer build-vs-buy against Larridin/Torii/Olakai — left open, see below.)

## Open questions (asked, not answered — do not treat as resolved)

1. **Access**: does the interviewee have a line to the AI Ops owner for a direct walkthrough, and does the pilot formally re-target to that function? (Re-target executed by ADR-0002 on the strength of Q1a; access remains unconfirmed.)
2. **Build vs buy**: if a Larridin/Torii demo landed on the CFO's desk, does an internal build still make sense (wedge/proof vs data-control vs cost/speed vs honest buy-wins)?
3. **Kill criteria**: operator confirmation of the proposed Stage 1 exit conditions — (a) AI Ops declines a walkthrough → retire; (b) provider admin APIs (esp. Copilot/Cursor) can't deliver per-developer cost cleanly → retire or re-scope; (c) a vendor demonstrably ships the cross-provider per-dev view → recommend buy; (d) the employer's AI spend still too small for the CFO org to care → park on timing. These four are agent-proposed and unconfirmed by the operator.

## Implications recorded elsewhere

- Pilot re-target (platform-eng → AI Ops under CFO): `decisions/0002-pilot-retarget-ai-ops-cfo.md`.
- Prototype target (org spend rollup screen): carries into Stage 2/3 when unblocked.
- "No specific incident" means Stage 1 must test demand at the employer directly (does the CFO org track AI spend as a budget line yet?) rather than assume it from market-level demand stats.
