/**
 * Project-path normalization — turns a Claude Code project identity into a
 * stable, human-legible unit-of-work key.
 *
 * Claude Code stores session JSONL under `~/.claude/projects/<encoded-cwd>/`,
 * where the directory name is the working-directory path with `/` replaced by
 * `-` (e.g. `/Users/nino/Workspace/dev/wip/quantifai-next` becomes
 * `-Users-nino-Workspace-dev-wip-quantifai-next`). That encoding is NOT safely
 * reversible: repo names routinely contain dashes themselves
 * (`quantifai-next`, `bc-site-doctor`), so naively splitting the encoded name
 * on `-` misidentifies the repo boundary.
 *
 * The reliable source of truth is the `cwd` field Claude Code stamps on most
 * session records — the real, unencoded absolute path. This module prefers
 * that; it only falls back to the (unreliable) encoded directory name when no
 * record in a project's JSONL carries a `cwd` (old sessions, or a malformed
 * file), and even then it does NOT attempt to decode the path — it keys on
 * the raw encoded name, which is still unique and stable, just less pretty.
 */

export interface NormalizedProject {
	/** Canonical absolute path when known from a real `cwd`, else the raw encoded directory name. */
	projectPath: string;
	/** Human-facing name — the last path segment when normalized, else the raw encoded name. */
	repoName: string;
	/** True when derived from an observed `cwd`; false when using the encoded-name fallback. */
	normalized: boolean;
}

// Multi-session work isolation (the workspace's own worktree-mandatory
// convention) runs agents inside `<repo>/.claude/worktrees/<agent-id>/`. A
// cwd under that suffix belongs to the SAME repo/initiative as the main
// checkout — attributing it to a unit named after the worktree's agent-id
// would fragment one initiative's cost across N throwaway "projects" (one
// per dispatched agent). Collapse it back to the repo root before taking the
// last path segment.
const WORKTREE_MARKER = '/.claude/worktrees/';

function collapseWorktreePath(cwd: string): string {
	const idx = cwd.indexOf(WORKTREE_MARKER);
	return idx === -1 ? cwd : cwd.slice(0, idx);
}

export function normalizeProjectPath(
	claudeProjectDirName: string,
	sampleCwd?: string | null
): NormalizedProject {
	if (sampleCwd && sampleCwd.startsWith('/')) {
		const collapsed = collapseWorktreePath(sampleCwd);
		const segments = collapsed.split('/').filter(Boolean);
		const repoName = segments.length > 0 ? segments[segments.length - 1] : collapsed;
		return { projectPath: collapsed, repoName, normalized: true };
	}

	const raw = claudeProjectDirName.replace(/^-/, '');
	return { projectPath: raw, repoName: raw, normalized: false };
}
