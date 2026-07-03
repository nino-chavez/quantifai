/**
 * Supabase admin client factory — server-side only.
 *
 * Pattern: rally-hq / photography canonical (`server-ssr.ts`
 * `createSupabaseAdminClient()`), simplified for this slice's single-user,
 * no-auth posture (ADR-0004: auth lands only if ADR-0003 KQ-3 fires). No
 * cookie-bound SSR client exists yet because there is no session to bind —
 * when auth arrives, add `createSupabaseServerClient(cookies)` alongside
 * this, following the same canonical file.
 *
 * SvelteKit load functions call `.rpc(...)` against the functions defined in
 * `supabase/migrations/20260703000001_functions.sql` (get_ledger_totals,
 * get_unit_of_work_ledger) rather than raw `.select()` — the architectural
 * invariant carried from quantifai-platform: heavy/aggregate reads are
 * Postgres functions, never client-side `SELECT *` past the 1000-row cap.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export function createSupabaseAdminClient() {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const key = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url) throw new Error('PUBLIC_SUPABASE_URL is not set');
	if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

	return createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}
