import { describe, it, expect } from 'vitest';
import {
	normalizeProjectPath,
	repoKey,
	isWorktreePath,
	pickUnitForRepo,
	canonicalRepo,
	repoNames
} from './project-path';

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

// Path spellings below are real `sessions.project_path` values from
// production (2026-10-06), trimmed to the shapes that matter.
describe('normalizeProjectPath — workspace and Codex worktrees', () => {
	it('collapses a <repo>/.worktrees/<branch> cwd to the repo root', () => {
		const result = normalizeProjectPath('-x', '/Users/nino/Workspace/dev/apps/minder/.worktrees/s7-marquee');
		expect(result.projectPath).toBe('/Users/nino/Workspace/dev/apps/minder');
		expect(result.repoName).toBe('minder');
	});

	it('collapses a branch name containing slashes and a subdirectory after it', () => {
		expect(
			normalizeProjectPath('-x', '/Users/nino/Workspace/dev/apps/letspepper/.worktrees/feat/gallery-announce').projectPath
		).toBe('/Users/nino/Workspace/dev/apps/letspepper');
		expect(
			normalizeProjectPath('-x', '/Users/nino/Workspace/dev/apps/minder/.worktrees/port-jump-points/ios/Minder').projectPath
		).toBe('/Users/nino/Workspace/dev/apps/minder');
	});

	it('keeps a Codex worktree as its own path but names it after the repo, dropping any subdirectory', () => {
		const result = normalizeProjectPath('-x', '/Users/nino/.codex/worktrees/672f/630-marketing-automation/site');
		expect(result.projectPath).toBe('/Users/nino/.codex/worktrees/672f/630-marketing-automation');
		expect(result.repoName).toBe('630-marketing-automation');
	});
});

describe('repoKey — nested worktrees', () => {
	it('cuts at the earliest marker when an agent worktree sits inside a workspace worktree', () => {
		const nested = '/dev/apps/quantifai/quantifai/.worktrees/fix/git-event-linking/.claude/worktrees/agent-abc';
		expect(repoKey(nested)).toBe('quantifai');
		expect(normalizeProjectPath('-x', nested).projectPath).toBe('/dev/apps/quantifai/quantifai');
	});
});

describe('repoKey', () => {
	it('gives every stored spelling of one repo the same key', () => {
		const spellings = [
			'/Users/nino/Workspace/dev/wip/atelier', // pre-reorg location
			'/Users/nino/Workspace/dev/labs/atelier', // current location
			'/Users/nino.chavez/Workspace/dev/wip/atelier', // the other Mac
			'/Users/nino/Workspace/dev/labs/atelier/.worktrees/feat/x', // workspace worktree
			'/Users/nino/Workspace/dev/labs/atelier/.claude/worktrees/agent-1', // agent worktree
			'/Users/nino/.codex/worktrees/002b/atelier' // Codex worktree
		];
		expect(new Set(spellings.map(repoKey))).toEqual(new Set(['atelier']));
	});

	it('does not merge a repo with a different repo whose name merely contains it', () => {
		expect(repoKey('/Users/nino/Workspace/dev/apps/photography-vnext-p1')).not.toBe(
			repoKey('/Users/nino/Workspace/dev/apps/photography')
		);
	});
});

describe('isWorktreePath', () => {
	it('flags all three worktree spellings and not a main checkout', () => {
		expect(isWorktreePath('/r/blog/.worktrees/caption-edits-0803')).toBe(true);
		expect(isWorktreePath('/r/blog/.claude/worktrees/agent-1')).toBe(true);
		expect(isWorktreePath('/Users/nino/.codex/worktrees/672f/blog')).toBe(true);
		expect(isWorktreePath('/r/blog')).toBe(false);
	});
});

describe('pickUnitForRepo', () => {
	const unit = (id: string, project_path: string) => ({ id, project_path });

	it('prefers an exact path match', () => {
		expect(
			pickUnitForRepo('/dev/sites/nino/blog', [unit('old', '/dev/apps/blog'), unit('exact', '/dev/sites/nino/blog')])
		).toBe('exact');
	});

	it('finds the unit recorded under the repo’s pre-move path', () => {
		expect(pickUnitForRepo('/dev/labs/atelier', [unit('u-atelier', '/dev/wip/atelier')])).toBe('u-atelier');
	});

	it('prefers the main checkout over its own worktree units', () => {
		const candidates = [
			unit('wt', '/dev/sites/nino/nino-chavez-site/.worktrees/codex/ship-a'),
			unit('main', '/dev/sites/nino/nino-chavez-site')
		];
		expect(pickUnitForRepo('/dev/work/nino-chavez-site', candidates)).toBe('main');
	});

	it('uses a worktree unit when the repo has only worktree units under one root', () => {
		expect(
			pickUnitForRepo('/dev/sites/nino/nino-chavez-site', [unit('wt', '/dev/x/nino-chavez-site/.worktrees/fix-a')])
		).toBe('wt');
	});

	it('treats the other Mac’s copy of a checkout as the same checkout and prefers this machine’s unit', () => {
		const bothMacs = [
			unit('other-mac', '/Users/nino.chavez/Workspace/dev/wip/mrr-automation'),
			unit('this-mac', '/Users/nino/Workspace/dev/wip/mrr-automation')
		];
		// The repo moved to work/ after both units were recorded under wip/.
		expect(pickUnitForRepo('/Users/nino/Workspace/dev/work/mrr-automation', bothMacs)).toBe('this-mac');
		expect(pickUnitForRepo('/Users/nino.chavez/Workspace/dev/work/mrr-automation', bothMacs)).toBe('other-mac');
	});

	it('refuses to choose between two checkout roots — a moved repo or an unrelated same-name repo', () => {
		const candidates = [unit('apps', '/dev/apps/blog'), unit('sites', '/dev/sites/nino/blog')];
		expect(pickUnitForRepo('/dev/work/blog', candidates)).toBeNull();
	});

	it('returns null when no candidate shares the repo key (instr over-matches are filtered out)', () => {
		expect(pickUnitForRepo('/dev/apps/photography', [unit('vnext', '/dev/apps/photography-vnext-p1')])).toBeNull();
	});
});

describe('repo aliases', () => {
	const aliases = new Map([
		['photography', 'nino-chavez-photography'],
		['website-nc', 'nino-chavez-site']
	]);

	it('maps an old name to the current one and leaves other names alone', () => {
		expect(canonicalRepo('photography', aliases)).toBe('nino-chavez-photography');
		expect(canonicalRepo('nino-chavez-photography', aliases)).toBe('nino-chavez-photography');
		expect(canonicalRepo('blog', aliases)).toBe('blog');
	});

	it('lists every name a repo was stored under, current name first', () => {
		expect(repoNames('nino-chavez-photography', aliases)).toEqual(['nino-chavez-photography', 'photography']);
		expect(repoNames('blog', aliases)).toEqual(['blog']);
	});

	it('lets the unit lookup find a unit recorded under the old folder name', () => {
		const units = [{ id: 'old', project_path: '/dev/apps/photography' }];
		expect(pickUnitForRepo('/dev/sites/nino/nino-chavez-photography', units)).toBeNull();
		expect(pickUnitForRepo('/dev/sites/nino/nino-chavez-photography', units, aliases)).toBe('old');
	});

	it('prefers the current-name unit when units exist under both names, instead of calling it ambiguous', () => {
		const units = [
			{ id: 'old', project_path: '/Users/nino/dev/apps/photography' },
			{ id: 'new', project_path: '/Users/nino/dev/sites/nino/nino-chavez-photography' }
		];
		// The other Mac's spelling and a worktree path: neither is an exact match.
		expect(pickUnitForRepo('/Users/nino.chavez/dev/sites/nino/nino-chavez-photography', units, aliases)).toBe('new');
		expect(pickUnitForRepo('/Users/nino/dev/sites/nino/nino-chavez-photography/.worktrees/x', units, aliases)).toBe('new');
	});
});
