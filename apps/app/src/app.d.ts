// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { D1Database } from '@cloudflare/workers-types';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				/** D1 binding — see wrangler.jsonc d1_databases[0].binding (ADR-0005). */
				DB: D1Database;
				/**
				 * SHA-256 hash (hex) of the ingest Bearer key, set via
				 * `wrangler secret put INGEST_API_KEY_HASH` — never the raw key
				 * (see src/lib/server/ingest-auth.ts).
				 */
				INGEST_API_KEY_HASH?: string;
			};
		}
	}
}

export {};
