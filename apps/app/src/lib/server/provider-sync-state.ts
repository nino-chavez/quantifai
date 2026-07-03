/**
 * D1 accessor for `provider_sync_state` (migrations/0004_provider_costs.sql)
 * — one row per provider, the queryable "connections state" DESIGN.md rule
 * 7 requires (unconnected providers render as "not connected," never as an
 * error or silence). Written exclusively by the sync orchestrator
 * (src/lib/server/sync-providers.ts); read by the ledger's provider-bucket
 * rows and the manual-sync endpoint's response.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type SyncStatus = 'ok' | 'error' | 'not_connected' | 'never_run';

export interface ProviderSyncStateRow {
	provider: string;
	last_sync_at: string | null;
	last_sync_status: SyncStatus;
	last_sync_error: string | null;
	rows_written: number;
	updated_at: string;
}

export async function getSyncState(db: D1Database, provider: string): Promise<ProviderSyncStateRow | null> {
	const row = await db
		.prepare(`SELECT * FROM provider_sync_state WHERE provider = ?1`)
		.bind(provider)
		.first<ProviderSyncStateRow>();
	return row ?? null;
}

export async function allSyncStates(db: D1Database): Promise<ProviderSyncStateRow[]> {
	const { results } = await db.prepare(`SELECT * FROM provider_sync_state`).all<ProviderSyncStateRow>();
	return results;
}

export interface WriteSyncStateInput {
	provider: string;
	status: SyncStatus;
	/** Pass a fresh ISO timestamp on success; pass `null` on error/not_connected so the prior successful sync time is preserved (COALESCE below) rather than clobbered. */
	lastSyncAt: string | null;
	error: string | null;
	rowsWritten: number;
}

export async function writeSyncState(db: D1Database, input: WriteSyncStateInput): Promise<void> {
	const now = new Date().toISOString();
	await db
		.prepare(
			`INSERT INTO provider_sync_state (provider, last_sync_at, last_sync_status, last_sync_error, rows_written, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
			 ON CONFLICT (provider) DO UPDATE SET
			   last_sync_at = COALESCE(excluded.last_sync_at, provider_sync_state.last_sync_at),
			   last_sync_status = excluded.last_sync_status,
			   last_sync_error = excluded.last_sync_error,
			   rows_written = excluded.rows_written,
			   updated_at = excluded.updated_at`
		)
		.bind(input.provider, input.lastSyncAt, input.status, input.error, input.rowsWritten, now)
		.run();
}
