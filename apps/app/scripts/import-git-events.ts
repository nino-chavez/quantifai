#!/usr/bin/env -S npx tsx
/**
 * Importer: `git log` on configured repo paths -> git_events. This is the
 * output-pairing signal (ADR-0004): the honest v0 is "a commit landed while
 * a session covering this repo was active," not a cryptographically certain
 * link (that's git-notes, later).
 *
 * Two write paths (ADR-0005), same split as import-claude-jsonl.ts:
 *   - Default (remote): ship raw commits to `POST /api/v1/ingest` —
 *     QUANTIFAI_API_URL + QUANTIFAI_API_KEY. The server does the
 *     time-window join itself (it has direct D1 access with no row cap).
 *   - `--local`: resolve the unit + do the time-window join here, against
 *     the local D1 file via `wrangler d1 execute --local`.
 *
 * Usage: npm run import:git [-- --local]
 * Config: QUANTIFAI_GIT_REPOS env var, comma-separated absolute repo paths.
 *         Defaults to this repo + wip/quantifai-platform if unset.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDotEnv, sqlLiteral, runD1File, runD1Query, postIngestBatch, randomUUID } from './lib/ingest-client';
import {
	parseGitLog,
	findSessionForCommit,
	GIT_LOG_FORMAT,
	type SessionWindow
} from '../src/lib/importers/git-log';
import { normalizeProjectPath } from '../src/lib/attribution/project-path';
import { chunk } from '../src/lib/importers/chunk';

const GIT_EVENT_POST_CHUNK = 8000; // stays comfortably under the server's 10k MAX_BATCH_SIZE

loadDotEnv();

const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const APP_DIR = resolve(import.meta.dirname, '..'); // apps/app — where wrangler.jsonc lives

const DEFAULT_REPOS = [
	resolve(import.meta.dirname, '../../..'), // apps/app/scripts -> repo root (worktree root if run from inside one; normalizeProjectPath collapses that back to the real repo path)
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

function getGitLog(repoPath: string): string {
	return execFileSync('git', ['log', '--all', `--pretty=format:${GIT_LOG_FORMAT}`], {
		cwd: repoPath,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
}

interface RawGitEvent {
	repo: string;
	commitSha: string;
	authoredAt: string;
	message: string | null;
	unitProjectPath: string | null;
	isMerge: boolean;
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
			output = getGitLog(repoPath);
		} catch (err) {
			console.error(`  git log failed for ${repoPath}:`, (err as Error).message);
			continue;
		}
		const commits = parseGitLog(output);
		console.log(`  ${commits.length} commits`);

		for (const commit of commits) {
			rawEvents.push({
				repo: repoName,
				commitSha: commit.sha,
				authoredAt: commit.authoredAt,
				message: commit.message,
				unitProjectPath: projectPath,
				isMerge: commit.isMerge
			});
		}
		totalCommits += commits.length;
	}

	let totalLinked: number;
	if (LOCAL) {
		totalLinked = await writeLocal(rawEvents);
	} else {
		totalLinked = await writeRemote(rawEvents, { apiUrl, apiKey });
	}

	console.log('');
	console.log(
		`Git import complete: ${totalCommits} commits recorded, ${totalLinked} time-window-linked to a session (${totalCommits - totalLinked} unlinked — honest v0, no session covered that commit's timestamp)`
	);
}

// ============================================================
// Local D1 write path (`--local`).
// ============================================================

async function writeLocal(events: RawGitEvent[]): Promise<number> {
	const d1opts = { cwd: APP_DIR, local: true };
	let linked = 0;

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
		const unitRows = runD1Query<{ id: string }>(
			`SELECT id FROM units_of_work WHERE project_path = ${sqlLiteral(projectPath)} LIMIT 1`,
			d1opts
		);
		const unitId = unitRows[0]?.id ?? null;

		const windows = runD1Query<{ session_id: string; started_at: string; ended_at: string }>(
			`SELECT session_id, started_at, ended_at FROM sessions WHERE project_path = ${sqlLiteral(projectPath)} AND started_at IS NOT NULL AND ended_at IS NOT NULL`,
			d1opts
		);
		const sessionWindows: SessionWindow[] = windows.map((r) => ({
			sessionId: r.session_id,
			startedAt: r.started_at,
			endedAt: r.ended_at
		}));

		for (const event of repoEvents) {
			const match = findSessionForCommit(
				{ sha: event.commitSha, authoredAt: event.authoredAt, message: event.message ?? '' },
				sessionWindows
			);
			if (match) linked += 1;
			statements.push(
				`INSERT INTO git_events (id, repo, commit_sha, authored_at, message, unit_id, session_id, link_method, is_merge)
				 VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(event.repo)}, ${sqlLiteral(event.commitSha)}, ${sqlLiteral(event.authoredAt)}, ${sqlLiteral(event.message)}, ${sqlLiteral(unitId)}, ${sqlLiteral(match?.sessionId ?? null)}, 'time_window', ${event.isMerge ? 1 : 0})
				 ON CONFLICT (repo, commit_sha) DO UPDATE SET unit_id = excluded.unit_id, session_id = excluded.session_id, is_merge = excluded.is_merge;`
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
	return linked;
}

// ============================================================
// Remote write path (default) — server resolves unit + does the join.
// ============================================================

async function writeRemote(events: RawGitEvent[], api: { apiUrl: string; apiKey: string }): Promise<number> {
	let linked = 0;
	for (const batch of chunk(events, GIT_EVENT_POST_CHUNK)) {
		if (batch.length === 0) continue;
		const result = (await postIngestBatch({ gitEvents: batch }, api)) as {
			gitEvents: { accepted: number; linked: number };
		};
		linked += result.gitEvents?.linked ?? 0;
	}
	return linked;
}

main().catch((err) => {
	console.error('Git import failed:', err);
	process.exit(1);
});
