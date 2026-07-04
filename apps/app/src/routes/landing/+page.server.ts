/**
 * Public landing page (ADR-0003 re-target). Reached at "/" on the apex
 * (quantifai.app) via src/hooks.ts's `reroute` — the underlying route lives
 * at /landing so it can coexist with the ledger's own "/" route without
 * either one's code changing.
 */

import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/d1';
import { getPublicStats } from '$lib/server/public-stats';

export const load: PageServerLoad = async ({ platform }) => {
	const db = getDb(platform);
	const stats = await getPublicStats(db);
	const turnstileSiteKey = platform?.env?.TURNSTILE_SITE_KEY ?? '';
	return { stats, turnstileSiteKey };
};
