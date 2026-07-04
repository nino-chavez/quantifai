import { describe, it, expect } from 'vitest';
import { reroute } from './hooks';
import type { Reroute } from '@sveltejs/kit';

type RerouteArg = Parameters<Reroute>[0];

function arg(url: string): RerouteArg {
	return { url: new URL(url), fetch } as unknown as RerouteArg;
}

describe('reroute — host-split routing (pairs with hooks.server.ts handle)', () => {
	it('maps "/" on quantifai.app to "/landing"', () => {
		expect(reroute(arg('https://quantifai.app/'))).toBe('/landing');
	});

	it('does not remap non-root paths on quantifai.app', () => {
		expect(reroute(arg('https://quantifai.app/practice-numbers'))).toBeUndefined();
	});

	it('does not remap "/" on app.quantifai.app — the ledger route stays untouched', () => {
		expect(reroute(arg('https://app.quantifai.app/'))).toBeUndefined();
	});

	it('does not remap "/" on the workers.dev host', () => {
		expect(reroute(arg('https://quantifai-app.biq.workers.dev/'))).toBeUndefined();
	});

	it('does not remap www.quantifai.app — handle() redirects it before routing matters', () => {
		expect(reroute(arg('https://www.quantifai.app/'))).toBeUndefined();
	});
});
