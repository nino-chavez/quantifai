import { describe, it, expect, vi } from 'vitest';
import { handle } from './hooks.server';
import type { Handle } from '@sveltejs/kit';

type HandleArg = Parameters<Handle>[0];

function makeArg(url: string, resolve = vi.fn().mockResolvedValue(new Response('ok'))): HandleArg {
	return { event: { url: new URL(url) }, resolve } as unknown as HandleArg;
}

describe('handle — hostname canonicalization (single human hostname, path routes)', () => {
	it('redirects www.quantifai.app to the identical path+query on the apex, 308, without calling resolve', async () => {
		const resolve = vi.fn();
		const { event } = makeArg('https://www.quantifai.app/foo?x=1', resolve);
		const res = await handle({ event, resolve } as HandleArg);

		expect(resolve).not.toHaveBeenCalled();
		expect(res.status).toBe(308);
		expect(res.headers.get('location')).toBe('https://quantifai.app/foo?x=1');
	});

	it('resolves every apex path directly — no host-based route split (Access gates /ledger and /practice-numbers at the edge)', async () => {
		for (const path of [
			'/',
			'/ledger',
			'/practice-numbers',
			'/api/v1/public-stats',
			'/api/v1/ingest',
			'/_app/immutable/x.js'
		]) {
			const arg = makeArg(`https://quantifai.app${path}`);
			await handle(arg);
			expect(arg.resolve).toHaveBeenCalledWith(arg.event);
		}
	});

	it('leaves the workers.dev importer/API host untouched — falls through to resolve()', async () => {
		for (const path of ['/', '/ledger', '/api/v1/health']) {
			const arg = makeArg(`https://quantifai-app.biq.workers.dev${path}`);
			await handle(arg);
			expect(arg.resolve).toHaveBeenCalledWith(arg.event);
		}
	});
});
