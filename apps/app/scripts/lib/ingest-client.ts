/**
 * Shared client for the importer CLIs (scripts/import-claude-jsonl.ts,
 * scripts/import-git-events.ts), per ADR-0005.
 *
 * Two write paths:
 *   - Default (remote): POST the normalized batch to the deployed ingest
 *     endpoint (`POST /api/v1/ingest`) — the shipper architecture ADR-0004
 *     always intended; no direct DB access from the importer's machine.
 *   - `--local`: a direct-to-file dev fast path via `wrangler d1 execute
 *     --local`, so iterating on the importer/schema doesn't require
 *     `wrangler dev` running in another terminal. This duplicates the SQL
 *     shape of src/lib/server/{units-of-work,sessions,git-events}.ts by
 *     necessity — those modules take a `D1Database` binding that only
 *     exists inside the Worker runtime, not in a plain Node CLI — so if you
 *     change the upsert semantics there, mirror the change in
 *     `buildLocalUnitUpsertSql` / `buildLocalSessionAndMessageSql` below.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Node 20.6+ supports process.loadEnvFile natively — no dotenv dependency needed.
export function loadDotEnv(cwd = process.cwd()) {
	const envPath = join(cwd, '.env');
	if (existsSync(envPath)) {
		try {
			process.loadEnvFile(envPath);
		} catch {
			// already loaded, or malformed — importers fail loudly downstream.
		}
	}
}

/** SQL literal for a JS value — used only by the `--local` wrangler-d1-execute path (scripts run outside the Worker runtime, so no prepared-statement binding API is available). */
export function sqlLiteral(value: string | number | boolean | null | undefined | string[]): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
	if (typeof value === 'boolean') return value ? '1' : '0';
	const text = Array.isArray(value) ? JSON.stringify(value) : value;
	return `'${text.replace(/'/g, "''")}'`;
}

export interface D1ExecOptions {
	/** apps/app directory (where wrangler.jsonc lives) — d1 execute must run from there. */
	cwd: string;
	local: boolean;
}

/** Runs a multi-statement SQL script against D1 via `wrangler d1 execute --file`. */
export function runD1File(sql: string, { cwd, local }: D1ExecOptions): void {
	const dir = mkdtempSync(join(tmpdir(), 'quantifai-d1-'));
	const file = join(dir, 'batch.sql');
	writeFileSync(file, sql, 'utf8');
	try {
		execFileSync(
			'npx',
			['wrangler', 'd1', 'execute', 'quantifai', local ? '--local' : '--remote', '--file', file],
			{ cwd, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Runs a single read query against D1 via `wrangler d1 execute --command --json` and returns the parsed rows. */
export function runD1Query<T>(sql: string, { cwd, local }: D1ExecOptions): T[] {
	const out = execFileSync(
		'npx',
		['wrangler', 'd1', 'execute', 'quantifai', local ? '--local' : '--remote', '--command', sql, '--json'],
		{ cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
	);
	// `wrangler d1 execute --json` prints one JSON array element per statement;
	// a single-command call has exactly one, whose `.results` holds the rows.
	const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
	return parsed[0]?.results ?? [];
}

export { randomUUID };

export interface IngestApiOptions {
	apiUrl: string;
	apiKey: string;
}

/**
 * POSTs one batch to `POST /api/v1/ingest`. Caller is responsible for
 * keeping each call's messages/sessions/gitEvents combined count under the
 * server's MAX_BATCH_SIZE (10,000) — see chunkBatch below.
 */
export async function postIngestBatch(batch: unknown, { apiUrl, apiKey }: IngestApiOptions) {
	const res = await fetch(new URL('/api/v1/ingest', apiUrl), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify(batch)
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Ingest POST failed: ${res.status} ${res.statusText} — ${text}`);
	}
	return res.json();
}
