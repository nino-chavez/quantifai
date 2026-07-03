/**
 * Pure parsing for `git log` output — the output-pairing signal's source.
 *
 * ADR-0004: "Exceeds Ink git-notes is the future mechanism; time-window join
 * is the honest v0 — label it as such in the UI." This module does the
 * parsing; the time-window join itself (matching a commit to the session(s)
 * active around its author-timestamp) lives alongside it below.
 */

export interface GitCommit {
	sha: string;
	authoredAt: string; // ISO 8601
	message: string;
	/** True when the commit has 2+ parents (a merge commit) — see `%P` below. Cheap to classify at import time; never sniffed from the message. */
	isMerge: boolean;
}

const RECORD_SEP = '\x1e'; // ASCII record separator — commit messages routinely contain '|' and newlines
const FIELD_SEP = '\x1f'; // ASCII unit separator

/**
 * The `git log` format string this parser expects. Pass to
 * `git log --pretty=format:...`. `%P` (space-separated parent hashes) is the
 * merge-commit signal: a commit with 2+ parents is a merge — classifying
 * from parent count is free at the `git log` call site and immune to
 * commit-message conventions ("Merge branch..." varies by workflow, and
 * squash-merges never say "merge" at all despite closing a branch).
 */
export const GIT_LOG_FORMAT = `%H${FIELD_SEP}%aI${FIELD_SEP}%P${FIELD_SEP}%s${RECORD_SEP}`;

export function parseGitLog(output: string): GitCommit[] {
	return output
		.split(RECORD_SEP)
		.map((rec) => rec.trim())
		.filter(Boolean)
		.map((rec) => {
			const [sha, authoredAt, parents, ...rest] = rec.split(FIELD_SEP);
			const parentCount = parents ? parents.trim().split(/\s+/).filter(Boolean).length : 0;
			return { sha, authoredAt, message: rest.join(FIELD_SEP), isMerge: parentCount > 1 };
		})
		.filter((c) => Boolean(c.sha) && Boolean(c.authoredAt));
}

export interface SessionWindow {
	sessionId: string;
	startedAt: string;
	endedAt: string;
}

/**
 * Finds the session whose [startedAt, endedAt] window contains the commit's
 * authored_at timestamp, widened by `paddingMs` on both ends (commits are
 * often authored a few minutes before/after the session message that
 * describes them, or right as a session is closing). Returns null when no
 * window matches — an un-attributed commit renders as such in the UI, never
 * silently guessed.
 *
 * Takes only the fields the time-window match actually needs (not the full
 * `GitCommit`, which also carries `isMerge` — irrelevant here) so callers
 * that resolve a commit's session before classifying merge status (or that
 * only have a partial commit record) aren't forced to fabricate a value.
 */
export function findSessionForCommit(
	commit: Pick<GitCommit, 'sha' | 'authoredAt' | 'message'>,
	sessions: SessionWindow[],
	paddingMs = 15 * 60 * 1000
): SessionWindow | null {
	const commitTime = new Date(commit.authoredAt).getTime();
	if (Number.isNaN(commitTime)) return null;

	let best: SessionWindow | null = null;
	let bestWidth = Infinity;

	for (const s of sessions) {
		const start = new Date(s.startedAt).getTime() - paddingMs;
		const end = new Date(s.endedAt).getTime() + paddingMs;
		if (Number.isNaN(start) || Number.isNaN(end)) continue;
		if (commitTime >= start && commitTime <= end) {
			const width = end - start;
			// Prefer the tightest-fitting window when multiple sessions overlap
			// (e.g. two short sessions padded into overlap) — the narrower
			// window is the more specific, more likely match.
			if (width < bestWidth) {
				best = s;
				bestWidth = width;
			}
		}
	}

	return best;
}
