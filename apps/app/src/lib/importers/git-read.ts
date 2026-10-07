/**
 * Node-only: shells out to `git log` for the git-events importer
 * (scripts/import-git-events.ts). Kept apart from git-log.ts and
 * git-notes.ts because those are pure parsers the Worker also imports;
 * nothing under src/lib/server may import this module.
 */
import { execFileSync } from 'node:child_process';
import { GIT_LOG_FORMAT } from './git-log';
import { GIT_NOTES_LOG_FORMAT, QUANTIFAI_NOTES_REF } from './git-notes';

/**
 * The refs that count as real history: local branches, remote-tracking
 * branches, tags. Not `--all`, which also walks refs/notes/quantifai (every
 * note the post-commit hook writes is itself a commit, "Notes added by 'git
 * notes add'" — 683 of them reached production as git_events on 2026-10-06),
 * refs/stash, and tool-owned refs such as refs/codex/* snapshots and
 * refs/archive/* cleanup commits. An allow-list, because a deny-list grows
 * every time a tool invents a ref namespace. No `HEAD`: in a repo with no
 * commits yet it makes `git log` exit 128. The cost is that commits on a
 * detached HEAD (mid-rebase, or never put on a branch) are skipped until
 * they land on a branch, remote or tag; detached commits in other worktrees
 * were out of reach of `HEAD` anyway.
 */
export const GIT_HISTORY_REVS = ['--branches', '--remotes', '--tags'] as const;

const GIT_LOG_MAX_BUFFER = 64 * 1024 * 1024;

export function readGitLog(repoPath: string): string {
	return execFileSync('git', ['log', ...GIT_HISTORY_REVS, `--pretty=format:${GIT_LOG_FORMAT}`], {
		cwd: repoPath,
		encoding: 'utf8',
		maxBuffer: GIT_LOG_MAX_BUFFER
	});
}

/**
 * `git log --notes=refs/notes/quantifai` over the same revs as readGitLog,
 * so every ingested commit can pick up its note — the git-notes
 * deterministic linkage signal (git-notes.ts does the parsing). Notes are
 * local to this machine; a repo with no notes ref yet (the hook was never
 * installed, or has never fired) just returns no notes — git emits a
 * harmless stderr warning ("notes ref ... is invalid") in that case, not an
 * error, verified empirically 2026-07-03.
 */
export function readGitNotesLog(repoPath: string): string {
	return execFileSync(
		'git',
		['log', ...GIT_HISTORY_REVS, `--pretty=format:${GIT_NOTES_LOG_FORMAT}`, `--notes=${QUANTIFAI_NOTES_REF}`],
		{ cwd: repoPath, encoding: 'utf8', maxBuffer: GIT_LOG_MAX_BUFFER }
	);
}
