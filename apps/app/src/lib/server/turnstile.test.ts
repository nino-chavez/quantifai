import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyTurnstile } from './turnstile';

describe('verifyTurnstile', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('passes when no secret is configured (local dev fallback) without calling fetch', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		const ok = await verifyTurnstile('some-token', '127.0.0.1', undefined);

		expect(ok).toBe(true);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns true when Cloudflare siteverify reports success', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ json: async () => ({ success: true }) })
		);

		const ok = await verifyTurnstile('valid-token', '127.0.0.1', 'secret-value');
		expect(ok).toBe(true);
	});

	it('returns false when Cloudflare siteverify reports failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) })
		);

		const ok = await verifyTurnstile('bad-token', '127.0.0.1', 'secret-value');
		expect(ok).toBe(false);
	});

	it('fails closed (returns false) when the siteverify request throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('network error'))
		);

		const ok = await verifyTurnstile('token', '127.0.0.1', 'secret-value');
		expect(ok).toBe(false);
	});
});
