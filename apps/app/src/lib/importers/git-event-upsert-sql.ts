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
 */
export const GIT_EVENT_UPSERT_ON_CONFLICT = `ON CONFLICT (repo, commit_sha) DO UPDATE SET
				   unit_id = excluded.unit_id,
				   is_merge = excluded.is_merge,
				   session_id = CASE
				     WHEN excluded.link_method = 'git_notes' THEN excluded.session_id
				     WHEN git_events.link_method = 'git_notes' THEN git_events.session_id
				     ELSE excluded.session_id
				   END,
				   link_method = CASE
				     WHEN excluded.link_method = 'git_notes' THEN excluded.link_method
				     WHEN git_events.link_method = 'git_notes' THEN git_events.link_method
				     ELSE excluded.link_method
				   END`;
