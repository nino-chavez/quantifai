/**
 * Git-event upsert — plain SQL translation of the INSERT ... ON CONFLICT
 * used by scripts/import-git-events.ts against Postgres. No stored function
 * existed for this on the Postgres side either (it was inline SQL in the
 * importer) — ported here so both the local-D1 importer path and the
 * `/api/v1/ingest` endpoint share one implementation.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface GitEventInput {
	repo: string;
	commitSha: string;
	authoredAt: string;
	message: string | null;
	unitId: string | null;
	sessionId: string | null;
	linkMethod: 'time_window' | 'git_notes';
}

export async function upsertGitEvent(db: D1Database, input: GitEventInput): Promise<void> {
	await db
		.prepare(
			`INSERT INTO git_events (id, repo, commit_sha, authored_at, message, unit_id, session_id, link_method)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
			 ON CONFLICT (repo, commit_sha) DO UPDATE SET
			   unit_id = excluded.unit_id,
			   session_id = excluded.session_id`
		)
		.bind(
			crypto.randomUUID(),
			input.repo,
			input.commitSha,
			input.authoredAt,
			input.message,
			input.unitId,
			input.sessionId,
			input.linkMethod
		)
		.run();
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
