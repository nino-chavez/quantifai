/**
 * Integration tests for the session-id resolution ladder in
 * ../../../hooks/quantifai-post-commit. Exercises the REAL hook script
 * against a real scratch git repo (via a temp dir + subprocess `git`), not a
 * JS re-implementation of its logic — the hook is POSIX `sh` on purpose (it
 * must run in any repo this gets installed into, with zero dependency on
 * this app's own node_modules/toolchain), so the only faithful way to test
 * its behavior is to actually run it.
 *
 * Ladder rungs covered: env present, heartbeat match, branch mismatch
 * (excluded), stale heartbeat ts (excluded), malformed heartbeat lock file
 * (tolerated, skipped), nothing resolved, and the rebase/cherry-pick guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOK_SOURCE = resolve(import.meta.dirname, '../../../hooks/quantifai-post-commit');

// This test file itself runs inside a live Claude Code session, which DOES
// export CLAUDE_CODE_SESSION_ID (see hooks/quantifai-post-commit's header
// comment) — so every commit blanks both env-ladder vars by default, unless a
// test explicitly overrides one to exercise rung (a) on purpose. Without
// this, every "heartbeat"/"nothing resolved" test below would silently pick
// up this session's own real env var and resolve via rung (a) instead.
const BLANK_ENV_RUNG = { CLAUDE_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '' };

let repoDir: string;
/** `git rev-parse --show-toplevel` resolves symlinks (macOS's $TMPDIR is one, /var/folders -> /private/var/folders) — the hook compares against THIS resolved path, so heartbeat fixtures must use it too, not the raw mkdtempSync path. */
let resolvedRepoDir: string;

function git(args: string[], env: NodeJS.ProcessEnv = {}): string {
	return execFileSync('git', args, {
		cwd: repoDir,
		encoding: 'utf8',
		env: { ...process.env, ...env }
	});
}

function noteForHead(): string | null {
	try {
		return git(['notes', '--ref=quantifai', 'show', 'HEAD']).trim();
	} catch {
		return null; // `git notes show` exits non-zero when no note exists
	}
}

function commit(message: string, env: NodeJS.ProcessEnv = {}): void {
	writeFileSync(join(repoDir, `${message.replace(/\s+/g, '-')}.txt`), message);
	git(['add', '-A']);
	git(['commit', '-q', '-m', message], { ...BLANK_ENV_RUNG, ...env });
}

function writeHeartbeat(sessionId: string, overrides: Partial<{ cwd: string; branch: string; ts: number }> = {}) {
	const lockDir = join(repoDir, '.git', '.claude-sessions');
	mkdirSync(lockDir, { recursive: true });
	const payload = {
		session_id: sessionId,
		cwd: overrides.cwd ?? resolvedRepoDir,
		branch: overrides.branch ?? 'main',
		is_worktree: false,
		ts: overrides.ts ?? Math.floor(Date.now() / 1000)
	};
	writeFileSync(join(lockDir, `${sessionId}.json`), JSON.stringify(payload));
}

beforeEach(() => {
	repoDir = mkdtempSync(join(tmpdir(), 'quantifai-hook-test-'));
	git(['init', '-q', '-b', 'main']);
	git(['config', 'user.email', 't@t.com']);
	git(['config', 'user.name', 't']);
	resolvedRepoDir = git(['rev-parse', '--show-toplevel']).trim();

	const hookDest = join(repoDir, '.git', 'hooks', 'post-commit');
	writeFileSync(hookDest, readFileSync(HOOK_SOURCE, 'utf8'));
	chmodSync(hookDest, 0o755);
});

afterEach(() => {
	rmSync(repoDir, { recursive: true, force: true });
});

describe('quantifai-post-commit — rung (a): env', () => {
	it('writes a note from CLAUDE_SESSION_ID with source=env', () => {
		commit('c1', { CLAUDE_SESSION_ID: 'env-session-1' });
		const note = JSON.parse(noteForHead()!);
		expect(note).toMatchObject({ session_id: 'env-session-1', source: 'env' });
		expect(typeof note.ts).toBe('number');
	});

	it('falls back to CLAUDE_CODE_SESSION_ID (the var Claude Code actually exports) when CLAUDE_SESSION_ID is unset', () => {
		commit('c1', { CLAUDE_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: 'code-session-1' });
		const note = JSON.parse(noteForHead()!);
		expect(note).toMatchObject({ session_id: 'code-session-1', source: 'env' });
	});

	it('prefers CLAUDE_SESSION_ID over CLAUDE_CODE_SESSION_ID when both are set', () => {
		commit('c1', { CLAUDE_SESSION_ID: 'short-name', CLAUDE_CODE_SESSION_ID: 'long-name' });
		const note = JSON.parse(noteForHead()!);
		expect(note.session_id).toBe('short-name');
	});
});

describe('quantifai-post-commit — rung (b): heartbeat', () => {
	it('writes a note from a heartbeat lock matching cwd + branch, with source=heartbeat', () => {
		writeHeartbeat('heartbeat-session-1');
		commit('c1');
		const note = JSON.parse(noteForHead()!);
		expect(note).toMatchObject({ session_id: 'heartbeat-session-1', source: 'heartbeat' });
	});

	it('picks the freshest of multiple matching locks', () => {
		const now = Math.floor(Date.now() / 1000);
		writeHeartbeat('older-session', { ts: now - 100 });
		writeHeartbeat('newer-session', { ts: now - 1 });
		commit('c1');
		const note = JSON.parse(noteForHead()!);
		expect(note.session_id).toBe('newer-session');
	});

	it('excludes a lock whose branch does not match the current branch (branch mismatch -> no signal from that lock)', () => {
		writeHeartbeat('wrong-branch-session', { branch: 'some-other-branch' });
		commit('c1');
		expect(noteForHead()).toBeNull();
	});

	it('excludes a lock older than the 900s staleness window (stale ts -> no signal from that lock)', () => {
		writeHeartbeat('stale-session', { ts: Math.floor(Date.now() / 1000) - 1000 });
		commit('c1');
		expect(noteForHead()).toBeNull();
	});

	it('tolerates a malformed heartbeat lock file (skips it, does not crash the hook)', () => {
		const lockDir = join(repoDir, '.git', '.claude-sessions');
		mkdirSync(lockDir, { recursive: true });
		writeFileSync(join(lockDir, 'broken.json'), '{not valid json at all');
		// A second, well-formed lock alongside the broken one should still resolve.
		writeHeartbeat('good-session');
		commit('c1');
		const note = JSON.parse(noteForHead()!);
		expect(note.session_id).toBe('good-session');
	});

	it('an env var present takes priority over a matching heartbeat lock (rung (a) wins over rung (b))', () => {
		writeHeartbeat('heartbeat-session');
		commit('c1', { CLAUDE_SESSION_ID: 'env-session' });
		const note = JSON.parse(noteForHead()!);
		expect(note).toMatchObject({ session_id: 'env-session', source: 'env' });
	});
});

describe('quantifai-post-commit — rung (c): nothing resolved', () => {
	it('writes no note when neither env nor a heartbeat lock resolves', () => {
		commit('c1');
		expect(noteForHead()).toBeNull();
	});

	it('never blocks the commit itself even with no signal (fail-open)', () => {
		expect(() => commit('c1')).not.toThrow();
		const log = git(['log', '--oneline']);
		expect(log).toContain('c1');
	});
});

describe('quantifai-post-commit — inert during history rewrites', () => {
	it('does not write a note for a commit replayed by `git rebase` (rebase-merge marker present)', () => {
		commit('base');
		commit('feature-1', { CLAUDE_SESSION_ID: 'session-a' });
		git(['checkout', '-q', '-b', 'other', 'HEAD~1']);
		commit('feature-2-other');
		git(['checkout', '-q', 'main']);

		// Rebase 'other' onto main's tip -> replays feature-2-other as a NEW
		// commit while rebase-merge state exists; the hook should skip it.
		git(['checkout', '-q', 'other']);
		git(['rebase', '-q', 'main'], { CLAUDE_SESSION_ID: 'session-b' });

		expect(noteForHead()).toBeNull();
	});
});
