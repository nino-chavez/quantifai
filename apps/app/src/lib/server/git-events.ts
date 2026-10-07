/**
 * Git-event upsert — plain SQL translation of the INSERT ... ON CONFLICT
 * used by scripts/import-git-events.ts against Postgres. No stored function
 * existed for this on the Postgres side either (it was inline SQL in the
 * importer) — ported here so both the local-D1 importer path and the
 * `/api/v1/ingest` endpoint share one implementation.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { GIT_EVENT_UPSERT_ON_CONFLICT } from '$lib/importers/git-event-upsert-sql';
import {
	canonicalRepo,
	repoKey,
	repoNames,
	NO_REPO_ALIASES,
	type RepoAliases
} from '$lib/attribution/project-path';

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

/** What the row holds after the upsert — the never-regress and never-erase rules can keep the stored link over the one this run computed. */
export interface StoredGitEventLink {
	sessionId: string | null;
	linkMethod: 'time_window' | 'git_notes';
}

function upsertGitEventStatement(db: D1Database, input: GitEventInput) {
	return db
		.prepare(
			`INSERT INTO git_events (id, repo, commit_sha, authored_at, message, unit_id, session_id, link_method, is_merge)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
			 ${GIT_EVENT_UPSERT_ON_CONFLICT}
			 RETURNING session_id AS sessionId, link_method AS linkMethod`
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
		);
}

export async function upsertGitEvent(db: D1Database, input: GitEventInput): Promise<StoredGitEventLink> {
	const row = await upsertGitEventStatement(db, input).first<StoredGitEventLink>();
	if (!row) throw new Error(`upsertGitEvent: no row returned for ${input.repo}@${input.commitSha}`);
	return row;
}

/**
 * Statements per `db.batch()` call. A batch is one round trip and one
 * transaction, and each call has its own 30 s duration limit (D1 platform
 * limits), so a few hundred cheap upserts per call stays well inside it.
 */
export const GIT_EVENT_BATCH_SIZE = 100;

/**
 * Many upserts in `db.batch()` round trips instead of one query each.
 * Returns the stored link per input, in input order. Measured 2026-10-06: an
 * 8,000-event import issued ~9.6k sequential D1 queries in one Worker
 * invocation and died with ECONNRESET; 400-event requests completed.
 */
export async function upsertGitEvents(
	db: D1Database,
	inputs: GitEventInput[],
	batchSize = GIT_EVENT_BATCH_SIZE
): Promise<StoredGitEventLink[]> {
	const stored: StoredGitEventLink[] = [];
	for (let i = 0; i < inputs.length; i += batchSize) {
		const slice = inputs.slice(i, i + batchSize);
		const results = await db.batch<StoredGitEventLink>(slice.map((input) => upsertGitEventStatement(db, input)));
		results.forEach((result, j) => {
			const row = result.results?.[0];
			if (!row) throw new Error(`upsertGitEvents: no row returned for ${slice[j].repo}@${slice[j].commitSha}`);
			stored.push(row);
		});
	}
	return stored;
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

/**
 * Sessions with known start/end windows for one repo — the join input for
 * time-window matching (src/lib/importers/git-log.ts findSessionForCommit).
 * Matches every stored path spelling of the repo via `repoKey`, not one
 * exact `project_path`: before 2026-10-06 an exact match meant a commit could
 * only link to sessions recorded under the same path the importer ran from,
 * so moved repos, worktree sessions, and the other Mac's sessions never
 * linked. `instr` narrows the scan to plausible rows (no LIKE, so `_` and `%`
 * in a repo name are literal); `repoKey` makes the exact decision. Rows keep
 * `projectPath` so the join can prefer the commit's own checkout
 * (git-log.ts findSessionForCommitInRepo). `key` is a canonical repo name;
 * sessions recorded under any of its aliases (an old folder name) match too.
 */
export async function sessionWindowsForRepo(
	db: D1Database,
	key: string,
	aliases: RepoAliases = NO_REPO_ALIASES
): Promise<Array<{ sessionId: string; projectPath: string; startedAt: string; endedAt: string }>> {
	const names = repoNames(key, aliases);
	const { results } = await db
		.prepare(
			`SELECT session_id AS sessionId, project_path AS projectPath, started_at AS startedAt, ended_at AS endedAt
			 FROM sessions
			 WHERE (${names.map((_, i) => `instr(project_path, ?${i + 1}) > 0`).join(' OR ')})
			   AND started_at IS NOT NULL AND ended_at IS NOT NULL`
		)
		.bind(...names)
		.all<{ sessionId: string; projectPath: string; startedAt: string; endedAt: string }>();
	return results.filter((r) => canonicalRepo(repoKey(r.projectPath), aliases) === key);
}
