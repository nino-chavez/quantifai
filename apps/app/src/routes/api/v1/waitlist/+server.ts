/**
 * POST /api/v1/waitlist — the public landing page's one CTA (ADR-0003
 * re-target). Public, Turnstile-verified server-side (src/lib/server/
 * turnstile.ts); writes to D1 `waitlist_signups` (src/lib/server/waitlist.ts).
 *
 * CORS: this route is reachable both same-origin (a browser on
 * https://quantifai.app posting to a relative `/api/v1/waitlist`, which
 * resolves on the zone) and cross-origin (the documented fallback if the
 * zone's WAF 403s a same-origin POST — the client then posts straight to
 * `https://quantifai-app.biq.workers.dev/api/v1/waitlist`, which has no such
 * WAF rule). CORS headers are always set so both paths work without a
 * second deploy once we learn which one the WAF actually blocks; see
 * src/lib/components/LandingView.svelte for the client-side try/fallback.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/d1';
import { verifyTurnstile } from '$lib/server/turnstile';
import { insertWaitlistSignup } from '$lib/server/waitlist';

const ALLOWED_ORIGINS = new Set(['https://quantifai.app', 'https://www.quantifai.app']);

function corsHeaders(origin: string | null): Record<string, string> {
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		return { 'access-control-allow-origin': origin, vary: 'origin' };
	}
	return {};
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	return new Response(null, {
		status: 204,
		headers: {
			...corsHeaders(origin),
			'access-control-allow-methods': 'POST, OPTIONS',
			'access-control-allow-headers': 'Content-Type'
		}
	});
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	const headers = corsHeaders(origin);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400, headers });
	}

	const { email, note, turnstileToken } = (body ?? {}) as {
		email?: unknown;
		note?: unknown;
		turnstileToken?: unknown;
	};

	if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
		return json({ error: 'A valid email is required.' }, { status: 400, headers });
	}
	if (typeof turnstileToken !== 'string' || turnstileToken.length === 0) {
		return json({ error: 'Verification required — refresh and try again.' }, { status: 400, headers });
	}

	const ip = request.headers.get('cf-connecting-ip') ?? '';
	const verified = await verifyTurnstile(turnstileToken, ip, platform?.env?.TURNSTILE_SECRET_KEY);
	if (!verified) {
		return json({ error: 'Verification failed — refresh and try again.' }, { status: 400, headers });
	}

	const db = getDb(platform);
	const result = await insertWaitlistSignup(db, {
		email: email.trim().toLowerCase(),
		note: typeof note === 'string' && note.trim().length > 0 ? note.trim() : null
	});

	return json({ ok: true, alreadyOnList: result.alreadyExists }, { headers });
};
