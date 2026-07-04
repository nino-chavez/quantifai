import { describe, it, expect, vi } from 'vitest';
import { handle } from './hooks.server';
import type { Handle } from '@sveltejs/kit';

type HandleArg = Parameters<Handle>[0];

function makeArg(url: string, resolve = vi.fn().mockResolvedValue(new Response('ok'))): HandleArg {
	return { event: { url: new URL(url) }, resolve } as unknown as HandleArg;
}

describe('handle — host-split routing (this task: public landing vs. app-host redirect)', () => {
	it('redirects www.quantifai.app to the identical path+query on the apex, 308, without calling resolve', async () => {
		const resolve = vi.fn();
		const { event } = makeArg('https://www.quantifai.app/foo?x=1', resolve);
		const res = await handle({ event, resolve } as HandleArg);

		expect(resolve).not.toHaveBeenCalled();
		expect(res.status).toBe(308);
		expect(res.headers.get('location')).toBe('https://quantifai.app/foo?x=1');
	});

	it('resolves "/" directly on the apex (the public landing, remapped by reroute)', async () => {
		const arg = makeArg('https://quantifai.app/');
		await handle(arg);
		expect(arg.resolve).toHaveBeenCalledWith(arg.event);
	});

	it('resolves the public API routes directly on the apex', async () => {
		for (const path of ['/api/v1/public-stats', '/api/v1/waitlist']) {
			const arg = makeArg(`https://quantifai.app${path}`);
			await handle(arg);
			expect(arg.resolve).toHaveBeenCalledWith(arg.event);
		}
	});

	it('resolves built static asset paths directly on the apex', async () => {
		for (const path of ['/_app/immutable/chunks/abc.js', '/favicon.svg', '/robots.txt']) {
			const arg = makeArg(`https://quantifai.app${path}`);
			await handle(arg);
			expect(arg.resolve).toHaveBeenCalledWith(arg.event);
		}
	});

	it('redirects any other apex path to the same path+query on app.quantifai.app, 302, without calling resolve', async () => {
		const resolve = vi.fn();
		const { event } = makeArg('https://quantifai.app/practice-numbers?window=30', resolve);
		const res = await handle({ event, resolve } as HandleArg);

		expect(resolve).not.toHaveBeenCalled();
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://app.quantifai.app/practice-numbers?window=30');
	});

	it('redirects a private API path (e.g. /api/v1/ingest) on the apex to the app host', async () => {
		const resolve = vi.fn();
		const { event } = makeArg('https://quantifai.app/api/v1/ingest', resolve);
		const res = await handle({ event, resolve } as HandleArg);

		expect(resolve).not.toHaveBeenCalled();
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://app.quantifai.app/api/v1/ingest');
	});

	it('leaves app.quantifai.app and the workers.dev host untouched — falls through to resolve()', async () => {
		for (const host of ['https://app.quantifai.app/', 'https://quantifai-app.biq.workers.dev/']) {
			const arg = makeArg(host);
			await handle(arg);
			expect(arg.resolve).toHaveBeenCalledWith(arg.event);
		}
	});
});
