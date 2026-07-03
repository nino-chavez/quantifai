---
name: blueprint-dispatch
description: Orchestrate a parallel agent dispatch wave when a planning thread has produced multiple inspectable artifact briefs whose file scopes don't overlap. Use when there are ≥2 artifacts with named target files, complete specs, non-overlapping file scopes, and no mid-flight orchestrator synthesis needed. Triggers on operator saying "dispatch", "wave", "in parallel", or "across agents".
---

# /blueprint-dispatch

Orchestrate a parallel agent dispatch wave when a planning thread has produced multiple inspectable artifact briefs whose file scopes don't overlap. Codifies the wave-dispatch workflow — brief construction, model selection, inline orchestrator work during wait, post-flight cross-review for inter-artifact consistency, and commit-and-push following the project's dev-push pattern.

Pattern doc: this file. Worked example: quantifai-next commit `09036602` (2026-05-27) — three Sonnet agents drafted platform-shims feasibility + sibling strategy doc + methodology amendment in parallel while the orchestrator wrote a parallel ingester.

## When to use

Trigger when ALL FOUR pre-flight conditions hold:

1. **≥2 artifacts** with target file paths named in-thread
2. **Specs are complete**: each artifact has clear goal, output structure, and tonal model. Vague briefs ("implement X") produce shallow generic work — finish the specs first.
3. **File scopes don't overlap**: run `template/tools/parallel-dispatch-check/check.sh` to verify mechanically before dispatching.
4. **Execution doesn't need orchestrator synthesis mid-flight**: if an artifact needs judgment only the orchestrator can make, dispatch it to Opus or do inline.

Skip when:
- Single artifact (just write it).
- Briefs aren't complete (finish them first).
- File scopes overlap (dispatch serially or narrow scopes).
- The work is a few minutes of mechanical pattern-matched editing.

## What it does

1. **Run the pre-flight checklist** — confirm all four trigger conditions above. If any fails, redirect to inline or serial dispatch.

2. **Run `template/tools/parallel-dispatch-check/check.sh`** with each agent's file globs as separate args. Exit 0 → safe; exit 1 → switch to serial or narrow scopes.

3. **Construct briefs with seven mandatory fields** per artifact. Agents have zero context from the orchestrator's thread — missing fields produce drift.

   1. **Goal + audience** — what the artifact is, who reads it cold
   2. **READ-FIRST sources** — absolute paths the agent mirrors for tone/structure. Orchestrator reads these first to confirm they exist and match memory.
   3. **Full output structure** — every section, every enumeration item, every required cross-link. Embed the analysis; don't say "include the analysis."
   4. **Cross-references** — including forward-links to files being written in parallel. Mark them as forward-links so the agent doesn't try to verify.
   5. **Don't-do list** — no marketing copy, no emojis, no padding, no inflation to hit length targets, plus project-specific don'ts from CLAUDE.md.
   6. **Voice + length constraints** — match the tonal model from READ-FIRST; give a natural-fit range, not a target.
   7. **Reporting expectations** — what the agent reports back: the synthesized result plus pointers (file path, line count, cross-refs they couldn't resolve, judgment calls), never the corpus it read. This is what makes post-flight cross-review possible. Canonical rule + tier dial: `template/docs/methodology/agent-output-discipline-pattern.md`.

4. **Select model per artifact**:
   - **Sonnet** — execution-from-complete-brief. Markdown rendering, mirror-coding, mechanical work with clear acceptance criteria. Default.
   - **Opus** — judgment-bearing dispatch. Strategic synthesis the brief can't carry, ambiguous trade-offs. Override, not baseline.

5. **Create tasks** with `TaskCreate`: one per artifact + one for orchestrator side-work + one for cross-review + one for commit-and-push. Mark each artifact task `in_progress` with the agent ID as owner before dispatching.

6. **Launch parallel agents in a single message** with multiple `Agent` tool calls and `run_in_background: true`. Don't poll for completion — wait for the notification.

7. **Run bounded inline work during the wait** — mechanical mirror-edits, workflow/config updates that artifacts depend on, reading reference files for cross-review. Don't take on work that overlaps an agent's file scope. Don't start synthesis that contradicts an in-flight brief.

8. **Post-flight cross-review (mandatory)** when all agents return:
   - Compare **shared content** embedded in multiple briefs — agents will sometimes invent details that don't match each other.
   - Verify **forward-link targets** now exist and resolve.
   - Spot-check **frontmatter conformance** against project lint rules.
   - Run any **mechanical lint** the project provides (frontmatter-lint, hive-meta-validator, schema validators).

9. **Commit and push** following project conventions:
   - Stage **specific files** with `git add path1 path2` — never `git add -A`.
   - Commit subject in the project's conventional-commits format; body lists what each new file does.
   - Include `Co-Authored-By:` footer per project CLAUDE.md template.
   - Push to integration branch (`dev` for quantifai-next and similarly-shaped projects) per the project's pattern-1 local-integration workflow. Fast-forward from remote before committing if behind.

## Output

- Commit landed on the project's integration branch (typically `dev`) containing N parallel artifacts + any inline orchestrator side-work.
- TaskList shows all wave tasks completed.
- Per-artifact reporting from each subagent has been read and any cross-doc inconsistencies fixed in cross-review.

## What this skill does NOT do

- Does not bypass `template/tools/parallel-dispatch-check/check.sh`. The mechanical overlap check is the difference between this skill and ad-hoc dispatch — don't skip it.
- Does not replace `isolation: "worktree"` for cases where it's required (multi-operator-collab pattern). This skill assumes non-overlapping file scopes are sufficient isolation for additive new files; cross-edits of existing files still need worktrees.
- Does not dispatch work the orchestrator should do inline (mechanical pattern-edits, single-artifact work, briefs that aren't yet complete).
- Does not generate the briefs themselves. The orchestrator constructs the briefs from the planning thread; this skill is the workflow around dispatch, not a brief-generator.
- Does not commit on the orchestrator's behalf when the trigger is mid-thread analysis. Commit happens at end-of-wave, not after each agent return.

## Cross-skill invocation

Consider proactively suggesting this skill when:
- A `/blueprint-handoff` describes ≥2 parallel-safe next moves with named target files
- A planning thread closes with ≥2 artifact briefs fully specified
- `/blueprint-research` produces a research scope that decomposes into independent corpora
- The operator says "dispatch", "wave", "in parallel", or "across agents"

## Reference

- `template/tools/parallel-dispatch-check/check.sh` — pre-flight file-scope overlap detector (run before every dispatch)
- `template/tools/wave-digest/digest.mjs` — post-wave filter for the methodology log
- `template/methodology/handoff/handoff-template.md` — the cross-session handoff format; precursor to multi-agent dispatch
- quantifai-next `09036602` (2026-05-27) — canonical worked example: three Sonnet agents in parallel + orchestrator inline ingester work + post-flight cross-review caught one §C reclassification mismatch + commit-and-push to dev. Brief shape visible in the orchestrator's parent session.
