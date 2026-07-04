/**
 * Public landing page (ADR-0003 re-target) — the root route on every host
 * (single-hostname consolidation: the ledger lives at /ledger). Public by
 * construction on quantifai.app: no Access application covers the apex root,
 * only /ledger* and /practice-numbers* (see src/hooks.server.ts header).
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
