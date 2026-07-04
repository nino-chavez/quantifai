import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/svelte';
import LandingView from './LandingView.svelte';
import type { PublicStats } from '$lib/server/public-stats';

function stats(overrides: Partial<PublicStats> = {}): PublicStats {
	return {
		estimatedValueUsd: 1234.56,
		actualSpendUsd: 456.78,
		sessionCount: 42,
		unitCount: 7,
		deterministicCommitCount: 15,
		lastUpdated: '2026-07-03',
		...overrides
	};
}

describe('LandingView — structural invariant: one primary CTA per rendered page (DESIGN.md)', () => {
	it('renders exactly one data-primary-cta — the waitlist submit button', () => {
		const { container } = render(LandingView, { stats: stats(), turnstileSiteKey: 'test-site-key' });
		expect(container.querySelectorAll('[data-primary-cta]')).toHaveLength(1);
	});
});

describe('LandingView — fixed copy (DESIGN.md-adjacent spec, no new claims)', () => {
	it('renders the H1 and sub exactly as specified', () => {
		const { getByRole, getByText } = render(LandingView, { stats: stats(), turnstileSiteKey: 'test-site-key' });
		expect(getByRole('heading', { name: 'What your practice cost, and what it produced.' })).toBeInTheDocument();
		expect(getByText(/prices AI-assisted work at the unit of work/)).toBeInTheDocument();
	});

	it('renders the live proof strip with all six figures, provenance-labeled', () => {
		const { getByTestId } = render(LandingView, { stats: stats(), turnstileSiteKey: 'test-site-key' });
		const strip = getByTestId('proof-strip');
		// formatUsd drops decimals for amounts >= $100 (src/lib/format.ts) —
		// same rounding the ledger hero already uses.
		expect(within(strip).getByText('$1,235')).toBeInTheDocument();
		expect(within(strip).getByText('$457')).toBeInTheDocument();
		expect(within(strip).getByText('42')).toBeInTheDocument();
		expect(within(strip).getByText('7')).toBeInTheDocument();
		expect(within(strip).getByText('15')).toBeInTheDocument();
		expect(within(strip).getByText('estimated')).toBeInTheDocument();
		expect(within(strip).getByText(/amortized \+ api metered/)).toBeInTheDocument();
		expect(within(strip).getByText(/measured from the operator's own practice/i)).toBeInTheDocument();
	});

	it('renders the three tiles: Collect, Price, Attribute', () => {
		const { getByTestId } = render(LandingView, { stats: stats(), turnstileSiteKey: 'test-site-key' });
		expect(within(getByTestId('tile-collect')).getByText(/Anthropic and OpenRouter today/)).toBeInTheDocument();
		expect(within(getByTestId('tile-price')).getByText(/Three provenances, never conflated/)).toBeInTheDocument();
		expect(within(getByTestId('tile-attribute')).getByText(/Commits link to the sessions/)).toBeInTheDocument();
	});

	it('renders the honesty block verbatim — no Copilot/Cursor/edge-native claims survive', () => {
		const { getByTestId } = render(LandingView, { stats: stats(), turnstileSiteKey: 'test-site-key' });
		const block = getByTestId('honesty-block');
		expect(within(block).getByText(/What it doesn't do \(yet\)/)).toBeInTheDocument();
		expect(within(block).getByText(/No Copilot or Cursor connectors/)).toBeInTheDocument();
		expect(within(block).getByText(/No hosted signup/)).toBeInTheDocument();
	});

	it('never mentions Copilot/Cursor as a working connector, "edge-native", or "across teams" anywhere on the page', () => {
		const { container } = render(LandingView, { stats: stats(), turnstileSiteKey: 'test-site-key' });
		const text = container.textContent ?? '';
		expect(text).not.toMatch(/edge-native/i);
		expect(text).not.toMatch(/across teams/i);
		// Copilot/Cursor may only appear inside the honest "doesn't do" disclaimer.
		const honestyText = container.querySelector('[data-testid="honesty-block"]')?.textContent ?? '';
		const restText = text.replace(honestyText, '');
		expect(restText).not.toMatch(/copilot/i);
		expect(restText).not.toMatch(/cursor/i);
	});

	it('renders the waitlist form with email + optional note + Turnstile widget + "Join the waitlist"', () => {
		const { getByTestId, getByLabelText, getByRole } = render(LandingView, {
			stats: stats(),
			turnstileSiteKey: 'test-site-key'
		});
		expect(getByLabelText('Email')).toBeInTheDocument();
		expect(getByLabelText(/what would you price first/i)).toBeInTheDocument();
		const form = getByTestId('waitlist-form');
		expect(within(form).getByRole('button', { name: /join the waitlist/i })).toBeInTheDocument();
		expect(form.querySelector('.cf-turnstile')).toHaveAttribute('data-sitekey', 'test-site-key');
		expect(getByRole('heading', { name: 'Want this for your practice?' })).toBeInTheDocument();
	});

	it('renders the footer with the fixed line and the operator sign-in link', () => {
		const { getByText, getByRole } = render(LandingView, { stats: stats(), turnstileSiteKey: 'test-site-key' });
		expect(
			getByText('Built in the open by Signal x Studio. QuantifAI is the instrument it measures itself with.')
		).toBeInTheDocument();
		const link = getByRole('link', { name: 'Operator sign-in' });
		expect(link).toHaveAttribute('href', 'https://app.quantifai.app');
	});

	it('handles a null lastUpdated (fresh instance) without throwing', () => {
		const { getByTestId } = render(LandingView, {
			stats: stats({ estimatedValueUsd: 0, actualSpendUsd: 0, sessionCount: 0, unitCount: 0, deterministicCommitCount: 0, lastUpdated: null }),
			turnstileSiteKey: 'test-site-key'
		});
		expect(within(getByTestId('proof-strip')).getByText(/no sessions recorded yet/i)).toBeInTheDocument();
	});
});
