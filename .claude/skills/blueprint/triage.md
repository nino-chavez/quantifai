---
name: blueprint-triage
description: Triage stakeholder feedback after a Blueprint demo or doc review through a state machine of categories and dispositions. Use when feedback arrives from stakeholders and needs to be classified into actionable next steps with dispositions (accept, defer, decline, etc).
---

# /blueprint-triage

Triage stakeholder feedback after a Blueprint demo or doc review through a state machine of categories and dispositions.

## When to use

After sharing a Blueprint deliverable (prototype walkthrough, doc package, deck) and collecting feedback. Run before deciding which feedback to act on.

## Why a state machine

Stakeholder feedback after a demo arrives in three forms simultaneously: questions, opinions, and asks. Without structure, all three get treated equally and the team either:
- Implements every opinion (scope creep, deliverable drift)
- Implements only the loud asks (whoever pushed hardest wins)
- Implements nothing while "waiting for consensus" (deliverable goes stale)

The state machine forces explicit categorization + disposition so each piece of feedback has a defensible next action.

## Categories

Every piece of feedback gets exactly one category:

| Category | Definition |
|---|---|
| **bug** | The deliverable is wrong (factually inaccurate, broken link, contradicts another doc). Highest priority. |
| **scope-add** | A feature/section/finding that wasn't in scope but stakeholder wants it. Requires scope decision. |
| **scope-clarify** | The deliverable's scope is unclear; stakeholder wants the boundaries restated. Doc-level fix. |
| **opinion** | A preference about phrasing, framing, or emphasis that doesn't change facts. Discretionary. |
| **question** | Stakeholder doesn't understand something; needs clarification, not a change. |
| **kudos** | Positive feedback, no action required, but capture for retrospective. |
| **market-signal** | Evidence about the stakeholder's OWN practice or problem, not about the deliverable — their hand-rolled loop, their team process, their named pain. The highest-value Mom Test class (past-specific behavior); it never gets dispositioned against the deliverable — it gets `logged` to the validation script's Log, weighted by what they gave. Promoted on the second-instance rule (two stakeholders in two days described their incumbent practice and the state machine had no honest slot). |

If feedback is ambiguous between categories, ask the maintainer once. Don't guess.

## Commitment weight (the Mom Test axis)

Alongside its category, every item records what the stakeholder **gave**, because feedback that cost nothing is noise no matter how enthusiastic it sounds (canonical reference: `$BLUEPRINT_HOME/template/docs/methodology/mom-test-validation-pattern.md`):

| gave | Weight | Examples |
|---|---|---|
| **money** | highest | pilot/LOI agreed, budget line named |
| **reputation** | high | intro to the budget owner, brought their team, public sponsorship |
| **time** | medium | booked a follow-up working session, multi-hour annotated review |
| **none** | lowest | hallway compliments, unprompted opinions, "looks great" |

Weighting rules:

- A **scope-add** with `gave: none` is a wishlist item — default `deferred` unless the maintainer overrides. The same ask backed by `money` or `reputation` is a roadmap signal — recommend `scoped-in`.
- **kudos** never counts toward demand validation regardless of volume. Log it, enjoy it, don't cite it.
- If a commitment ask was **made** during the exchange, record its outcome in the validation script's Log (`taken` / `not taken` / `no ask made`). An untaken ask is first-class negative evidence — enthusiasm plus an open ask is the compliment trap at full strength (the zombie-lead rule in the canonical pattern doc § Ask outcomes).
- If the initiative shipped a validation script (`docs/content/validation-script.md`), append each item that touches a scripted assumption to the script's Log table — that table, not the kudos file, is the demand-evidence record.

## States

Every categorized item gets one state:

| State | Meaning |
|---|---|
| **needs-review** | Just collected, not yet triaged |
| **scoped-in** | Will be addressed in this initiative; converted to a follow-up task |
| **deferred** | Acknowledged, but punted to a future initiative or the team's general backlog |
| **answered** | A question has been answered; no doc change needed |
| **wontfix** | Will not be addressed; rationale required |
| **clarified** | A scope-clarify was resolved by sharpening scope language in the doc |
| **logged** | Captured in the validation script's Log (market-signal) or the kudos file (kudos); no deliverable disposition exists or is needed |

State transitions: `needs-review` → one of the others. The maintainer can override at any time.

## Workflow

### Step 1 — Collect

Read the feedback source. Common locations:
- `feedback/[date]-[slug].md` — written feedback in markdown
- A pasted Slack thread or email
- Notes from a live demo

If feedback isn't yet in `feedback/`, capture it there first so it's preserved alongside the deliverable — but **anonymize before anything is committed**, because feedback is private communication and the repo may be (or become) public:

1. **Verbatim original** → `feedback/raw/` and add `feedback/raw/` to `.gitignore` (verify with `git check-ignore feedback/raw/` before writing). The verbatim stays local-only, full names and all.
2. **Committed capture** → `feedback/[date]-[slug].md` with identities reduced to role + initial ("R., engineering lead"), DMs condensed to paraphrase + short non-identifying quotes, and personal disclosures (health, family, anything the person didn't say for an audience) paraphrased out entirely. Slug by persona, not name (`casual-visitor`, `eng-lead-thread`).
3. Treat private-repo initiatives the same way — repos go public later (this one did), and git history keeps what the working tree deletes. Anonymizing after a push means a history rewrite.

### Step 2 — Categorize and recommend

For each piece of feedback, present a single line:

```
[N] "<feedback excerpt, ≤80 chars>" — category: <X>, gave: <money|reputation|time|none>, recommend state: <Y>, rationale: <one sentence>
```

Cluster related items if multiple stakeholders raised the same thing — note "(also raised by: name1, name2)".

Wait for maintainer to confirm or override the recommendations before applying any state.

### Step 3 — Apply dispositions

For each item, take the disposition action:

- **scoped-in** → create a task entry in the relevant section of `docs/content/` or in a `followups.md` file. Reference the feedback source.
- **deferred** → write to `docs/content/deferred.md` with: feedback excerpt, source, rationale for deferral, suggested timing ("next initiative", "after deployment", etc.).
- **answered** → write the answer back to the stakeholder. If the question revealed a doc gap, also flag it as `scope-clarify` and address.
- **wontfix** → write to `docs/content/decisions.md` with: feedback excerpt, source, rationale ("contradicts our positioning", "out of scope by design", "factually incorrect — see verification report"). Polite, specific.
- **clarified** → update the affected doc with sharper scope language, reference the feedback that drove the change.
- **kudos** → log to `feedback/kudos.md`. Useful for retros and team morale.

### Step 4 — Update the validation report

If any feedback indicates the deliverable was inaccurate (`bug` category), feed it into `/blueprint-validate` as a Phase 2 reproduction. The validate loop should catch it — if not, the loop is missing a category.

### Step 5 — Send a triage summary

Compose one message back to stakeholders:

```
Triaged [N] pieces of feedback:
- Scoped in: [count]
- Deferred: [count] (see docs/content/deferred.md)
- Answered: [count]
- Won't fix: [count] (rationale below)
- Already addressed: [count]
- Thanks for the kudos!
```

Make scoped-in items visible in the deliverable update; make won't-fix rationale public so stakeholders see the reasoning.

## Anti-patterns

- **"We'll consider it"** — not a state. Use `deferred` with a specific timing or `wontfix` with a rationale.
- **Treating all feedback as scope-add** — most feedback is opinions or questions, not changes. Categorize first.
- **Skipping the rationale on wontfix** — the rationale is the reason the deliverable holds up under scrutiny. Always include.
- **Triaging in isolation** — every state change should be visible to the team in `docs/content/` or `feedback/`. No silent decisions.
- **Counting compliments as validation** — "everyone loved the demo" is the Mom Test's false-positive trap. Demand evidence is what stakeholders gave (time/reputation/money), recorded in the validation script's log — not what they said.
- **Committing verbatim identity** — full names, exact private-DM quotes, or personal disclosures in committed feedback files. The triage record's evidence value survives anonymization (persona + what they gave is the data); the person's trust does not survive publication. Verbatim belongs in gitignored `feedback/raw/`, nothing else.

## Output

A triage record at `feedback/[date]-triage.md`:

| # | Excerpt | Category | Gave | State | Disposition | Source |
|---|---------|----------|------|-------|-------------|--------|

Plus updates to: `docs/content/deferred.md`, `docs/content/decisions.md`, `feedback/kudos.md`, `followups.md` as applicable.

## Lineage

State-machine pattern adapted from [matt-pocock/skills `triage`](https://github.com/mattpocock/skills) (MIT). The categories are tuned for stakeholder-feedback-after-demo (Blueprint context), not GitHub-issue triage. AI disclaimer is opt-in per the workspace `triage` skill; for internal-stakeholder feedback, generally skip it.
