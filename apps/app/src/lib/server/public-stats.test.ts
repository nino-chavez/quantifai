import { describe, it, expect } from 'vitest';
import { createFakeD1 } from './test-support/fake-d1';
import { getPublicStats } from './public-stats';

describe('getPublicStats', () => {
	it('returns all-zero, lastUpdated: null on a fresh instance — never throws on empty tables', async () => {
		const db = createFakeD1();
		const stats = await getPublicStats(db);

		expect(stats).toEqual({
			estimatedValueUsd: 0,
			actualSpendUsd: 0,
			sessionCount: 0,
			unitCount: 0,
			deterministicCommitCount: 0,
			lastUpdated: null
		});
	});

	it('aggregates sessions, units, deterministic commits, and last-updated across tables without leaking names', async () => {
		const db = createFakeD1();

		await db
			.prepare(
				`INSERT INTO units_of_work (id, kind, name, source, project_path) VALUES (?1, 'project', 'secret-client-project', 'path', '/a')`
			)
			.bind('u1')
			.run();
		await db
			.prepare(
				`INSERT INTO sessions (id, session_id, unit_id, total_cost, cost_provenance, started_at, ended_at, source)
				 VALUES (?1, ?2, ?3, ?4, 'estimated', ?5, ?6, 'interactive')`
			)
			.bind('s1', 'sess-1', 'u1', 12.5, '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z')
			.run();
		await db
			.prepare(
				`INSERT INTO git_events (id, repo, commit_sha, authored_at, unit_id, link_method, is_merge)
				 VALUES (?1, 'repo', 'sha1', ?2, ?3, 'git_notes', 0)`
			)
			.bind('g1', '2026-07-02T00:00:00.000Z', 'u1')
			.run();
		await db
			.prepare(
				`INSERT INTO git_events (id, repo, commit_sha, authored_at, unit_id, link_method, is_merge)
				 VALUES (?1, 'repo', 'sha2', ?2, ?3, 'time_window', 0)`
			)
			.bind('g2', '2026-07-03T00:00:00.000Z', 'u1')
			.run();
		await db
			.prepare(
				`INSERT INTO provider_costs (id, provider, date, amount_usd) VALUES (?1, 'anthropic', '2026-07-04', 4.25)`
			)
			.bind('p1')
			.run();

		const stats = await getPublicStats(db);

		expect(stats.sessionCount).toBe(1);
		expect(stats.unitCount).toBe(1);
		expect(stats.estimatedValueUsd).toBeCloseTo(12.5, 6);
		// No subscription plan seeded -> amortized portion is 0; actual spend is
		// the api_metered provider total only.
		expect(stats.actualSpendUsd).toBeCloseTo(4.25, 6);
		// Only the git_notes-linked commit counts as deterministic (1 of 2 total).
		expect(stats.deterministicCommitCount).toBe(1);
		// Latest of ended_at/provider date/authored_at — the provider_costs row's date.
		expect(stats.lastUpdated).toBe('2026-07-04');

		// Names never appear anywhere in the returned shape (client-adjacent privacy).
		expect(JSON.stringify(stats)).not.toContain('secret-client-project');
	});
});
