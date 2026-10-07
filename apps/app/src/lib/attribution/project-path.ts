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
// convention) runs agents inside a linked worktree of the repo. A cwd there
// belongs to the SAME repo/initiative as the main checkout — attributing it
// to a unit named after the worktree's branch or agent-id would fragment one
// initiative's cost across N throwaway "projects". Collapse it back to the
// repo root before taking the last path segment. Three spellings exist in
// stored sessions (measured against production 2026-10-06):
//   <repo>/.claude/worktrees/<agent-id>[/subdir]   Claude Code agent worktrees
//   <repo>/.worktrees/<branch>[/subdir]            the workspace convention since 2026-07;
//                                                  <branch> may itself contain slashes
//   ~/.codex/worktrees/<id>/<repo>[/subdir]        Codex worktrees, repo name after the id
const IN_REPO_WORKTREE_MARKERS = ['/.claude/worktrees/', '/.worktrees/'];
const CODEX_WORKTREE_RE = /^(.*\/\.codex\/worktrees\/[^/]+\/[^/]+)(?:\/.*)?$/;

/**
 * The checkout root a path belongs to. Cuts at the EARLIEST in-repo marker,
 * so an agent worktree nested inside a workspace worktree
 * (`<repo>/.worktrees/<branch>/.claude/worktrees/<agent>`) still resolves to
 * `<repo>`, not to `<branch>`. A Codex worktree is its own root.
 */
export function repoRoot(cwd: string): string {
	const cuts = IN_REPO_WORKTREE_MARKERS.map((marker) => cwd.indexOf(marker)).filter((idx) => idx !== -1);
	if (cuts.length > 0) return cwd.slice(0, Math.min(...cuts));
	const codex = CODEX_WORKTREE_RE.exec(cwd);
	return codex ? codex[1] : cwd;
}

const HOME_PREFIX_RE = /^\/(?:Users|home)\/[^/]+\//;

/**
 * One checkout's identity across machines: its root with the home directory
 * replaced by `~/`. The other Mac stores the same checkout under
 * `/Users/nino.chavez/...`; without this, a dry run against production
 * (2026-10-06) read mrr-automation's two copies as two repos and refused to
 * pick its unit.
 */
export function checkoutIdentity(path: string): string {
	return repoRoot(path).replace(HOME_PREFIX_RE, '~/');
}

function homeOf(path: string): string {
	return HOME_PREFIX_RE.exec(path)?.[0] ?? '';
}

/** True when `path` is inside a linked worktree rather than a main checkout. */
export function isWorktreePath(path: string): boolean {
	return repoRoot(path) !== path || CODEX_WORKTREE_RE.test(path);
}

/**
 * Repo identity for joining across path spellings: the worktree-collapsed
 * last path segment. Sessions for one repo are stored under every path it
 * has ever had — pre-reorg locations (`wip/atelier` vs `labs/atelier`), the
 * other Mac's home dir (`/Users/nino.chavez/...`), and the worktree forms
 * above — and an exact `project_path =` match only ever sees one of them.
 * This is the same value `git_events.repo` already stores, so a commit and
 * its sessions agree on one key.
 *
 * Known limits: a repo rename (photography -> nino-chavez-photography)
 * changes the key, and two unrelated repos with the same folder name share
 * one. Callers guard the collision: the session join tries the commit's own
 * checkout root before other spellings (git-log.ts findSessionForCommitInRepo),
 * and the unit lookup refuses to choose between two checkouts (pickUnitForRepo).
 */
export function repoKey(path: string): string {
	const collapsed = repoRoot(path);
	const segments = collapsed.split('/').filter(Boolean);
	return segments.length > 0 ? segments[segments.length - 1] : collapsed;
}

export function normalizeProjectPath(
	claudeProjectDirName: string,
	sampleCwd?: string | null
): NormalizedProject {
	if (sampleCwd && sampleCwd.startsWith('/')) {
		const collapsed = repoRoot(sampleCwd);
		return { projectPath: collapsed, repoName: repoKey(collapsed), normalized: true };
	}

	const raw = claudeProjectDirName.replace(/^-/, '');
	return { projectPath: raw, repoName: raw, normalized: false };
}

export interface UnitCandidate {
	id: string;
	project_path: string;
}

/**
 * Which unit a commit from `projectPath` belongs to, given every unit row
 * whose path might share its repo key. An exact path match wins. Otherwise
 * the same-key candidates must all be ONE checkout (checkoutIdentity: the
 * repo's main checkout and its worktrees, on either Mac). A main-checkout
 * unit beats a worktree unit, a unit on the commit's own machine beats the
 * other Mac's, and path order breaks what is left. Two or more checkouts — a
 * repo recorded in two workspace locations, or two unrelated repos with one
 * folder name — is ambiguous and returns null, which the upsert's
 * never-erase rule turns into "keep whatever unit the row already has".
 * Nothing here checks time, so guessing between checkouts could attach a
 * commit to an unrelated repo's unit. Returns null when no candidate shares
 * the key — git import never invents a unit for a repo with no sessions.
 * A unit recorded under a repo's old folder name (`aliases`) counts as the
 * same repo, but only when no unit exists under the current name.
 */
export function pickUnitForRepo(
	projectPath: string,
	candidates: UnitCandidate[],
	aliases: RepoAliases = NO_REPO_ALIASES
): string | null {
	const exact = candidates.find((c) => c.project_path === projectPath);
	if (exact) return exact.id;
	const key = canonicalRepo(repoKey(projectPath), aliases);
	// Units under the current name first; units under an old name only when
	// none exist. After a rename a repo usually has units under both folders,
	// which are two checkouts, so pooling them would always read as ambiguous.
	const current = candidates.filter((c) => repoKey(c.project_path) === key);
	const sameRepo =
		current.length > 0
			? current
			: candidates.filter((c) => canonicalRepo(repoKey(c.project_path), aliases) === key);
	if (new Set(sameRepo.map((c) => checkoutIdentity(c.project_path))).size !== 1) return null;
	const mains = sameRepo.filter((c) => !isWorktreePath(c.project_path));
	const home = homeOf(projectPath);
	return [...(mains.length > 0 ? mains : sameRepo)].sort(
		(a, b) =>
			Number(homeOf(a.project_path) !== home) - Number(homeOf(b.project_path) !== home) ||
			a.project_path.localeCompare(b.project_path)
	)[0].id;
}

/** Old repo name -> current name, from the `repo_aliases` table (migration 0007). */
export type RepoAliases = ReadonlyMap<string, string>;

export const NO_REPO_ALIASES: RepoAliases = new Map();

/** The current name for a repo name or repo key; unaliased names map to themselves. */
export function canonicalRepo(name: string, aliases: RepoAliases): string {
	return aliases.get(name) ?? name;
}

/** Every name a canonical repo has been stored under: itself first, then its aliases. */
export function repoNames(canonical: string, aliases: RepoAliases): string[] {
	return [canonical, ...[...aliases].filter(([, c]) => c === canonical).map(([alias]) => alias)];
}
