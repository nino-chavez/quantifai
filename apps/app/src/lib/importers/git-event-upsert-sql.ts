/**
 * The `git_events` upsert's `ON CONFLICT` clause — shared verbatim between
 * `src/lib/server/git-events.ts` (prepared statement, used by the Worker /
 * `--local`-mode server code path) and `scripts/import-git-events.ts`'s
 * `--local` direct-SQL path (no `D1Database` binding available in a plain
 * Node CLI, so it inlines SQL text via `sqlLiteral` instead of
 * `.prepare().bind()` — see scripts/lib/ingest-client.ts's header comment).
 * One string, two call sites, rather than two independently-maintained SQL
 * fragments that could silently drift out of sync on the rule that matters
 * most here.
 *
 * Never-regress rule (ADR-0004): once a commit has a `git_notes` (git-notes,
 * deterministic) link, a later re-import must not downgrade it back to
 * `time_window` (probabilistic) — even if that re-import's own pass
 * recomputed a time-window match for the same commit (e.g. the note was
 * later removed, or a batch that doesn't carry note data re-runs). The
 * reverse direction — upgrading `time_window` to `git_notes` once a note
 * appears (a session's commit gets noted after the fact, or the hook is
 * installed retroactively and back-filled) — always wins immediately,
 * because `excluded.link_method = 'git_notes'` is checked first below.
 *
 * Never-erase rule: a NULL `session_id` or `unit_id` from a re-import means
 * "this run could not tell", not "unlink". The time-window join and the unit
 * lookup both depend on which sessions and units the run can see, so a
 * re-run from a moved or renamed checkout can come back empty for history it
 * cannot place. Measured 2026-10-06: `ELSE excluded.session_id` and a bare
 * `unit_id = excluded.unit_id` let one such re-run erase ~432 session links
 * and every unit link on four repos. So both COALESCE onto the stored value.
 *
 * A different non-null time-window match still replaces the old one. The
 * join picks the tightest covering window, first among sessions under the
 * commit's own checkout and then across every spelling of the repo
 * (git-log.ts findSessionForCommitInRepo), and sessions are only ever
 * added. So a re-run from the same checkout sees at least the earlier
 * run's candidates, and a replacement is a tighter or newly-synced match.
 * Limit: a re-run from a moved checkout drops the old location to the
 * fallback tier, where an overlapping session from an unrelated repo with
 * the same folder name can win on width. Fill-only would block that and
 * also block every legitimate improvement; this keeps latest-wins.
 */
export const GIT_EVENT_UPSERT_ON_CONFLICT = `ON CONFLICT (repo, commit_sha) DO UPDATE SET
				   unit_id = COALESCE(excluded.unit_id, git_events.unit_id),
				   is_merge = excluded.is_merge,
				   session_id = CASE
				     WHEN excluded.link_method = 'git_notes' THEN excluded.session_id
				     WHEN git_events.link_method = 'git_notes' THEN git_events.session_id
				     ELSE COALESCE(excluded.session_id, git_events.session_id)
				   END,
				   link_method = CASE
				     WHEN excluded.link_method = 'git_notes' THEN excluded.link_method
				     WHEN git_events.link_method = 'git_notes' THEN git_events.link_method
				     ELSE excluded.link_method
				   END`;
