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
				/** Cron Trigger's internal auth for POST /api/v1/sync-providers — see src/lib/server/sync-auth.ts. */
				CRON_SYNC_SECRET?: string;
				/** Anthropic Admin API key (`sk-ant-admin01-...`) — src/lib/providers/anthropic.ts. Verified working against /v1/organizations/me and /v1/organizations/cost_report. */
				ANTHROPIC_ADMIN_API_KEY?: string;
				/** OpenAI Admin API key — src/lib/providers/openai.ts. Absent: provider renders "not connected" (DESIGN.md rule 7). */
				OPENAI_ADMIN_API_KEY?: string;
				/** OpenRouter API key — src/lib/providers/openrouter.ts. Absent: provider renders "not connected" (DESIGN.md rule 7). */
				OPENROUTER_API_KEY?: string;
				/**
				 * Turnstile widget site key (public, not a secret) for the public
				 * landing's waitlist form — see wrangler.jsonc `vars`, 1Password item
				 * "Cloudflare Turnstile quantifai-app" (field `site_key`).
				 */
				TURNSTILE_SITE_KEY?: string;
				/**
				 * Turnstile secret, set via `wrangler secret put TURNSTILE_SECRET_KEY`
				 * — never committed. 1Password item "Cloudflare Turnstile
				 * quantifai-app" (field `secret_key`). Absent: verifyTurnstile()
				 * passes everything (local dev fallback) — see
				 * src/lib/server/turnstile.ts.
				 */
				TURNSTILE_SECRET_KEY?: string;
			};
		}
	}
}

export {};
