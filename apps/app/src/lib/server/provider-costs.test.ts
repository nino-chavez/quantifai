/**
 * UNIQUE upsert idempotency (DESIGN.md testing baseline: every LESSONS-
 * LEARNED.md bug class gets a regression test at first touch — this is the
 * "NULL-in-UNIQUE" / atomic-upsert class applied to `provider_costs`).
 * Runs against a real SQLite engine (src/lib/server/test-support/fake-d1.ts)
 * executing the actual migration SQL, not a JS re-implementation of the
 * upsert semantics.
 */

import { describe, it, expect } from 'vitest';
import { createFakeD1 } from './test-support/fake-d1';
import { upsertProviderCost, upsertProviderCosts, providerCostTotals, providerCostGrandTotal } from './provider-costs';
import type { ProviderCostRow } from '$lib/providers/types';

function row(overrides: Partial<ProviderCostRow> = {}): ProviderCostRow {
	return {
		provider: 'anthropic',
		date: '2026-07-01',
		workspaceOrKey: 'org',
		amountUsd: 1.5,
		currency: 'USD',
		raw: { note: 'fixture' },
		...overrides
	};
}

describe('upsertProviderCost — UNIQUE(provider, date, workspace_or_key) idempotency', () => {
	it('re-running the same (provider, date, workspace) upsert replaces the amount rather than accumulating it', async () => {
		const db = createFakeD1();
		await upsertProviderCost(db, row({ amountUsd: 1.5 }));
		await upsertProviderCost(db, row({ amountUsd: 2.75 })); // a resync with a revised provider total

		const { results } = await db.prepare('SELECT amount_usd FROM provider_costs').all<{ amount_usd: number }>();
		expect(results).toHaveLength(1); // exactly one row — not two, not an accumulated 4.25
		expect(results[0].amount_usd).toBeCloseTo(2.75, 6);
	});

	it('two different workspace_or_key values for the same (provider, date) do not collide', async () => {
		const db = createFakeD1();
		await upsertProviderCost(db, row({ workspaceOrKey: 'w1', amountUsd: 1 }));
		await upsertProviderCost(db, row({ workspaceOrKey: 'w2', amountUsd: 2 }));

		const total = await providerCostGrandTotal(db);
		expect(total).toBeCloseTo(3, 6);
	});

	it('running an identical batch upsert twice (the real sync-retry scenario) is idempotent', async () => {
		const db = createFakeD1();
		const batch: ProviderCostRow[] = [
			row({ date: '2026-07-01', amountUsd: 1 }),
			row({ date: '2026-07-02', amountUsd: 2 })
		];

		await upsertProviderCosts(db, batch);
		await upsertProviderCosts(db, batch); // re-run, e.g. a retried cron

		const totals = await providerCostTotals(db);
		expect(totals).toHaveLength(1);
		expect(totals[0].total_amount_usd).toBeCloseTo(3, 6); // not 6 — no double count
		expect(totals[0].days_covered).toBe(2);
	});
});
