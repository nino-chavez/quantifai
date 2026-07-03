/** Presentation formatting — pure, no framework dependency. */

export function formatUsd(amount: number): string {
	if (amount === 0) return '$0';
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: amount < 100 ? 2 : 0
	}).format(amount);
}

/** DESIGN.md rule 1: mixed totals disclose their mix ("$142 · 60% metered"). */
export function provenanceMixLabel(totals: {
	total_cost: number;
	metered_cost: number;
	estimated_cost: number;
	subscription_cost: number;
}): string {
	if (totals.total_cost <= 0) return 'no cost recorded yet';
	const meteredPct = Math.round((totals.metered_cost / totals.total_cost) * 100);
	const estimatedPct = Math.round((totals.estimated_cost / totals.total_cost) * 100);
	const subscriptionPct = 100 - meteredPct - estimatedPct;

	const parts: string[] = [];
	if (meteredPct > 0) parts.push(`${meteredPct}% metered`);
	if (estimatedPct > 0) parts.push(`${estimatedPct}% estimated`);
	if (subscriptionPct > 0) parts.push(`${subscriptionPct}% subscription`);
	return parts.length > 0 ? parts.join(' · ') : 'no cost recorded yet';
}

export type Provenance = 'api_metered' | 'estimated' | 'subscription_amortized';

/** Returns the single provenance when a cost breakdown is 100% one type (the common case today — everything is `estimated`), else null when genuinely mixed (render the text mix label instead of a single badge). */
export function dominantProvenance(totals: {
	total_cost: number;
	metered_cost: number;
	estimated_cost: number;
	subscription_cost: number;
}): Provenance | null {
	if (totals.total_cost <= 0) return null;
	if (totals.metered_cost === totals.total_cost) return 'api_metered';
	if (totals.estimated_cost === totals.total_cost) return 'estimated';
	if (totals.subscription_cost === totals.total_cost) return 'subscription_amortized';
	return null;
}

/**
 * DESIGN.md rule 1's empty-state text for the amortized figure — never a
 * bare $0. `amortization_configured` gates the whole message: even a unit
 * with zero interactive sessions still reads as "no subscription sessions
 * yet" once a plan exists, versus "unconfigured" when no plan has ever been
 * entered.
 */
export function amortizedCoverageLabel(totals: {
	amortization_configured: boolean;
	amortized_interactive_sessions: number;
	amortized_covered_sessions: number;
}): string {
	if (!totals.amortization_configured) return 'amortization unconfigured — set your plan fee';
	if (totals.amortized_interactive_sessions === 0) return 'no subscription sessions yet';
	if (totals.amortized_covered_sessions === totals.amortized_interactive_sessions) {
		return 'covers all subscription sessions';
	}
	return `covers ${totals.amortized_covered_sessions}/${totals.amortized_interactive_sessions} subscription sessions`;
}

export function formatCommitCount(n: number): string {
	if (n === 0) return 'no commits linked';
	return n === 1 ? '1 commit' : `${n} commits`;
}

export function formatSessionCount(n: number): string {
	return n === 1 ? '1 session' : `${n} sessions`;
}
