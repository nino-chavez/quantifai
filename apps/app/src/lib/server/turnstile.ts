/**
 * Cloudflare Turnstile server-side verification for the public waitlist
 * form (`POST /api/v1/waitlist`). Canonical pattern:
 * `rally-hq/src/lib/server/turnstile.ts` — graceful dev fallback (no secret
 * configured => pass, so local `wrangler dev` without the secret set never
 * blocks the form) and fail-closed on any verification error (a network
 * error against Cloudflare's siteverify endpoint must not wave a bot
 * through — LESSONS-LEARNED.md's "must fail closed on the unset/error path"
 * rule, same shape as src/lib/server/sync-auth.ts's cron-secret check).
 */

export async function verifyTurnstile(token: string, ip: string, secret: string | undefined): Promise<boolean> {
	if (!secret) return true; // not configured (local dev) — skip, don't block

	try {
		const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ secret, response: token, remoteip: ip })
		});
		const body = (await res.json()) as { success: boolean };
		return body.success === true;
	} catch (err) {
		console.error('Turnstile verification failed:', err);
		return false; // fail closed — a broken verify call must not open the gate
	}
}
