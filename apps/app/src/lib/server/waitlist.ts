/**
 * D1 accessor for `waitlist_signups` (migrations/0006_waitlist_signups.sql).
 * Backs `POST /api/v1/waitlist` — the public landing page's one CTA.
 *
 * Dupe-email handling: `ON CONFLICT (email) DO NOTHING` rather than a raw
 * INSERT that would throw a UNIQUE-constraint error. A prospect resubmitting
 * (double-click, retried fetch, genuinely re-signing-up) must get the same
 * honest "you're on the list" response, not a 500 — same idempotent-upsert
 * posture the rest of this schema follows (LESSONS-LEARNED.md), applied to
 * a DO-NOTHING instead of DO-UPDATE since there's nothing to update.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface WaitlistSignupInput {
	email: string;
	note: string | null;
}

export interface WaitlistSignupResult {
	/** True when the email already existed — INSERT was a no-op, not an error. */
	alreadyExists: boolean;
}

export async function insertWaitlistSignup(
	db: D1Database,
	input: WaitlistSignupInput
): Promise<WaitlistSignupResult> {
	const now = new Date().toISOString();
	const result = await db
		.prepare(
			`INSERT INTO waitlist_signups (id, email, note, created_at)
			 VALUES (?1, ?2, ?3, ?4)
			 ON CONFLICT (email) DO NOTHING`
		)
		.bind(crypto.randomUUID(), input.email, input.note, now)
		.run();

	const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
	return { alreadyExists: changes === 0 };
}
