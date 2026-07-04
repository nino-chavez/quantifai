/**
 * UNIQUE(email) idempotency (DESIGN.md testing baseline: every LESSONS-
 * LEARNED.md bug class gets a regression test at first touch — the
 * "atomic upsert" class applied to `waitlist_signups`'s DO-NOTHING form).
 * Runs against a real SQLite engine (test-support/fake-d1.ts).
 */

import { describe, it, expect } from 'vitest';
import { createFakeD1 } from './test-support/fake-d1';
import { insertWaitlistSignup } from './waitlist';

describe('insertWaitlistSignup — UNIQUE(email) idempotency', () => {
	it('a first-time signup is written and reports alreadyExists: false', async () => {
		const db = createFakeD1();
		const result = await insertWaitlistSignup(db, { email: 'nino@example.com', note: 'pricing a subcontract gig' });

		expect(result.alreadyExists).toBe(false);
		const { results } = await db
			.prepare('SELECT email, note FROM waitlist_signups')
			.all<{ email: string; note: string | null }>();
		expect(results).toHaveLength(1);
		expect(results[0].email).toBe('nino@example.com');
		expect(results[0].note).toBe('pricing a subcontract gig');
	});

	it('resubmitting the same email is a no-op, not an error — alreadyExists: true, no second row', async () => {
		const db = createFakeD1();
		await insertWaitlistSignup(db, { email: 'dup@example.com', note: null });
		const second = await insertWaitlistSignup(db, { email: 'dup@example.com', note: 'a different note' });

		expect(second.alreadyExists).toBe(true);
		const { results } = await db.prepare('SELECT COUNT(*) AS n FROM waitlist_signups').all<{ n: number }>();
		expect(results[0].n).toBe(1);
	});

	it('two different emails both land as distinct rows', async () => {
		const db = createFakeD1();
		await insertWaitlistSignup(db, { email: 'a@example.com', note: null });
		await insertWaitlistSignup(db, { email: 'b@example.com', note: null });

		const { results } = await db.prepare('SELECT COUNT(*) AS n FROM waitlist_signups').all<{ n: number }>();
		expect(results[0].n).toBe(2);
	});
});
