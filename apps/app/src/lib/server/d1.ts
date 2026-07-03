/**
 * D1 accessor — server-side only.
 *
 * Replaces the Supabase admin client factory (`src/lib/server/db.ts`, now
 * deleted per ADR-0005). A Worker gets its D1 binding from `platform.env`
 * (populated by `@sveltejs/adapter-cloudflare` in prod, and emulated via
 * wrangler's local bindings during `wrangler dev` / `vite dev` — see
 * src/app.d.ts for the `Platform.env` shape). There is no client to
 * construct: the binding IS the client.
 */

import type { D1Database } from '@cloudflare/workers-types';

export function getDb(platform: App.Platform | undefined): D1Database {
	const db = platform?.env?.DB;
	if (!db) {
		throw new Error(
			'D1 binding "DB" is not available on platform.env — see wrangler.jsonc d1_databases, and run via `wrangler dev` (not plain `vite dev`) for local bindings.'
		);
	}
	return db;
}
