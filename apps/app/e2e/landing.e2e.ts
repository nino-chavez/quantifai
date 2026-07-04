import { test, expect } from '@playwright/test';

/**
 * @smoke — public landing page (ADR-0003 re-target). Navigates to the
 * underlying route (/landing) directly rather than "/" — the host-based
 * remap (src/hooks.ts reroute) only fires for the `quantifai.app` hostname,
 * which this local `wrangler dev` server isn't bound to; the real host
 * routing is verified live against the deployed apex (see the deploy
 * report), not here.
 */

test('@smoke landing renders live stats, the honesty block, and exactly one primary CTA', async ({ page }) => {
	await page.goto('/landing');

	await expect(page.getByRole('heading', { name: 'What your practice cost, and what it produced.' })).toBeVisible();

	const proofStrip = page.getByTestId('proof-strip');
	await expect(proofStrip).toBeVisible();
	await expect(proofStrip).toContainText('$');
	await expect(proofStrip).toContainText(/estimated/i);

	await expect(page.getByTestId('tile-collect')).toBeVisible();
	await expect(page.getByTestId('tile-price')).toBeVisible();
	await expect(page.getByTestId('tile-attribute')).toBeVisible();

	const honesty = page.getByTestId('honesty-block');
	await expect(honesty).toBeVisible();
	await expect(honesty).toContainText(/No Copilot or Cursor connectors/);

	// Structural lint, browser-verified: the landing has exactly one primary CTA.
	await expect(page.locator('[data-primary-cta]')).toHaveCount(1);

	const form = page.getByTestId('waitlist-form');
	await expect(form).toBeVisible();
	await expect(page.getByLabel('Email')).toBeVisible();
	await expect(page.getByRole('button', { name: /join the waitlist/i })).toBeVisible();

	await expect(page.getByRole('link', { name: 'Operator sign-in' })).toHaveAttribute(
		'href',
		'https://app.quantifai.app'
	);
});
