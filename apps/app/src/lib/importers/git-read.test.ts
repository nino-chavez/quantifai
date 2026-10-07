import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGitLog, readGitNotesLog } from './git-read';
import { parseGitLog, GIT_LOG_FORMAT } from './git-log';
import { parseGitNotesLog, QUANTIFAI_NOTES_REF } from './git-notes';

// A real repo holding every ref family that tripped the importer on
// 2026-10-06: a quantifai notes ref, a stash, and a tool-owned ref, beside
// the history that should be read (branch, tag-only, remote-only commits).
// The user's global config and hooks are kept out: the quantifai
// post-commit hook would otherwise write notes into the fixture.
const ISOLATED_ENV = {
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_AUTHOR_NAME: 'Fixture',
	GIT_AUTHOR_EMAIL: 'fixture@example.com',
	GIT_COMMITTER_NAME: 'Fixture',
	GIT_COMMITTER_EMAIL: 'fixture@example.com',
	GIT_AUTHOR_DATE: '2026-10-06T12:00:00-05:00',
	GIT_COMMITTER_DATE: '2026-10-06T12:00:00-05:00'
};

let repo: string;
const savedEnv: Record<string, string | undefined> = {};
const sha: Record<string, string> = {};

function git(...args: string[]): string {
	return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
		cwd: repo,
		env: { ...process.env, ...ISOLATED_ENV },
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 10_000
	}).trim();
}

beforeAll(() => {
	// readGitLog/readGitNotesLog inherit process.env; keep them off the
	// user's global config too.
	for (const [k, v] of Object.entries(ISOLATED_ENV)) {
		savedEnv[k] = process.env[k];
		process.env[k] = v;
	}

	repo = mkdtempSync(join(tmpdir(), 'quantifai-git-read-'));
	git('init', '-q', '-b', 'main');
	writeFileSync(join(repo, 'f.txt'), 'one\n');
	git('add', 'f.txt');
	git('commit', '-q', '-m', 'one');
	sha.one = git('rev-parse', 'HEAD');
	git('commit', '-q', '--allow-empty', '-m', 'two');
	sha.two = git('rev-parse', 'HEAD');

	// Real history off the current branch: reachable only from a tag, and
	// only from a remote-tracking branch.
	sha.tagOnly = git('commit-tree', `${sha.two}^{tree}`, '-p', sha.two, '-m', 'tagged release');
	git('tag', 'v1', sha.tagOnly);
	sha.remoteOnly = git('commit-tree', `${sha.two}^{tree}`, '-p', sha.two, '-m', 'pushed from elsewhere');
	git('update-ref', 'refs/remotes/origin/feature', sha.remoteOnly);

	// What must not be read: the note's own commit, both stash commits,
	// and a commit held only by a tool-owned ref.
	git('notes', `--ref=${QUANTIFAI_NOTES_REF}`, 'add', '-m', '{"session_id":"sess-1","source":"env","ts":1}', sha.two);
	sha.notesCommit = git('rev-parse', QUANTIFAI_NOTES_REF);
	writeFileSync(join(repo, 'f.txt'), 'dirty\n');
	git('stash', 'push', '-q', '-m', 'wip');
	sha.stash = git('rev-parse', 'refs/stash');
	sha.stashIndex = git('rev-parse', 'refs/stash^2');
	sha.toolSnapshot = git('commit-tree', `${sha.two}^{tree}`, '-p', sha.two, '-m', 'Codex worktree snapshot: archive-cleanup');
	git('update-ref', 'refs/codex/snapshots/fixture', sha.toolSnapshot);
});

afterAll(() => {
	if (repo) rmSync(repo, { recursive: true, force: true });
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe('readGitLog', () => {
	it('the fixture reproduces the bug: `git log --all` walks the notes ref, stash and tool refs', () => {
		const all = new Set(parseGitLog(git('log', '--all', `--pretty=format:${GIT_LOG_FORMAT}`)).map((c) => c.sha));
		expect(all.has(sha.notesCommit)).toBe(true);
		expect(all.has(sha.stash)).toBe(true);
		expect(all.has(sha.toolSnapshot)).toBe(true);
	});

	it('never returns a notes-ref commit', () => {
		const commits = parseGitLog(readGitLog(repo));
		expect(commits.map((c) => c.sha)).not.toContain(sha.notesCommit);
		expect(commits.some((c) => c.message.startsWith('Notes added by'))).toBe(false);
	});

	it('returns exactly the branch, tag and remote-tracking history', () => {
		const shas = parseGitLog(readGitLog(repo)).map((c) => c.sha);
		expect(new Set(shas)).toEqual(new Set([sha.one, sha.two, sha.tagOnly, sha.remoteOnly]));
		expect(shas).toHaveLength(4);
		for (const excluded of [sha.notesCommit, sha.stash, sha.stashIndex, sha.toolSnapshot]) {
			expect(shas).not.toContain(excluded);
		}
	});
});

describe('readGitNotesLog', () => {
	it('still resolves the note attached to a real commit', () => {
		const notes = parseGitNotesLog(readGitNotesLog(repo));
		expect(notes.get(sha.two)?.sessionId).toBe('sess-1');
		expect(notes.has(sha.notesCommit)).toBe(false);
	});
});
