#!/usr/bin/env -S npx tsx
/**
 * Importer: `git log` on configured repo paths -> git_events. Two linkage
 * mechanisms feed this now (ADR-0004):
 *   - git-notes (deterministic): `hooks/quantifai-post-commit` writes a note
 *     under refs/notes/quantifai at commit time, naming the exact session.
 *     This importer reads it via `git log --notes=refs/notes/quantifai`
 *     (src/lib/importers/git-notes.ts) and — when present — uses it as the
 *     authoritative link, no guessing involved.
 *   - time-window join (probabilistic, the original honest v0): "a commit
 *     landed while a session covering this repo was active." Remains the
 *     fallback for any commit with no note (all pre-hook history, or a
 *     commit made outside a Claude Code session/heartbeat).
 * Notes are LOCAL to this machine (git notes don't travel with `git clone`/
 * `git push` unless pushed explicitly — see hooks/quantifai-post-commit's
 * header) — this importer only ever sees notes that exist on the machine
 * it's run from.
 *
 * Walks branches, remote-tracking branches and tags only, never `--all`:
 * refs/notes/quantifai is itself a chain of "Notes added by 'git notes add'"
 * commits, and stash and tool-owned refs hold machine-made ones
 * (src/lib/importers/git-read.ts GIT_HISTORY_REVS).
 *
 * Two write paths (ADR-0005), same split as import-claude-jsonl.ts:
 *   - Default (remote): ship raw commits (+ any resolved note session id) to
 *     `POST /api/v1/ingest` — QUANTIFAI_API_URL + QUANTIFAI_API_KEY. The
 *     server does the time-window join itself for un-noted commits (it has
 *     direct D1 access with no row cap); a noted commit skips that join
 *     entirely since the server already has an authoritative session id.
 *   - `--local`: resolve the unit + do the time-window join here, against
 *     the local D1 file via `wrangler d1 execute --local`.
 *
 * Usage: npm run import:git [-- --local]
 * Config: QUANTIFAI_GIT_REPOS env var, comma-separated absolute repo paths.
 *         Defaults to this repo + wip/quantifai-platform if unset.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDotEnv, sqlLiteral, runD1File, runD1Query, postIngestBatch, randomUUID } from './lib/ingest-client';
import {
	parseGitLog,
	findSessionForCommitInRepo,
	type SessionWindow
} from '../src/lib/importers/git-log';
import { parseGitNotesLog } from '../src/lib/importers/git-notes';
import { readGitLog, readGitNotesLog } from '../src/lib/importers/git-read';
import { GIT_EVENT_UPSERT_ON_CONFLICT } from '../src/lib/importers/git-event-upsert-sql';
import { normalizeProjectPath, pickUnitForRepo, repoKey, type UnitCandidate } from '../src/lib/attribution/project-path';
import { chunk } from '../src/lib/importers/chunk';

// Events per POST /api/v1/ingest request. Bounded by what one Worker
// invocation can finish, not by MAX_BATCH_SIZE: an 8,000-event request died
// with ECONNRESET on 2026-10-06 while 400-event requests completed. The
// server now batches its upserts, but the cap is sized as if every statement
// still counted toward D1's 1,000-queries-per-invocation limit.
const GIT_EVENT_POST_CHUNK = 500;

loadDotEnv();

const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const APP_DIR = resolve(import.meta.dirname, '..'); // apps/app — where wrangler.jsonc lives

const DEFAULT_REPOS = [
	resolve(import.meta.dirname, '../../..'), // apps/app/scripts -> repo root (worktree root if run from inside one; normalizeProjectPath collapses a .worktrees/ or .claude/worktrees/ path back to the real repo path)
	'/Users/nino/Workspace/dev/wip/quantifai-platform'
];

function configuredRepos(): string[] {
	const raw = process.env.QUANTIFAI_GIT_REPOS;
	if (!raw) return DEFAULT_REPOS;
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

interface RawGitEvent {
	repo: string;
	commitSha: string;
	authoredAt: string;
	message: string | null;
	unitProjectPath: string | null;
	isMerge: boolean;
	/** Session id from a local refs/notes/quantifai note, when one exists — deterministic linkage, takes priority over the time-window join at write time. */
	noteSessionId: string | null;
}

async function main() {
	let apiUrl = '';
	let apiKey = '';
	if (!LOCAL) {
		apiUrl = process.env.QUANTIFAI_API_URL ?? '';
		apiKey = process.env.QUANTIFAI_API_KEY ?? '';
		if (!apiUrl || !apiKey) {
			console.error(
				'QUANTIFAI_API_URL and QUANTIFAI_API_KEY must be set (or pass --local to write directly to local D1).'
			);
			process.exit(1);
		}
	}

	const rawEvents: RawGitEvent[] = [];
	let totalCommits = 0;

	for (const repoPath of configuredRepos()) {
		if (!existsSync(resolve(repoPath, '.git'))) {
			console.log(`Skip (not a git repo): ${repoPath}`);
			continue;
		}

		const { repoName, projectPath } = normalizeProjectPath(repoPath, repoPath);
		console.log(`Reading git log for ${repoName} (${repoPath})`);

		let output: string;
		try {
			output = readGitLog(repoPath);
		} catch (err) {
			console.error(`  git log failed for ${repoPath}:`, (err as Error).message);
			continue;
		}
		const commits = parseGitLog(output);
		console.log(`  ${commits.length} commits`);

		let notes: Map<string, { sessionId: string }> = new Map();
		try {
			notes = parseGitNotesLog(readGitNotesLog(repoPath));
			if (notes.size > 0) console.log(`  ${notes.size} commit(s) with a quantifai git-note (deterministic)`);
		} catch (err) {
			// Fail-open, same posture as the hook itself: a notes-read problem
			// degrades to "no notes this run," never aborts the git-log import.
			console.error(`  git notes read failed for ${repoPath} (continuing without them):`, (err as Error).message);
		}

		for (const commit of commits) {
			rawEvents.push({
				repo: repoName,
				commitSha: commit.sha,
				authoredAt: commit.authoredAt,
				message: commit.message,
				unitProjectPath: projectPath,
				isMerge: commit.isMerge,
				noteSessionId: notes.get(commit.sha)?.sessionId ?? null
			});
		}
		totalCommits += commits.length;
	}

	let result: { linked: number; deterministic: number };
	if (LOCAL) {
		result = await writeLocal(rawEvents);
	} else {
		result = await writeRemote(rawEvents, { apiUrl, apiKey });
	}

	const timeWindowLinked = result.linked - result.deterministic;
	console.log('');
	console.log(
		`Git import complete: ${totalCommits} commits recorded — ${result.deterministic} git-note (deterministic), ${timeWindowLinked} time-window-linked, ${totalCommits - result.linked} unlinked (honest v0/v1: no note and no session covered that commit's timestamp)`
	);
}

// ============================================================
// Local D1 write path (`--local`).
// ============================================================

/**
 * Counts are the links this run computed. The upsert can keep a stored link
 * this run could not find (never-erase rule, git-event-upsert-sql.ts), so in
 * local mode "unlinked" is an upper bound; the remote path reports stored
 * values from the server.
 */
async function writeLocal(events: RawGitEvent[]): Promise<{ linked: number; deterministic: number }> {
	const d1opts = { cwd: APP_DIR, local: true };
	let linked = 0;
	let deterministic = 0;

	// Group by unitProjectPath so we only look up the unit + session windows
	// once per repo, not once per commit.
	const byPath = new Map<string, RawGitEvent[]>();
	for (const e of events) {
		if (!e.unitProjectPath) continue;
		const list = byPath.get(e.unitProjectPath) ?? [];
		list.push(e);
		byPath.set(e.unitProjectPath, list);
	}

	const statements: string[] = [];
	for (const [projectPath, repoEvents] of byPath) {
		// Same repo-identity rules as the server path (units-of-work.ts
		// findUnitIdForRepo, git-events.ts sessionWindowsForRepo): match every
		// stored spelling of the repo, not this checkout's exact path.
		const key = repoKey(projectPath);
		const unitId = pickUnitForRepo(
			projectPath,
			runD1Query<UnitCandidate>(
				`SELECT id, project_path FROM units_of_work WHERE instr(project_path, ${sqlLiteral(key)}) > 0`,
				d1opts
			)
		);

		const windows = runD1Query<{ session_id: string; project_path: string; started_at: string; ended_at: string }>(
			`SELECT session_id, project_path, started_at, ended_at FROM sessions WHERE instr(project_path, ${sqlLiteral(key)}) > 0 AND started_at IS NOT NULL AND ended_at IS NOT NULL`,
			d1opts
		);
		const sessionWindows: Array<SessionWindow & { projectPath: string }> = windows
			.filter((r) => repoKey(r.project_path) === key)
			.map((r) => ({
				sessionId: r.session_id,
				projectPath: r.project_path,
				startedAt: r.started_at,
				endedAt: r.ended_at
			}));

		for (const event of repoEvents) {
			// Deterministic (git-notes) linkage always wins over the
			// time-window guess when both are available for the same commit.
			let sessionId: string | null;
			let linkMethod: 'git_notes' | 'time_window';
			if (event.noteSessionId) {
				sessionId = event.noteSessionId;
				linkMethod = 'git_notes';
				deterministic += 1;
			} else {
				const match = findSessionForCommitInRepo(
					{ sha: event.commitSha, authoredAt: event.authoredAt, message: event.message ?? '' },
					sessionWindows,
					projectPath
				);
				sessionId = match?.sessionId ?? null;
				linkMethod = 'time_window';
			}
			if (sessionId) linked += 1;

			statements.push(
				`INSERT INTO git_events (id, repo, commit_sha, authored_at, message, unit_id, session_id, link_method, is_merge)
				 VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(event.repo)}, ${sqlLiteral(event.commitSha)}, ${sqlLiteral(event.authoredAt)}, ${sqlLiteral(event.message)}, ${sqlLiteral(unitId)}, ${sqlLiteral(sessionId)}, ${sqlLiteral(linkMethod)}, ${event.isMerge ? 1 : 0})
				 ${GIT_EVENT_UPSERT_ON_CONFLICT};`
			);
		}
	}

	// Chunked for the same reason import-claude-jsonl.ts's writeLocal chunks
	// at 40 rather than 500: measured empirically (QUANTIFAI_DEBUG_SQL=1 in
	// ingest-client.ts's runD1File), wrangler's local D1 executor rejects a
	// --file with SQLITE_TOOBIG well under SQLite's own ~1MB SQL-length
	// default (a 100-row, ~200KB chunk already fails) — an un-chunked
	// multi-hundred-commit history would fail the same way.
	const LOCAL_SQL_CHUNK_SIZE = 40;
	for (const batch of chunk(statements, LOCAL_SQL_CHUNK_SIZE)) {
		if (batch.length) runD1File(batch.join('\n'), d1opts);
	}
	return { linked, deterministic };
}

// ============================================================
// Remote write path (default) — server resolves unit + does the join for
// any commit that didn't already resolve via a local git-note.
// ============================================================

async function writeRemote(
	events: RawGitEvent[],
	api: { apiUrl: string; apiKey: string }
): Promise<{ linked: number; deterministic: number }> {
	let linked = 0;
	let deterministic = 0;
	for (const batch of chunk(events, GIT_EVENT_POST_CHUNK)) {
		if (batch.length === 0) continue;
		const result = (await postIngestBatch({ gitEvents: batch }, api)) as {
			gitEvents: { accepted: number; linked: number; deterministic: number };
		};
		linked += result.gitEvents?.linked ?? 0;
		deterministic += result.gitEvents?.deterministic ?? 0;
	}
	return { linked, deterministic };
}

main().catch((err) => {
	console.error('Git import failed:', err);
	process.exit(1);
});
