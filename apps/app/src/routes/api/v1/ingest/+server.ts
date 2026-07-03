/**
 * POST /api/v1/ingest — shipper/importer ingestion endpoint (ADR-0005).
 *
 * Exempted from Cloudflare Access (see the Access application config —
 * `/api/v1/*` is a separate, unauthenticated-at-the-edge Access app with a
 * bypass policy); auth here is the Bearer ingest key instead, since a
 * non-interactive importer can't complete an Access login.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/d1';
import { verifyIngestKey } from '$lib/server/ingest-auth';
import { processIngestBatch, IngestBatchTooLargeError, type IngestBatch } from '$lib/server/ingest';

export const POST: RequestHandler = async ({ request, platform }) => {
	const authorized = await verifyIngestKey(request, platform?.env?.INGEST_API_KEY_HASH);
	if (!authorized) {
		throw error(401, 'Ingest key required');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw error(400, 'Body must be a JSON object: { unitsOfWork?, sessions?, messages?, gitEvents? }');
	}

	const db = getDb(platform);

	try {
		const result = await processIngestBatch(db, body as IngestBatch);
		return json(result);
	} catch (err) {
		if (err instanceof IngestBatchTooLargeError) {
			throw error(400, err.message);
		}
		console.error('Ingest batch failed:', err);
		throw error(500, 'Ingest batch failed');
	}
};
