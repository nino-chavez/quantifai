/**
 * Git-event upsert — plain SQL translation of the INSERT ... ON CONFLICT
 * used by scripts/import-git-events.ts against Postgres. No stored function
 * existed for this on the Postgres side either (it was inline SQL in the
 * importer) — ported here so both the local-D1 importer path and the
 * `/api/v1/ingest` endpoint share one implementation.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { GIT_EVENT_UPSERT_ON_CONFLICT } from '$lib/importers/git-event-upsert-sql';

export interface GitEventInput {
	repo: string;
	commitSha: string;
	authoredAt: string;
	message: string | null;
	unitId: string | null;
	sessionId: string | null;
	linkMethod: 'time_window' | 'git_notes';
	/** Practice-numbers slice: classified at import time from `%P` parent-hash count (see src/lib/importers/git-log.ts) — 2+ parents = merge commit. */
	isMerge: boolean;
}

export async function upsertGitEvent(db: D1Database, input: GitEventInput): Promise<void> {
	await db
		.prepare(
			`INSERT INTO git_events (id, repo, commit_sha, authored_at, message, unit_id, session_id, link_method, is_merge)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
			 ${GIT_EVENT_UPSERT_ON_CONFLICT}`
		)
		.bind(
			crypto.randomUUID(),
			input.repo,
			input.commitSha,
			input.authoredAt,
			input.message,
			input.unitId,
			input.sessionId,
			input.linkMethod,
			input.isMerge ? 1 : 0
		)
		.run();
}

/**
 * Commit/merge counts grouped by unit, optionally restricted to commits
 * authored on/after `sinceIso` (practice-numbers window filter). Unit-less
 * commits (a repo scanned before any Claude Code session existed for it)
 * group under a null key — practice-level totals still need them; per-unit
 * rollups don't have a row to attach them to (same rule the ledger already
 * follows for unit-less sessions).
 */
export interface CommitStats {
	unit_id: string | null;
	commit_count: number;
	merge_count: number;
	/** Commits linked via a git-notes record (link_method = 'git_notes') — deterministic, vs. the time-window fallback for the rest. */
	deterministic_commit_count: number;
}

export async function commitStatsByUnit(db: D1Database, sinceIso: string | null): Promise<CommitStats[]> {
	const { results } = await db
		.prepare(
			`SELECT
				unit_id,
				COUNT(*) AS commit_count,
				COALESCE(SUM(is_merge), 0) AS merge_count,
				COALESCE(SUM(CASE WHEN link_method = 'git_notes' THEN 1 ELSE 0 END), 0) AS deterministic_commit_count
			 FROM git_events
			 WHERE (?1 IS NULL OR authored_at >= ?1)
			 GROUP BY unit_id`
		)
		.bind(sinceIso)
		.all<CommitStats>();
	return results;
}

/** Sessions with known start/end windows for one project — the join input for time-window matching (src/lib/importers/git-log.ts findSessionForCommit). */
export async function sessionWindowsForProject(
	db: D1Database,
	projectPath: string
): Promise<Array<{ sessionId: string; startedAt: string; endedAt: string }>> {
	const { results } = await db
		.prepare(
			`SELECT session_id AS sessionId, started_at AS startedAt, ended_at AS endedAt
			 FROM sessions
			 WHERE project_path = ?1 AND started_at IS NOT NULL AND ended_at IS NOT NULL`
		)
		.bind(projectPath)
		.all<{ sessionId: string; startedAt: string; endedAt: string }>();
	return results;
}
