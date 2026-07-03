/**
 * Auth for `POST /api/v1/sync-providers` — two callers, two credentials:
 *
 *  1. A human/importer running a manual sync: the same Bearer ingest key
 *     as `/api/v1/ingest` (src/lib/server/ingest-auth.ts) — reuses that
 *     verifier as-is, no second key to manage.
 *  2. The Worker's own `scheduled` handler (patched into the built worker
 *     by scripts/patch-worker-scheduled.mjs — see that file for why this
 *     can't just call the sync function directly): an in-process
 *     synthetic request carrying `x-cron-secret`, compared against the
 *     `CRON_SYNC_SECRET` Worker secret. This is deliberately a *separate*
 *     secret from the ingest key, not the ingest key's raw form — the
 *     ingest key is stored only as a SHA-256 hash (ingest-auth.ts) so that
 *     a full secret dump never yields a usable Bearer credential; minting
 *     a raw copy of it just so the scheduled handler could authenticate
 *     would undo that property. `CRON_SYNC_SECRET` is scoped to exactly
 *     one purpose and is not usable against `/api/v1/ingest`.
 *
 * LESSONS-LEARNED.md's cron-auth bug class: "must be `!secret || mismatch`,
 * never `secret && mismatch`" — an unset env var must never silently open
 * the endpoint. Both branches below fail closed on a missing secret.
 */

import { verifyIngestKey } from './ingest-auth';

/** Constant-time compare — direct `===` on secret values is a timing side-channel (Workers best practices). Lengths differing is itself safe to branch on (it never narrows down byte content). */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

export async function verifySyncRequest(
	request: Request,
	env: { INGEST_API_KEY_HASH?: string; CRON_SYNC_SECRET?: string } | undefined
): Promise<boolean> {
	if (await verifyIngestKey(request, env?.INGEST_API_KEY_HASH)) return true;

	const expected = env?.CRON_SYNC_SECRET;
	if (!expected) return false; // fail closed — never `expected && mismatch`

	const presented = request.headers.get('x-cron-secret');
	if (!presented) return false;

	return timingSafeEqual(presented, expected);
}
