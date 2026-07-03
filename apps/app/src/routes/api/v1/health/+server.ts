/**
 * GET /api/v1/health — unauthenticated liveness probe (ADR-0005).
 *
 * Deliberately exempted from both Cloudflare Access and the ingest Bearer
 * key: uptime checks and the operator's own curl-verification step need a
 * path that is reachable with zero credentials, and it discloses nothing
 * (no ledger data, no D1 query) — same posture as the retired platform's
 * `(public)/health` route.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json({ status: 'ok', service: 'quantifai-app', time: new Date().toISOString() });
};
