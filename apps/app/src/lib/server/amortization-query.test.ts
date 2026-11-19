import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createFakeD1 } from './test-support/fake-d1';
import { computeAmortizationRollup, type SubscriptionPlan } from './amortization-query';
import { resolveWindow } from '../practice-numbers-shared';

const PLAN_200: SubscriptionPlan[] = [
	{ provider: 'anthropic', monthlyFeeUsd: 200, activeFrom: '2026-01-01', activeTo: null }
];

// One statement per row: the fake D1's bind() returns `this`, so a batch of
// binds on one prepared statement would collapse to its last row.
async function seedUnit(db: D1Database, id: string): Promise<void> {
	await db
		.prepare(`INSERT INTO units_of_work (id, kind, name, source, project_path) VALUES (?1, 'project', ?1, 'path', ?1)`)
		.bind(id)
		.run();
}

async function seedSession(db: D1Database, id: string, unitId: string, startedAt: string, tokens: number): Promise<void> {
	await db
		.prepare(
			`INSERT INTO sessions (id, session_id, unit_id, provider, input_tokens, output_tokens, started_at, source)
			 VALUES (?1, ?1, ?2, 'anthropic', ?3, 0, ?4, 'interactive')`
		)
		.bind(id, unitId, tokens, startedAt)
		.run();
}

describe('computeAmortizationRollup — windowed views share a month by the whole month (quantifai#10)', () => {
	// 30-day window as practice numbers resolves it on 2026-11-18: from 2026-10-19.
	const window = resolveWindow('30', new Date('2026-11-18T00:00:00.000Z'));

	it('gives a unit only its usage share of a month the window covers in part', async () => {
		const db = createFakeD1();
		await seedUnit(db, 'a');
		await seedUnit(db, 'b');
		// A and B used October equally; A before the window starts, B inside it.
		await seedSession(db, 'a-oct', 'a', '2026-10-05T12:00:00.000Z', 1000);
		await seedSession(db, 'b-oct', 'b', '2026-10-25T12:00:00.000Z', 1000);

		const allTime = await computeAmortizationRollup(db, PLAN_200, null);
		expect(allTime.perUnit.get('a')?.amortizedCostUsd).toBeCloseTo(100, 6);
		expect(allTime.perUnit.get('b')?.amortizedCostUsd).toBeCloseTo(100, 6);

		const windowed = await computeAmortizationRollup(db, PLAN_200, window.sinceIso);
		// B's in-window October sessions carry B's share of October ($100), not
		// all of October's fee ($200).
		expect(windowed.perUnit.get('b')?.amortizedCostUsd).toBeCloseTo(100, 6);
		expect(windowed.perUnit.has('a')).toBe(false);
		expect(windowed.totals.amortizedCostUsd).toBeCloseTo(100, 6);
		expect(windowed.totals.totalInteractiveSessions).toBe(1);
		expect(windowed.totals.coveredSessions).toBe(1);
	});

	it('counts only the in-window sessions of a unit active on both sides of the window start', async () => {
		const db = createFakeD1();
		await seedUnit(db, 'c');
		await seedUnit(db, 'd');
		await seedUnit(db, 'e');
		// October: 4,000 tokens in all. C has 1,000 before and 1,000 inside the window.
		await seedSession(db, 'c-before', 'c', '2026-10-10T00:00:00.000Z', 1000);
		await seedSession(db, 'c-inside', 'c', '2026-10-20T00:00:00.000Z', 1000);
		await seedSession(db, 'd-inside', 'd', '2026-10-25T00:00:00.000Z', 2000);
		// November is the current month and lies wholly inside the window.
		await seedSession(db, 'e-nov', 'e', '2026-11-05T00:00:00.000Z', 500);
		// September lies wholly before the window and must not appear at all.
		await seedSession(db, 'c-sep', 'c', '2026-09-15T00:00:00.000Z', 9000);

		const windowed = await computeAmortizationRollup(db, PLAN_200, window.sinceIso);

		const c = windowed.perUnit.get('c');
		expect(c?.amortizedCostUsd).toBeCloseTo(50, 6); // 1000 / 4000 of $200
		expect(c?.totalInteractiveSessions).toBe(1);
		expect(c?.coveredSessions).toBe(1);
		expect(windowed.perUnit.get('d')?.amortizedCostUsd).toBeCloseTo(100, 6); // 2000 / 4000
		expect(windowed.perUnit.get('e')?.amortizedCostUsd).toBeCloseTo(200, 6); // all of November so far
		// October's in-window share ($150) plus November ($200): never two whole
		// October fees, and never October's out-of-window share.
		expect(windowed.totals.amortizedCostUsd).toBeCloseTo(350, 6);
		expect(windowed.totals.totalInteractiveSessions).toBe(3);
	});
});
