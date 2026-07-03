/**
 * Shared Postgres client for importer CLIs.
 *
 * The importers run as standalone Node scripts (`tsx scripts/...`), outside
 * SvelteKit's request lifecycle, so they connect directly via `pg` against
 * DATABASE_URL rather than going through supabase-js/PostgREST. This is a
 * deliberate departure from the app runtime's supabase-js RPC pattern
 * (src/lib/server/db.ts): bulk local import is exactly the case PostgREST's
 * request-per-call model is wrong for, and a direct connection still calls
 * the same SQL functions (upsert_unit_of_work, upsert_session) — the
 * "heavy work happens in Postgres functions" invariant holds either way.
 */

import { Pool } from 'pg';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Node 20.6+ supports process.loadEnvFile natively — no dotenv dependency needed.
export function loadDotEnv(cwd = process.cwd()) {
	const envPath = join(cwd, '.env');
	if (existsSync(envPath)) {
		try {
			process.loadEnvFile(envPath);
		} catch {
			// already loaded, or malformed — importers fail loudly downstream
			// when DATABASE_URL is actually missing, so this is safe to swallow.
		}
	}
}

export function createPgPool(): Pool {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error(
			'DATABASE_URL is not set. Run `npx supabase start` and copy the DB_URL it prints into .env, or source .env before running this script.'
		);
	}
	return new Pool({ connectionString });
}

/** Chunk an array at `size` — LESSONS-LEARNED.md: Supabase .in()/param arrays must chunk at 500. Applied here to bulk INSERT VALUES batches for the same reason (statement size, not URL length, but the discipline transfers). */
export function chunk<T>(items: T[], size = 500): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}
