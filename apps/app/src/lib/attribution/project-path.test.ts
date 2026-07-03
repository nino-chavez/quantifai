import { describe, it, expect } from 'vitest';
import { normalizeProjectPath } from './project-path';

describe('normalizeProjectPath', () => {
	it('prefers a real cwd when available, extracting the last path segment as repo name', () => {
		const result = normalizeProjectPath(
			'-Users-nino-Workspace-dev-wip-quantifai-next',
			'/Users/nino/Workspace/dev/wip/quantifai-next'
		);
		expect(result.projectPath).toBe('/Users/nino/Workspace/dev/wip/quantifai-next');
		expect(result.repoName).toBe('quantifai-next');
		expect(result.normalized).toBe(true);
	});

	it('demonstrates why naive dash-decoding of the encoded dir name is unsafe: a repo name containing a dash', () => {
		// Real path segment "quantifai-next" contains a dash. A naive decode
		// (replace every '-' with '/') would misread the repo boundary as
		// "quantifai/next" — two segments instead of one. The cwd-based path
		// sidesteps this entirely.
		const naiveDecode = '-Users-nino-Workspace-dev-wip-quantifai-next'.replace(/-/g, '/');
		expect(naiveDecode).toBe('/Users/nino/Workspace/dev/wip/quantifai/next'); // wrong: splits the repo name
		const result = normalizeProjectPath(
			'-Users-nino-Workspace-dev-wip-quantifai-next',
			'/Users/nino/Workspace/dev/wip/quantifai-next'
		);
		expect(result.repoName).toBe('quantifai-next'); // correct: cwd carries the real boundary
	});

	it('falls back to the raw encoded directory name (undecoded) when no cwd is available', () => {
		const result = normalizeProjectPath('-Users-nino-Workspace-dev-wip-quantifai-next', null);
		expect(result.normalized).toBe(false);
		expect(result.projectPath).toBe('Users-nino-Workspace-dev-wip-quantifai-next');
		expect(result.repoName).toBe('Users-nino-Workspace-dev-wip-quantifai-next');
	});

	it('ignores a non-absolute or empty sampleCwd and uses the fallback', () => {
		const result = normalizeProjectPath('-some-dir', 'relative/path');
		expect(result.normalized).toBe(false);
	});

	it('collapses a .claude/worktrees/<agent-id> cwd back to the owning repo, not the agent-id', () => {
		const result = normalizeProjectPath(
			'-Users-nino-Workspace-dev-wip-quantifai-next',
			'/Users/nino/Workspace/dev/wip/quantifai-next/.claude/worktrees/agent-a77504b022bdad251'
		);
		expect(result.projectPath).toBe('/Users/nino/Workspace/dev/wip/quantifai-next');
		expect(result.repoName).toBe('quantifai-next');
		expect(result.normalized).toBe(true);
	});

	it('collapses a worktree cwd even when a subdirectory follows it (e.g. apps/app inside the worktree)', () => {
		const result = normalizeProjectPath(
			'-x',
			'/Users/nino/Workspace/dev/wip/quantifai-next/.claude/worktrees/agent-xyz/apps/app'
		);
		expect(result.repoName).toBe('quantifai-next');
	});

	it('handles a root-level cwd without throwing', () => {
		const result = normalizeProjectPath('-', '/');
		expect(result.normalized).toBe(true);
		expect(result.repoName).toBe('/');
	});
});
