/**
 * D1 accessor for `subscription_plans` — read-only from the app's
 * perspective. Rows are written exclusively by `scripts/seed-subscription-plan.ts`
 * (an operator-run administrative action), never by the app or any importer
 * — this table has no fabricated defaults (DESIGN.md rule 1).
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { SubscriptionPlan } from '../pricing/amortization';

export async function listSubscriptionPlans(db: D1Database): Promise<SubscriptionPlan[]> {
	const { results } = await db
		.prepare(
			`SELECT
				provider,
				monthly_fee_usd AS monthlyFeeUsd,
				active_from AS activeFrom,
				active_to AS activeTo
			 FROM subscription_plans`
		)
		.all<SubscriptionPlan>();
	return results;
}
