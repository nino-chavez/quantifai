import { describe, it, expect } from 'vitest';
import { parseGitLog, findSessionForCommit, GIT_LOG_FORMAT, type SessionWindow } from './git-log';

describe('GIT_LOG_FORMAT / parseGitLog', () => {
	it('parses a well-formed multi-commit log', () => {
		const output = [
			'abc123\x1f2026-07-03T10:00:00-05:00\x1ffeat: add ledger page',
			'def456\x1f2026-07-03T11:00:00-05:00\x1ffix: chunk at 500'
		].join('\x1e');
		const commits = parseGitLog(output);
		expect(commits).toHaveLength(2);
		expect(commits[0]).toEqual({
			sha: 'abc123',
			authoredAt: '2026-07-03T10:00:00-05:00',
			message: 'feat: add ledger page'
		});
	});

	it('preserves pipe characters and colons in the commit message (record/field separators avoid them)', () => {
		const output = 'abc\x1f2026-07-03T10:00:00Z\x1ffix: a|b ratio, see 10:30am note\x1e';
		const commits = parseGitLog(output);
		expect(commits[0].message).toBe('fix: a|b ratio, see 10:30am note');
	});

	it('returns [] for empty output', () => {
		expect(parseGitLog('')).toEqual([]);
	});

	it('skips a record missing sha or timestamp', () => {
		const output = '\x1f\x1fbroken\x1e' + 'abc\x1f2026-07-03T10:00:00Z\x1fgood\x1e';
		const commits = parseGitLog(output);
		expect(commits).toHaveLength(1);
		expect(commits[0].message).toBe('good');
	});

	it('exports a format string using the record/unit separators, not pipes', () => {
		expect(GIT_LOG_FORMAT).toContain('%H');
		expect(GIT_LOG_FORMAT).toContain('%aI');
		expect(GIT_LOG_FORMAT).toContain('%s');
		expect(GIT_LOG_FORMAT).not.toContain('|');
	});
});

describe('findSessionForCommit', () => {
	const sessions: SessionWindow[] = [
		{ sessionId: 's1', startedAt: '2026-07-03T10:00:00Z', endedAt: '2026-07-03T10:30:00Z' },
		{ sessionId: 's2', startedAt: '2026-07-03T14:00:00Z', endedAt: '2026-07-03T14:10:00Z' }
	];

	it('matches a commit authored inside a session window', () => {
		const match = findSessionForCommit(
			{ sha: 'x', authoredAt: '2026-07-03T10:15:00Z', message: 'm' },
			sessions
		);
		expect(match?.sessionId).toBe('s1');
	});

	it('matches within the padding window just outside the strict boundary', () => {
		const match = findSessionForCommit(
			{ sha: 'x', authoredAt: '2026-07-03T10:35:00Z', message: 'm' }, // 5 min after end
			sessions,
			15 * 60 * 1000
		);
		expect(match?.sessionId).toBe('s1');
	});

	it('returns null when no session window is anywhere near the commit', () => {
		const match = findSessionForCommit(
			{ sha: 'x', authoredAt: '2026-07-04T00:00:00Z', message: 'm' },
			sessions
		);
		expect(match).toBeNull();
	});

	it('returns null for an unparseable authoredAt rather than throwing', () => {
		const match = findSessionForCommit({ sha: 'x', authoredAt: 'not-a-date', message: 'm' }, sessions);
		expect(match).toBeNull();
	});

	it('prefers the narrower (more specific) session window when two overlap', () => {
		const overlapping: SessionWindow[] = [
			{ sessionId: 'wide', startedAt: '2026-07-03T09:00:00Z', endedAt: '2026-07-03T12:00:00Z' },
			{ sessionId: 'narrow', startedAt: '2026-07-03T10:10:00Z', endedAt: '2026-07-03T10:20:00Z' }
		];
		const match = findSessionForCommit(
			{ sha: 'x', authoredAt: '2026-07-03T10:15:00Z', message: 'm' },
			overlapping,
			0
		);
		expect(match?.sessionId).toBe('narrow');
	});
});
