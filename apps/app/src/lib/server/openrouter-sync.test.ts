import { describe, it, expect, afterEach, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createFakeD1 } from './test-support/fake-d1';
import { runProviderSync } from './sync-providers';
import { providerCostTotalSince } from './provider-costs';
import { openrouterProvider, OPENROUTER_CREDITS_URL } from '$lib/providers/openrouter';

// The real OpenRouter adapter and sync, with OpenRouter's two endpoints
// stubbed. Invented account: $10 spent before 2026-10-02, then $1 a day.
// `/activity` only ever shows the last 30 completed days, so days age out of
// it between syncs while their stored daily rows stay (quantifai#11).

function addDays(isoDate: string, days: number): string {
	const d = new Date(`${isoDate}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

async function syncOn(db: D1Database, syncDay: string): Promise<void> {
	const windowStart = addDays(syncDay, -30);
	const lifetime = 10 + (Date.parse(syncDay) - Date.parse('2026-10-02')) / 86_400_000;
	const activity = Array.from({ length: 30 }, (_, i) => ({
		date: `${addDays(windowStart, i)} 00:00:00`,
		usage: 1,
		byok_usage_inference: 0
	}));
	vi.stubGlobal('fetch', async (url: string) => {
		const body =
			String(url) === OPENROUTER_CREDITS_URL
				? { data: { total_credits: 100, total_usage: lifetime } }
				: { data: activity };
		return new Response(JSON.stringify(body), { status: 200 });
	});
	const [summary] = await runProviderSync(
		db,
		{ OPENROUTER_API_KEY: 'test-not-a-real-key' },
		new Date(`${syncDay}T06:00:00Z`),
		[openrouterProvider]
	);
	expect(summary.status).toBe('ok');
}

async function storedOpenRouterTotal(db: D1Database): Promise<number> {
	const row = await db
		.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS total FROM provider_costs WHERE provider = 'openrouter'`)
		.first<{ total: number }>();
	return row?.total ?? 0;
}

describe('OpenRouter sync across activity windows (quantifai#11)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps the stored total equal to lifetime usage as days age out of the window', async () => {
		const db = createFakeD1();

		await syncOn(db, '2026-11-01'); // lifetime $40: $10 earlier + 30 days
		expect(await storedOpenRouterTotal(db)).toBeCloseTo(40, 6);

		await syncOn(db, '2026-11-02'); // one day aged out; lifetime $41
		expect(await storedOpenRouterTotal(db)).toBeCloseTo(41, 6);

		await syncOn(db, '2026-11-12'); // ten more aged out; lifetime $51
		expect(await storedOpenRouterTotal(db)).toBeCloseTo(51, 6);
	});

	it('keeps aged-out days as their own daily rows, so the 90-day view still sees them', async () => {
		const db = createFakeD1();
		await syncOn(db, '2026-11-01');
		await syncOn(db, '2026-11-12');

		// Daily rows run 2026-10-02 .. 2026-11-11: 41 days at $1. The $10
		// remainder is dated 2025-01-01 and stays out of both windows.
		expect(await providerCostTotalSince(db, '2026-08-14T06:00:00.000Z')).toBeCloseTo(41, 6);
		expect(await providerCostTotalSince(db, '2026-10-13T06:00:00.000Z')).toBeCloseTo(30, 6);
	});
});
