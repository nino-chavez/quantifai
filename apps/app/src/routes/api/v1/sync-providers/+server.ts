/**
 * POST /api/v1/sync-providers — manual provider-cost sync (ADR-0005 shape:
 * Access-bypassed like `/api/v1/ingest`, gated by a bearer credential
 * instead — see the Access application config's bypass policy for
 * `/api/v1/*`). Also the target the Cron Trigger's `scheduled` handler
 * calls in-process (scripts/patch-worker-scheduled.mjs).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/d1';
import { verifySyncRequest } from '$lib/server/sync-auth';
import { runProviderSync } from '$lib/server/sync-providers';

export const POST: RequestHandler = async ({ request, platform }) => {
	const authorized = await verifySyncRequest(request, platform?.env);
	if (!authorized) {
		throw error(401, 'Ingest key or cron secret required');
	}

	const db = getDb(platform);

	try {
		const summaries = await runProviderSync(db, platform?.env ?? {});
		return json({ providers: summaries });
	} catch (err) {
		console.error('Provider sync failed:', err);
		throw error(500, 'Provider sync failed');
	}
};
