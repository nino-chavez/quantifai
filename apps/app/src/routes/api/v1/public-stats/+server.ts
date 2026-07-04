/**
 * GET /api/v1/public-stats — grand-total aggregates only (src/lib/server/
 * public-stats.ts). Reachable on every host: `/api/v1*` sits on the
 * Cloudflare Access BYPASS application on both quantifai.app and
 * workers.dev, so this is unauthenticated everywhere by design — it
 * discloses nothing but grand totals (DESIGN.md extended: client-adjacent
 * data never leaves the ledger).
 *
 * Cached aggressively per the spec: a `Cache-Control` header for edge/
 * browser caching, plus a short in-Worker memoization so a burst of landing-
 * page hits within the same isolate doesn't each re-run five D1 queries.
 * The in-memory cache is best-effort only — Workers isolates are not
 * guaranteed to survive between requests, so this is a latency optimization,
 * not a correctness dependency (a cold isolate just recomputes).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/d1';
import { getPublicStats, type PublicStats } from '$lib/server/public-stats';

const CACHE_TTL_MS = 60_000;
let memo: { data: PublicStats; expiresAt: number } | null = null;

export const GET: RequestHandler = async ({ platform }) => {
	const now = Date.now();
	if (memo && memo.expiresAt > now) {
		return json(memo.data, { headers: { 'cache-control': 'public, max-age=60, s-maxage=300' } });
	}

	const db = getDb(platform);
	const stats = await getPublicStats(db);
	memo = { data: stats, expiresAt: now + CACHE_TTL_MS };

	return json(stats, { headers: { 'cache-control': 'public, max-age=60, s-maxage=300' } });
};
