/**
 * A minimal fake `D1Database` backed by Node's built-in `node:sqlite`
 * (`DatabaseSync`, Node 22+) — real SQLite, real `ON CONFLICT` semantics,
 * running the project's actual migration SQL. Used only in tests that need
 * to exercise a genuine UNIQUE-upsert idempotency guarantee (D1's SQLite
 * dialect and Node's built-in SQLite are both the same engine, so this is a
 * faithful substrate, not a JS re-implementation of the SQL that would risk
 * testing the mock instead of the query).
 *
 * Implements only the subset of the `D1Database` interface this codebase's
 * server modules call: `prepare(sql).bind(...args).run()/.first()/.all()`
 * and `batch(statements)`. `batch` runs inside one transaction and rolls
 * back on the first failure, matching D1's documented batch semantics.
 *
 * `d1RoundTrips(db)` reports how many calls reached the database: each
 * standalone run/first/all is one, and a whole `batch()` is one. Tests use
 * it to pin query cost, since the Worker's per-invocation budget is counted
 * in calls, not rows.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

function migrationFiles(): string[] {
	// Sequential, numbered migrations — same ordering wrangler applies them in.
	return [
		'0001_initial_schema.sql',
		'0002_subscription_plans.sql',
		'0003_git_events_merge_flag.sql',
		'0004_provider_costs.sql',
		'0005_openrouter_activity_cleanup.sql',
		'0006_waitlist_signups.sql'
	];
}

export interface D1RoundTrips {
	queries: number;
	batches: number;
}

const roundTrips = new WeakMap<object, D1RoundTrips>();

export function d1RoundTrips(db: D1Database): D1RoundTrips {
	const counts = roundTrips.get(db);
	if (!counts) throw new Error('d1RoundTrips: not a fake D1 from createFakeD1()');
	return { ...counts };
}

export function createFakeD1(): D1Database {
	const sqlite = new DatabaseSync(':memory:');
	for (const file of migrationFiles()) {
		const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
		sqlite.exec(sql);
	}

	const counts: D1RoundTrips = { queries: 0, batches: 0 };
	let inBatch = false;
	const count = () => {
		if (!inBatch) counts.queries += 1;
	};

	const fake = {
		async batch(statements: Array<{ all(): Promise<{ results: unknown[] }> }>) {
			counts.batches += 1;
			inBatch = true;
			sqlite.exec('BEGIN');
			try {
				const out = [];
				for (const stmt of statements) out.push(await stmt.all());
				sqlite.exec('COMMIT');
				return out;
			} catch (err) {
				sqlite.exec('ROLLBACK');
				throw err;
			} finally {
				inBatch = false;
			}
		},
		prepare(sql: string) {
			const stmt = sqlite.prepare(sql);
			let boundArgs: SQLInputValue[] = [];
			return {
				bind(...args: unknown[]) {
					boundArgs = args as SQLInputValue[];
					return this;
				},
				async run() {
					count();
					// node:sqlite's run() returns { changes, lastInsertRowid } — surfaced
					// as D1's meta.changes so callers can detect an `ON CONFLICT DO
					// NOTHING` no-op (changes === 0) the same way real D1 reports it
					// (src/lib/server/waitlist.ts's dupe-email detection relies on this).
					const info = stmt.run(...boundArgs);
					return {
						success: true,
						meta: { changes: Number(info.changes ?? 0) }
					} as unknown;
				},
				async first<T>() {
					count();
					return (stmt.get(...boundArgs) as T | undefined) ?? null;
				},
				async all<T>() {
					count();
					return { results: stmt.all(...boundArgs) as T[] };
				}
			};
		}
	};

	roundTrips.set(fake, counts);
	return fake as unknown as D1Database;
}
