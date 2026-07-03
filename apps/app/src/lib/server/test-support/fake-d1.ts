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
 * server modules call: `prepare(sql).bind(...args).run()/.first()/.all()`.
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
	return ['0001_initial_schema.sql', '0002_subscription_plans.sql', '0003_git_events_merge_flag.sql', '0004_provider_costs.sql'];
}

export function createFakeD1(): D1Database {
	const sqlite = new DatabaseSync(':memory:');
	for (const file of migrationFiles()) {
		const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
		sqlite.exec(sql);
	}

	const fake = {
		prepare(sql: string) {
			const stmt = sqlite.prepare(sql);
			let boundArgs: SQLInputValue[] = [];
			return {
				bind(...args: unknown[]) {
					boundArgs = args as SQLInputValue[];
					return this;
				},
				async run() {
					stmt.run(...boundArgs);
					return { success: true } as unknown;
				},
				async first<T>() {
					return (stmt.get(...boundArgs) as T | undefined) ?? null;
				},
				async all<T>() {
					return { results: stmt.all(...boundArgs) as T[] };
				}
			};
		}
	};

	return fake as unknown as D1Database;
}
