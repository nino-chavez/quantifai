/**
 * Migration 0007: the repo_aliases table, its seeded renames, and the
 * re-key of rows still stored under an old name. Runs the real migration SQL
 * against rows inserted before it (test-support/fake-d1.ts stopBefore).
 */

import { describe, it, expect } from 'vitest';
import { applyMigration, createFakeD1 } from './test-support/fake-d1';
import { loadRepoAliases } from './repo-aliases';

const MIGRATION = '0007_repo_aliases.sql';

async function insertEvent(db: ReturnType<typeof createFakeD1>, repo: string, sha: string) {
	await db
		.prepare(
			`INSERT INTO git_events (id, repo, commit_sha, authored_at) VALUES (?1, ?2, ?3, '2026-01-01T00:00:00.000Z')`
		)
		.bind(`${repo}:${sha}`, repo, sha)
		.run();
}

async function repos(db: ReturnType<typeof createFakeD1>) {
	const { results } = await db
		.prepare('SELECT repo, commit_sha FROM git_events ORDER BY repo, commit_sha')
		.all<{ repo: string; commit_sha: string }>();
	return results;
}

describe('migration 0007_repo_aliases', () => {
	it('seeds the three 2026-08-12 renames', async () => {
		const aliases = await loadRepoAliases(createFakeD1());
		expect(Object.fromEntries(aliases)).toEqual({
			photography: 'nino-chavez-photography',
			'website-nc': 'nino-chavez-site',
			'quantifai-next': 'quantifai'
		});
	});

	it('re-keys an old-name row to the current name when the commit has no row there yet', async () => {
		const db = createFakeD1({ stopBefore: MIGRATION });
		await insertEvent(db, 'photography', 'only-old');
		await insertEvent(db, 'blog', 'unrelated');
		applyMigration(db, MIGRATION);

		expect(await repos(db)).toEqual([
			{ repo: 'blog', commit_sha: 'unrelated' },
			{ repo: 'nino-chavez-photography', commit_sha: 'only-old' }
		]);
	});

	it('leaves a commit stored under both names alone rather than guessing how to fold it', async () => {
		const db = createFakeD1({ stopBefore: MIGRATION });
		await insertEvent(db, 'photography', 'both');
		await insertEvent(db, 'nino-chavez-photography', 'both');
		applyMigration(db, MIGRATION);

		expect(await repos(db)).toEqual([
			{ repo: 'nino-chavez-photography', commit_sha: 'both' },
			{ repo: 'photography', commit_sha: 'both' }
		]);
	});

	it('rejects an alias that names itself', async () => {
		const db = createFakeD1();
		await expect(
			db.prepare(`INSERT INTO repo_aliases (alias, canonical) VALUES ('x', 'x')`).run()
		).rejects.toThrow(/CHECK/);
	});
});
