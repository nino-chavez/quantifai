/**
 * D1 accessor for `provider_costs` (migrations/0004_provider_costs.sql).
 * Daily-aggregate API-metered spend — upsert is a plain replace on
 * (provider, date, workspace_or_key), matching the provider APIs'
 * behavior (a resync of an already-fetched day returns that day's
 * authoritative total, not a delta to add — replace-not-accumulate, the
 * same rule src/lib/server/sessions.ts documents for session upserts).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { chunk } from '$lib/importers/chunk';
import type { ProviderCostRow } from '$lib/providers/types';

export async function upsertProviderCost(db: D1Database, row: ProviderCostRow): Promise<void> {
	const now = new Date().toISOString();
	await db
		.prepare(
			`INSERT INTO provider_costs (id, provider, date, workspace_or_key, amount_usd, currency, provenance, raw_metadata, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'api_metered', ?7, ?8, ?8)
			 ON CONFLICT (provider, date, workspace_or_key) DO UPDATE SET
			   amount_usd = excluded.amount_usd,
			   currency = excluded.currency,
			   raw_metadata = excluded.raw_metadata,
			   updated_at = excluded.updated_at`
		)
		.bind(
			crypto.randomUUID(),
			row.provider,
			row.date,
			row.workspaceOrKey,
			row.amountUsd,
			row.currency,
			JSON.stringify(row.raw),
			now
		)
		.run();
}

/** Chunked at 500 (LESSONS-LEARNED.md) even though D1 has no URL-encoding row cap — a backfill can be thousands of daily rows across providers/workspaces, and one statement per row is already the ceiling D1's upsert-with-merge model allows (same constraint src/lib/server/ingest.ts documents for sessions). */
export async function upsertProviderCosts(db: D1Database, rows: ProviderCostRow[]): Promise<number> {
	let written = 0;
	for (const batch of chunk(rows)) {
		for (const row of batch) {
			await upsertProviderCost(db, row);
			written += 1;
		}
	}
	return written;
}

export interface ProviderCostTotal {
	provider: string;
	total_amount_usd: number;
	days_covered: number;
	earliest_date: string | null;
	latest_date: string | null;
}

/** All-time per-provider totals — the ledger's "API usage" provider-bucket rows source this, never a units_of_work row (DESIGN.md: api_metered spend is unattributable to units of work, never force-allocated to projects). */
export async function providerCostTotals(db: D1Database): Promise<ProviderCostTotal[]> {
	const { results } = await db
		.prepare(
			`SELECT
				provider,
				COALESCE(SUM(amount_usd), 0) AS total_amount_usd,
				COUNT(DISTINCT date) AS days_covered,
				MIN(date) AS earliest_date,
				MAX(date) AS latest_date
			 FROM provider_costs
			 GROUP BY provider`
		)
		.all<ProviderCostTotal>();
	return results;
}

/** Grand total across all providers, all time — the ledger hero's "actual spend" figure sums this with the amortized figure (never with `estimated`). */
export async function providerCostGrandTotal(db: D1Database): Promise<number> {
	const row = await db
		.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS total FROM provider_costs`)
		.first<{ total: number }>();
	return row?.total ?? 0;
}

/** Windowed total (practice-numbers' cost/week rollup) — `sinceIso` compared against the `date` column's YYYY-MM-DD form via a date-only slice, so a UTC-midnight ISO timestamp bound still matches correctly. */
export async function providerCostTotalSince(db: D1Database, sinceIso: string | null): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(amount_usd), 0) AS total
			 FROM provider_costs
			 WHERE (?1 IS NULL OR date >= substr(?1, 1, 10))`
		)
		.bind(sinceIso)
		.first<{ total: number }>();
	return row?.total ?? 0;
}
