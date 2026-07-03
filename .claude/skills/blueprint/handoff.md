---
name: blueprint-handoff
description: Generate a session/stage/cross-repo handoff document by deriving state from git + pwd + recent activity, leaving only "what's pending" and "sequencing" for operator input. Use when leaving work for a future session or another agent to pick up, or when the operator says "write a handoff" or "handoff doc".
---

# /blueprint-handoff

Generate a session/stage/cross-repo handoff document by deriving state from git + pwd + recent activity, leaving only "what's pending" and "sequencing" for operator input.

Implements wave 25's operator-handoff pattern. Template source: `$BLUEPRINT_HOME/template/methodology/handoff/handoff-template.md`. Pattern doc: `$BLUEPRINT_HOME/docs/patterns/operator-handoff-pattern.md`.

## When to use

At any of the three trigger types from the operator-handoff-pattern:

1. **Stage transition** — next stage's operator is a different agent session; stage carries non-trivial context the next agent can't recover from `git log` + canonical pipeline alone
2. **Session restart** — anticipated session break (context-window expiration, cross-machine resumption, focus break expected)
3. **Cross-repo dispatch** — work spawns continuation in a different repo (the rally-hq → tools/blueprint shape from `apps/rally-hq/blueprint/HANDOFF-blueprint-template-gaps.md`)

Skip when work continues in the same session with no expected interruption, or when commit-message + `git log` + STATE.md gives the next reader everything they need.

## What it does

1. **Identify the trigger type.** Ask the operator which of stage-transition / session-restart / cross-repo-dispatch this handoff is for. Operator-declared, not inferred — the trigger affects which sections of the template apply.

2. **Derive the state header** mechanically:
   - **Date**: today (`date +%Y-%m-%d`)
   - **Working tree**: `pwd` (absolute path of the repo this handoff is written FROM)
   - **Most recent commit**: `git log -1 --pretty=format:'%h %s'`
   - **Destination** (cross-repo only): ask operator for the path/repo this handoff is written TO

3. **Derive "what's done"** from recent commits. Default scope: commits since the most recent prior HANDOFF file (if one exists; check `HANDOFF*.md` mtime), otherwise last 14 days or last 20 commits whichever is fewer. Operator can override the window. Format each commit as a checked checklist item:
   ```
   - [x] {commit subject} (`{sha}`)
   ```
   For cross-repo dispatch: also enumerate any pending uncommitted changes (`git status --short`) the destination operator needs to know about.

4. **Compose "what's live"** (cross-repo + cases with deployed resources): ask the operator for URLs, deployed worker/page/database identifiers, and external integrations. Skip the section entirely if the trigger is intra-repo and there's no deployed surface.

5. **Compose "local refs / secrets"** (when applicable): ask the operator if local-only state (cached credentials, machine-specific paths) is needed for the destination work. Reference paths only — never include secret values. Skip the section if no local state is relevant.

6. **Ask the operator** for the two sections that cannot be derived:
   - **What's pending** — concrete next actions in priority/dependency order
   - **Sequencing** (optional) — explicit dependency order if not obvious from the pending list

7. **Compose "out-of-scope"** (optional): if the handoff might be confused with an adjacent artifact (prescription / STATE.md / ADR), ask the operator to name what this handoff is NOT. Skip if scope is obvious.

8. **Write to the right path**:
   - Stage transition or session restart, single topic: `HANDOFF.md` at the initiative root
   - Cross-repo dispatch or topic-scoped: `blueprint/HANDOFF-<topic>.md` (where `<topic>` is the short slug operator provides)
   - Confirm the path with the operator before writing if any existing `HANDOFF*.md` would be overwritten

9. **Cite the template + pattern doc** in a closing comment so future readers find their way to the convention.

## Output

- `HANDOFF.md` at initiative root, OR
- `blueprint/HANDOFF-<topic>.md` for topic-scoped handoffs

## What this skill does NOT do

- Does not commit the handoff. The operator decides when to commit (some handoffs are immediate, some get edited further before staging).
- Does not push or notify any destination. Cross-repo handoffs require the operator to actually open a fresh session in the destination repo and read the file there.
- Does not replace `STATE.md` (living per-initiative status), `prescription.yml` (change-item ledger), or `METHODOLOGY-AMENDMENTS.md` (methodology-learning log). Handoffs are momentary; the other artifacts are durable.

## Cross-skill invocation

Consider proactively suggesting this skill when:
- `/blueprint-validate` detects Stage 4 closure with stage 5 not yet started
- `/blueprint-deploy` completes successfully and the operator mentions a session break
- The conversation involves dispatching work to a different repo
