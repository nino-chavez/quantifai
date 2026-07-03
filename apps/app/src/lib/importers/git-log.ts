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
}

const RECORD_SEP = '\x1e'; // ASCII record separator — commit messages routinely contain '|' and newlines
const FIELD_SEP = '\x1f'; // ASCII unit separator

/** The `git log` format string this parser expects. Pass to `git log --pretty=format:...`. */
export const GIT_LOG_FORMAT = `%H${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`;

export function parseGitLog(output: string): GitCommit[] {
	return output
		.split(RECORD_SEP)
		.map((rec) => rec.trim())
		.filter(Boolean)
		.map((rec) => {
			const [sha, authoredAt, ...rest] = rec.split(FIELD_SEP);
			return { sha, authoredAt, message: rest.join(FIELD_SEP) };
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
 */
export function findSessionForCommit(
	commit: GitCommit,
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
