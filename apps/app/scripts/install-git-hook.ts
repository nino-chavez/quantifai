#!/usr/bin/env -S npx tsx
/**
 * Installer for the quantifai-post-commit git hook — see
 * ../hooks/quantifai-post-commit for the attribution mechanism itself.
 *
 * Usage: npm run hooks:install -- <repo-path> [<repo-path> ...]
 *
 * Installs into the repo's COMMON git dir (`git rev-parse
 * --git-common-dir`), not `.git/hooks` literally — for a linked worktree
 * those differ, and git resolves hooks from the common dir by default (a
 * hook installed there fires from the main checkout AND every linked
 * worktree, present and future, with no per-worktree install step). Verified
 * empirically 2026-07-03 against a vanilla git config with no
 * `core.hooksPath` override.
 *
 * Never overwrites a foreign `post-commit` hook. This installer writes its
 * own logic to a distinctly-named `quantifai-post-commit` file alongside
 * whatever's already in the hooks dir, then ensures the repo's real
 * `post-commit` entrypoint chains to it — creating a thin shim if no
 * `post-commit` exists yet, or appending one idempotent, marker-guarded
 * chain line to an existing one (your existing hook still runs first;
 * ours runs after, and never blocks the commit either way).
 *
 * Known caveat on a machine with a GLOBAL `core.hooksPath` override
 * (`git config --global core.hooksPath <dir>`, e.g. via a dotfiles-managed
 * "run Claude Code review on every commit" hook): git then resolves hooks
 * from that global directory instead of any per-repo hooks/ dir, UNLESS the
 * global hook itself chains back to the repo-local one via
 * `git rev-parse --git-common-dir` (not `--git-dir` — the latter resolves to
 * a worktree-PRIVATE admin dir for a linked worktree, which has no hooks/ of
 * its own, so a chain built on it silently no-ops from every worktree).
 * Found + fixed on this operator's machine 2026-07-03
 * (~/.dotfiles/files/home/.config/git-hooks/post-commit); this installer has
 * no way to detect or fix a *different* machine's equivalent bug, so if the
 * hook installs cleanly but never fires, check `git config core.hooksPath`
 * first.
 *
 * Local-only limitation (v1, deliberate): git notes do NOT survive
 * `git clone`/`git push` unless pushed explicitly. To carry this repo's
 * attribution notes to another clone/machine:
 *   git push origin refs/notes/quantifai
 *   # on the other clone:
 *   git fetch origin refs/notes/quantifai:refs/notes/quantifai
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const HOOK_SOURCE = resolve(import.meta.dirname, '../hooks/quantifai-post-commit');
const CHAIN_MARKER_START = '# >>> quantifai-post-commit chain >>>';
const CHAIN_MARKER_END = '# <<< quantifai-post-commit chain <<<';

function gitCommonDir(repoPath: string): string {
	const out = execFileSync('git', ['-C', repoPath, 'rev-parse', '--git-common-dir'], {
		encoding: 'utf8'
	}).trim();
	return resolve(repoPath, out);
}

function chainSnippet(): string {
	return [CHAIN_MARKER_START, '"$(dirname "$0")/quantifai-post-commit" "$@" || true', CHAIN_MARKER_END, ''].join(
		'\n'
	);
}

function installOne(repoPath: string): void {
	const abs = resolve(repoPath);

	let commonDir: string;
	try {
		commonDir = gitCommonDir(abs);
	} catch {
		console.error(`Skip (not a git repo): ${abs}`);
		return;
	}

	const hooksDir = join(commonDir, 'hooks');
	mkdirSync(hooksDir, { recursive: true });

	// Always refresh our own script — this is the idempotent "update" path.
	const ourScriptDest = join(hooksDir, 'quantifai-post-commit');
	writeFileSync(ourScriptDest, readFileSync(HOOK_SOURCE, 'utf8'));
	chmodSync(ourScriptDest, 0o755);

	const entrypoint = join(hooksDir, 'post-commit');
	if (!existsSync(entrypoint)) {
		writeFileSync(entrypoint, `#!/bin/sh\n${chainSnippet()}`);
		chmodSync(entrypoint, 0o755);
		console.log(`${abs}\n  installed fresh post-commit hook -> ${entrypoint}`);
		return;
	}

	const existing = readFileSync(entrypoint, 'utf8');
	if (existing.includes(CHAIN_MARKER_START)) {
		console.log(`${abs}\n  already chained -> ${entrypoint} (quantifai-post-commit refreshed)`);
		return;
	}

	const updated = existing.replace(/\n?$/, '\n') + '\n' + chainSnippet();
	writeFileSync(entrypoint, updated);
	chmodSync(entrypoint, 0o755);
	console.log(`${abs}\n  chained onto existing hook -> ${entrypoint} (your existing hook still runs first)`);
}

function main() {
	const repos = process.argv.slice(2);
	if (repos.length === 0) {
		console.error('Usage: npm run hooks:install -- <repo-path> [<repo-path> ...]');
		process.exit(1);
	}

	for (const repo of repos) {
		installOne(repo);
	}

	console.log('');
	console.log('Notes are local-only until pushed: git push origin refs/notes/quantifai');
}

main();
