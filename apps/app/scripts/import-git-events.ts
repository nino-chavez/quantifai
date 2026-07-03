#!/usr/bin/env -S npx tsx
/**
 * Importer: `git log` on configured repo paths -> git_events, time-window
 * joined to sessions. This is the output-pairing signal (ADR-0004): the
 * honest v0 is "a commit landed while a session covering this repo was
 * active," not a cryptographically certain link (that's git-notes, later).
 *
 * Usage: npm run import:git
 * Config: QUANTIFAI_GIT_REPOS env var, comma-separated absolute repo paths.
 *         Defaults to this repo + wip/quantifai-platform if unset.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDotEnv, createPgPool } from './lib/pg-client';
import { parseGitLog, findSessionForCommit, GIT_LOG_FORMAT, type SessionWindow } from '../src/lib/importers/git-log';
import { normalizeProjectPath } from '../src/lib/attribution/project-path';

loadDotEnv();

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

async function main() {
	const pool = createPgPool();
	const client = await pool.connect();

	let totalCommits = 0;
	let totalLinked = 0;

	try {
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

			// Look up (don't create) the unit_of_work for this repo — a git
			// repo with zero Claude Code sessions against it has no unit yet,
			// and this importer should not invent one out of git history alone
			// (it would show a $0-cost row with commits and no session count,
			// contradicting DESIGN.md rule 3: "no cost number without its
			// paired output" cuts both ways — no output row without a cost pairing either).
			const unitRes = await client.query<{ id: string }>(
				`SELECT id FROM units_of_work WHERE project_path = $1 LIMIT 1`,
				[projectPath]
			);
			const unitId: string | null = unitRes.rows[0]?.id ?? null;

			const sessionsRes = await client.query<{
				session_id: string;
				started_at: string;
				ended_at: string;
			}>(
				`SELECT session_id, started_at, ended_at FROM sessions
				 WHERE project_path = $1 AND started_at IS NOT NULL AND ended_at IS NOT NULL`,
				[projectPath]
			);
			const windows: SessionWindow[] = sessionsRes.rows.map((r) => ({
				sessionId: r.session_id,
				startedAt: r.started_at,
				endedAt: r.ended_at
			}));

			for (const commit of commits) {
				const match = findSessionForCommit(commit, windows);
				if (match) totalLinked += 1;

				await client.query(
					`INSERT INTO git_events (repo, commit_sha, authored_at, message, unit_id, session_id, link_method)
					 VALUES ($1, $2, $3, $4, $5, $6, 'time_window')
					 ON CONFLICT (repo, commit_sha) DO UPDATE SET
					   unit_id = EXCLUDED.unit_id,
					   session_id = EXCLUDED.session_id`,
					[repoName, commit.sha, commit.authoredAt, commit.message, unitId, match?.sessionId ?? null]
				);
				totalCommits += 1;
			}
		}
	} finally {
		client.release();
		await pool.end();
	}

	console.log('');
	console.log(
		`Git import complete: ${totalCommits} commits recorded, ${totalLinked} time-window-linked to a session (${totalCommits - totalLinked} unlinked — honest v0, no session covered that commit's timestamp)`
	);
}

main().catch((err) => {
	console.error('Git import failed:', err);
	process.exit(1);
});
