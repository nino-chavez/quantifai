/**
 * Provider-cost sync orchestrator — the daily poll DESIGN.md's Provider
 * interface exists to drive. Iterates `ALL_PROVIDERS` (src/lib/providers/
 * registry.ts), per-provider error isolation (sibling scan,
 * quantifai-lite's `cron/sync-providers/+server.ts`: "one bad connection
 * doesn't fail the run" — here, one bad *provider*), writes
 * `provider_sync_state` for every provider on every run (connected,
 * disconnected, or failed) so the connections state is always current, and
 * upserts normalized rows into `provider_costs`.
 *
 * Called from two places with identical semantics (DESIGN.md: no
 * per-caller special-casing): the manual `POST /api/v1/sync-providers`
 * route and the Cron Trigger's `scheduled` handler (see
 * scripts/patch-worker-scheduled.mjs — the adapter-cloudflare gap this
 * project works around, documented there).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { ALL_PROVIDERS } from '$lib/providers/registry';
import type { CostProvider, ProviderSyncEnv } from '$lib/providers/types';
import { upsertProviderCosts } from './provider-costs';
import { getSyncState, writeSyncState, type SyncStatus } from './provider-sync-state';

/**
 * First-ever backfill start: well before the operator's earliest known
 * Anthropic invoice (Sep 2025) — "as far as the API allows" is honored by
 * requesting from here and letting the provider's own retention window
 * silently return less, rather than the sync guessing a retention limit.
 */
export const FULL_BACKFILL_START_ISO = '2025-01-01T00:00:00Z';

/** Re-fetch the last day of the previous sync too — a day that was "complete" at last sync's fetch time may have accrued more usage since (sibling scan: lite's poller applies the same 1-day overlap). */
const OVERLAP_DAYS = 1;

function computeSinceIso(lastSyncAtIso: string | null): string {
	if (!lastSyncAtIso) return FULL_BACKFILL_START_ISO;
	const overlapMs = OVERLAP_DAYS * 24 * 60 * 60 * 1000;
	return new Date(Date.parse(lastSyncAtIso) - overlapMs).toISOString();
}

export interface ProviderSyncSummary {
	provider: string;
	status: SyncStatus;
	rowsWritten: number;
	daysBackfilled: number;
	totalAmountUsd: number;
	sinceIso: string | null;
	error: string | null;
}

function summarizeRows(rows: { date: string; amountUsd: number }[]) {
	const days = new Set(rows.map((r) => r.date));
	const total = rows.reduce((sum, r) => sum + r.amountUsd, 0);
	return { daysBackfilled: days.size, totalAmountUsd: total };
}

export async function runProviderSync(
	db: D1Database,
	env: ProviderSyncEnv,
	now: Date = new Date(),
	/** Injectable for tests (fake providers, no real HTTP) — defaults to the real registry everywhere else. */
	providers: CostProvider[] = ALL_PROVIDERS
): Promise<ProviderSyncSummary[]> {
	const summaries: ProviderSyncSummary[] = [];

	for (const provider of providers) {
		if (!provider.isConnected(env)) {
			await writeSyncState(db, {
				provider: provider.name,
				status: 'not_connected',
				lastSyncAt: null,
				error: null,
				rowsWritten: 0
			});
			summaries.push({
				provider: provider.name,
				status: 'not_connected',
				rowsWritten: 0,
				daysBackfilled: 0,
				totalAmountUsd: 0,
				sinceIso: null,
				error: null
			});
			continue;
		}

		const state = await getSyncState(db, provider.name);
		const sinceIso = computeSinceIso(state?.last_sync_at ?? null);

		try {
			// No explicit `untilIso`: verified live 2026-07-03 that passing
			// `ending_at` close to "now" can collapse to an empty/invalid range
			// once the provider snaps both bounds to day boundaries ("ending
			// date must be after starting date") — e.g. a same-day manual
			// re-sync shortly after a prior success. Omitting it lets each
			// adapter default to "everything since sinceIso, through whatever
			// the provider currently has," which is what "sync" means here.
			const rows = await provider.fetchWindow({ sinceIso }, env);
			const rowsWritten = await upsertProviderCosts(db, rows);
			const { daysBackfilled, totalAmountUsd } = summarizeRows(rows);

			await writeSyncState(db, {
				provider: provider.name,
				status: 'ok',
				lastSyncAt: now.toISOString(),
				error: null,
				rowsWritten
			});

			summaries.push({
				provider: provider.name,
				status: 'ok',
				rowsWritten,
				daysBackfilled,
				totalAmountUsd,
				sinceIso,
				error: null
			});
		} catch (err) {
			// Per-provider isolation: log and continue — one failing provider
			// never fails the run (sibling scan, LESSONS-LEARNED.md checklist).
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Provider sync failed for ${provider.name}:`, message);

			await writeSyncState(db, {
				provider: provider.name,
				status: 'error',
				lastSyncAt: null, // preserves the prior successful sync time (COALESCE in writeSyncState)
				error: message,
				rowsWritten: 0
			});

			summaries.push({
				provider: provider.name,
				status: 'error',
				rowsWritten: 0,
				daysBackfilled: 0,
				totalAmountUsd: 0,
				sinceIso,
				error: message
			});
		}
	}

	return summaries;
}
