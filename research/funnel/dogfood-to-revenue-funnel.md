# Funnel — dogfood → publish → signal → revenue

Date: 2026-07-03 · Replaces the internal-adoption ladder (deleted with ADR-0003). The pilot is dogfood-first: user #0 is the operator; the funnel's later stages are hypotheses gated on earlier ones, not commitments.

Persona: `solo-operator` (see `research/personas/solo-operator.md`).

surface: unit-of-work-ledger (persona: solo-operator — JTBD-1)
surface: routing-calibration (persona: solo-operator — JTBD-2)
surface: practice-numbers (persona: solo-operator — JTBD-3)
surface: client-billing (persona: solo-operator — JTBD-4, v2)

## Ladder

| Stage | Actor | Artifact that moves them | Exit criterion | Status |
|---|---|---|---|---|
| 1. Walkthrough | Operator (user #0) | First-party walkthrough artifact | Done — `research/sources/walkthrough-2026-07-03-user0-practice-pricing.md` | ✅ 2026-07-03 |
| 2. Dogfood slice | Operator | Stage 3 prototype: unit-of-work ledger fed by the operator's own `~/.claude/projects` JSONL (shipper path — zero new credentials needed) | The instrument prices one real initiative end-to-end (candidate: this one — quantifai-next's own Blueprint run) | Next |
| 3. Decision proof | Operator | 30 days of passive collection | ADR-0003 KQ-2: the instrument changed ≥1 real decision (routing, plan, go/no-go). If not: park, documented | Pending 2 |
| 4. Publish | Operator → public | Blog post + repo (the practice-numbers export IS the content — the positioning brackets, filled, are the demo) | ADR-0003 KQ-3: external pull (issues, stars, waitlist, "how do I run this") | Pending 3 |
| 5. Agency revenue hypothesis | Consultancies/agencies | client-billing surface (JTBD-4) | Paying-intent signal from ≥1 external party | Gated on 4; new ADR either way |

## Drop-off risks and counters

- **2→3 curiosity-dashboard risk** (lite's failure mode): the counter is built into KQ-2 — the exit criterion is a changed decision, not a rendered chart. If 30 days produce no decision, the honest verdict is "park," and the dogfood still filled the positioning brackets (stage 4's content exists regardless).
- **4 distribution risk**: publishing costs one blog post on channels already running; the content is the numbers themselves, not a product pitch — differentiates from ccusage-style tool announcements.
- **5 free-OSS ceiling**: if the solo-market sweep shows the niche is entirely free/OSS with no paid tools, the revenue hypothesis weakens to "portfolio + practice instrument" — a legitimate outcome the funnel records rather than hides.
