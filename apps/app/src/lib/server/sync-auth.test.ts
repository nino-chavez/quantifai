/**
 * LESSONS-LEARNED.md cron-auth bug class regression test: "must be
 * `!secret || mismatch`, never `secret && mismatch`" — an unset
 * `CRON_SYNC_SECRET` must never silently authorize a request.
 */

import { describe, it, expect } from 'vitest';
import { verifySyncRequest } from './sync-auth';

function requestWithHeader(name: string, value: string): Request {
	return new Request('https://example.test/api/v1/sync-providers', {
		method: 'POST',
		headers: { [name]: value }
	});
}

describe('verifySyncRequest — cron-secret path', () => {
	it('fails closed when CRON_SYNC_SECRET is unset, even if a header is presented', async () => {
		const request = requestWithHeader('x-cron-secret', 'anything');
		expect(await verifySyncRequest(request, { CRON_SYNC_SECRET: undefined })).toBe(false);
	});

	it('rejects a mismatched cron secret', async () => {
		const request = requestWithHeader('x-cron-secret', 'wrong');
		expect(await verifySyncRequest(request, { CRON_SYNC_SECRET: 'correct-secret' })).toBe(false);
	});

	it('accepts the correct cron secret', async () => {
		const request = requestWithHeader('x-cron-secret', 'correct-secret');
		expect(await verifySyncRequest(request, { CRON_SYNC_SECRET: 'correct-secret' })).toBe(true);
	});

	it('rejects a request with no auth at all', async () => {
		const request = new Request('https://example.test/api/v1/sync-providers', { method: 'POST' });
		expect(await verifySyncRequest(request, { CRON_SYNC_SECRET: 'correct-secret' })).toBe(false);
	});
});

describe('verifySyncRequest — ingest-key path (manual runs)', () => {
	it('accepts a valid Bearer ingest key, independent of CRON_SYNC_SECRET', async () => {
		const rawKey = 'test-ingest-key';
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
		const hex = Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		const request = new Request('https://example.test/api/v1/sync-providers', {
			method: 'POST',
			headers: { authorization: `Bearer ${rawKey}` }
		});
		expect(await verifySyncRequest(request, { INGEST_API_KEY_HASH: hex })).toBe(true);
	});
});
