/**
 * Sync orchestrator tests: per-provider error isolation (LESSONS-LEARNED.md
 * checklist item — one bad connection never fails the run) and
 * disabled-provider state (DESIGN.md rule 7 — absent secret renders "not
 * connected," never an error). Uses fake `CostProvider`s injected via
 * `runProviderSync`'s optional `providers` parameter, rather than the real
 * Anthropic/OpenAI/OpenRouter adapters — the orchestrator's contract is with
 * the `CostProvider` interface, not any one adapter's HTTP shape (that's
 * covered separately in src/lib/providers/*.test.ts).
 */

import { describe, it, expect, vi } from 'vitest';
import { createFakeD1 } from './test-support/fake-d1';
import { runProviderSync, FULL_BACKFILL_START_ISO } from './sync-providers';
import { getSyncState } from './provider-sync-state';
import type { CostProvider, ProviderCostRow } from '$lib/providers/types';

function fakeProvider(overrides: Partial<CostProvider> & { name: string }): CostProvider {
	return {
		isConnected: () => true,
		fetchWindow: async () => [],
		...overrides
	};
}

describe('runProviderSync — per-provider error isolation', () => {
	it('one provider throwing never stops the others from syncing', async () => {
		const db = createFakeD1();
		const goodRows: ProviderCostRow[] = [
			{ provider: 'good', date: '2026-07-01', workspaceOrKey: 'org', amountUsd: 5, currency: 'USD', raw: {} }
		];
		const providers: CostProvider[] = [
			fakeProvider({
				name: 'bad',
				fetchWindow: async () => {
					throw new Error('simulated transport failure');
				}
			}),
			fakeProvider({ name: 'good', fetchWindow: async () => goodRows })
		];

		const summaries = await runProviderSync(db, {}, new Date(), providers);

		const bad = summaries.find((s) => s.provider === 'bad');
		const good = summaries.find((s) => s.provider === 'good');
		expect(bad?.status).toBe('error');
		expect(bad?.error).toMatch(/simulated transport failure/);
		expect(good?.status).toBe('ok');
		expect(good?.rowsWritten).toBe(1);
		expect(good?.totalAmountUsd).toBe(5);
	});

	it("a failed provider's sync_state records the error and does not clobber a prior successful last_sync_at", async () => {
		const db = createFakeD1();
		let shouldFail = false;
		const provider = fakeProvider({
			name: 'flaky',
			fetchWindow: async () => {
				if (shouldFail) throw new Error('second run fails');
				return [{ provider: 'flaky', date: '2026-07-01', workspaceOrKey: 'org', amountUsd: 1, currency: 'USD', raw: {} }];
			}
		});

		await runProviderSync(db, {}, new Date('2026-07-01T06:00:00Z'), [provider]);
		const afterSuccess = await getSyncState(db, 'flaky');
		expect(afterSuccess?.last_sync_status).toBe('ok');
		expect(afterSuccess?.last_sync_at).toBe('2026-07-01T06:00:00.000Z');

		shouldFail = true;
		await runProviderSync(db, {}, new Date('2026-07-02T06:00:00Z'), [provider]);
		const afterFailure = await getSyncState(db, 'flaky');
		expect(afterFailure?.last_sync_status).toBe('error');
		expect(afterFailure?.last_sync_error).toMatch(/second run fails/);
		// last_sync_at is preserved from the prior success, not cleared/overwritten.
		expect(afterFailure?.last_sync_at).toBe('2026-07-01T06:00:00.000Z');
	});
});

describe('runProviderSync — disabled-provider state (DESIGN.md rule 7)', () => {
	it('a disconnected provider is recorded as not_connected, never as an error, and fetchWindow is never called', async () => {
		const db = createFakeD1();
		const fetchWindow = vi.fn();
		const provider = fakeProvider({ name: 'disabled', isConnected: () => false, fetchWindow });

		const summaries = await runProviderSync(db, {}, new Date(), [provider]);

		expect(summaries[0]).toMatchObject({ provider: 'disabled', status: 'not_connected', rowsWritten: 0 });
		expect(fetchWindow).not.toHaveBeenCalled();

		const state = await getSyncState(db, 'disabled');
		expect(state?.last_sync_status).toBe('not_connected');
		expect(state?.last_sync_error).toBeNull();
	});
});

describe('runProviderSync — backfill window computation', () => {
	it('a never-synced provider is asked for the full backfill start, not an arbitrary recent window', async () => {
		const db = createFakeD1();
		let capturedSinceIso: string | undefined;
		const provider = fakeProvider({
			name: 'anthropic',
			fetchWindow: async (window) => {
				capturedSinceIso = window.sinceIso;
				return [];
			}
		});

		await runProviderSync(db, {}, new Date(), [provider]);
		expect(capturedSinceIso).toBe(FULL_BACKFILL_START_ISO);
	});

	it('a previously-synced provider is asked from 1 day before its last_sync_at (overlap), not from the full backfill start', async () => {
		const db = createFakeD1();
		await runProviderSync(db, {}, new Date('2026-07-01T06:00:00Z'), [fakeProvider({ name: 'anthropic' })]);

		let capturedSinceIso: string | undefined;
		const providerSecondRun = fakeProvider({
			name: 'anthropic',
			fetchWindow: async (window) => {
				capturedSinceIso = window.sinceIso;
				return [];
			}
		});

		await runProviderSync(db, {}, new Date('2026-07-05T06:00:00Z'), [providerSecondRun]);
		expect(capturedSinceIso).toBe('2026-06-30T06:00:00.000Z'); // 1-day overlap before the prior sync
	});
});
