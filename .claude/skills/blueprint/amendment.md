---
name: blueprint-amendment
description: File a methodology amendment by guiding the operator through the canonical entry shape + applying wave 27's 4-bucket classification taxonomy + appending to the initiative's METHODOLOGY-AMENDMENTS.md in the correct (newest-first) order. Use when noticing a methodology gap your initiative had to work around, adding a hook/reviewer/doc the methodology doesn't supply, or skipping a stage with justification.
---

# /blueprint-amendment

File a methodology amendment by guiding the operator through the canonical entry shape + applying wave 27's 4-bucket classification taxonomy + appending to the initiative's `METHODOLOGY-AMENDMENTS.md` in the correct (newest-first) order.

Implements wave 27's amendment-classification pattern. Templates + conventions:
- File shape + 3-scope axis: `$BLUEPRINT_HOME/template/docs/methodology/methodology-amendments-convention.md`
- 4-bucket taxonomy: `$BLUEPRINT_HOME/docs/patterns/amendment-classification-pattern.md`
- Slot-filled template: `$BLUEPRINT_HOME/template/methodology/amendments/METHODOLOGY-AMENDMENTS.template.md`

## When to use

- A methodology learning surfaces mid-work (operator notices a gap, a workaround, a hook that didn't fire, a reviewer that should have caught something)
- Operator finishes a session and wants to capture amendment-worthy observations before context evaporates
- A canonical convention had to be deviated from for this initiative's specific shape (deviation needs to be filed as `Per-initiative` scope so future readers know why)
- A pattern recurs across multiple initiatives and the operator believes it's promotion-worthy (`Candidate for methodology promotion` scope)

Skip when the observation is just a regular bug (commit message is sufficient), an architectural decision specific to the product (use ADR instead), or day-to-day work-tracking (use STATE.md instead).

## What it does

1. **Detect or initialize the amendments file**:
   - Look for `blueprint/METHODOLOGY-AMENDMENTS.md` or `METHODOLOGY-AMENDMENTS.md` at the initiative root
   - If absent, ask the operator if they want to initialize the file from `$BLUEPRINT_HOME/template/methodology/amendments/METHODOLOGY-AMENDMENTS.template.md`. If yes, copy + replace `{Initiative Name}` with the initiative's name from `blueprint.yml` or pwd

2. **Capture the trigger** (one sentence): ask the operator what observation prompted the amendment. This becomes the `**Trigger**:` field.

3. **Apply the 4-bucket decision tree** mechanically, then confirm with operator:
   - Ask: "Does the fix only matter to this initiative's domain shape, with no other consumer likely to hit it?"
     - Yes → suggest bucket: **`consumer-local`** (scope: `Per-initiative`)
     - No → continue:
   - Ask: "Does the fix change template files (`stamp.mjs`, reviewers, `template/*`)?"
     - Yes, primarily reviewer rubric → suggest bucket: **`reviewer`**
     - Yes, other template files → suggest bucket: **`template`**
     - No (changes only docs/conceptual artifacts in `tools/blueprint/`) → suggest bucket: **`methodology`**
   - State the suggested bucket; ask operator to confirm or override. The suggestion is mechanical; the operator's judgment is final.

4. **Determine scope** (3-scope axis from the amendments convention):
   - `Per-initiative` if bucket is `consumer-local` (default)
   - Else ask: "Is this candidate for methodology promotion (the pattern likely matters cross-consumer), or already promoted (point at the wave commit), or just per-initiative (you don't expect other consumers to hit it)?"

5. **Compose the body**: ask the operator for the plain-prose amendment body. Prompt for:
   - What the gap is + the workaround (if any) + the proposed fix
   - File paths / commits / sessions where evidence lives
   - Optional: downstream artifacts updated (prescription.yml P-items, synthesis sections)
   - Optional: upstream Blueprint-template gap this exposes (if `Candidate for promotion`)

6. **Compose the entry** using the canonical template structure:
   ```markdown
   ## YYYY-MM-DD — <short title>

   **Trigger**: <trigger sentence>

   **Scope**: <scope>

   **Bucket**: <bucket>

   **Status**: Active

   <body>

   **References**:
   - <commit/PR/session>
   ```

7. **Prepend at the top** of the amendments file. The amendments convention is newest-first reverse-chronological; the entry goes ABOVE the previous most-recent entry, BELOW the file's frontmatter + intro paragraph.

8. **Optional cross-reference**: if related amendment entries exist, suggest linking them with `[[entry-date]]` markdown so readers can trace the audit trail.

9. **Do NOT commit**. The operator decides when to commit (some amendments get edited further; some land alongside related code changes; some are filed and held).

## Output

- `blueprint/METHODOLOGY-AMENDMENTS.md` (or `METHODOLOGY-AMENDMENTS.md` at initiative root, depending on where the file already lives) — new entry prepended at top

## What this skill does NOT do

- Does NOT promote the amendment to the methodology repo. Promotion is a separate operator session that greps `METHODOLOGY-AMENDMENTS.md` across consumers, finds 2+ converging entries, and authors the wave. This skill files the entry; the candidates accumulate; promotion happens later.
- Does NOT classify with high confidence. The bucket suggestion is mechanical based on a decision tree; novel situations may not fit. Always confirm with the operator.
- Does NOT modify existing entries. The amendments convention is append-only; if a prior entry needs revision, the convention is to file a new entry that `Status: Supersedes <YYYY-MM-DD>` the older one.

## Cross-skill invocation

Consider proactively suggesting this skill when:
- `/blueprint-validate` surfaces a reviewer that should have caught a gap but didn't
- A methodology rule had to be deviated from to make progress (operator workaround)
- A pattern recurs that the operator notices is candidate-for-promotion-shaped
- The conversation contains phrases like "we hit X; the methodology didn't catch it" or "this should probably be a template fix"
