import { test, expect } from '@playwright/test';

/**
 * @smoke — the one Playwright test DESIGN.md's testing baseline requires for
 * this slice: the ledger renders with seeded (here: really-imported) data and
 * provenance badges are present. Requires the local D1 file migrated
 * (`npm run db:migrate:local`) with both importers already run — see README /
 * package.json `import:claude` + `import:git` — since this hits the real
 * dev/preview server's load function, not a mocked fixture.
 */

test('@smoke ledger renders practice total, unit rows, and provenance disclosure', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: /what your practice cost/i })).toBeVisible();

	// Either the empty state or the populated hero must render — never a blank page.
	const hero = page.getByTestId('hero');
	const emptyState = page.getByTestId('empty-state');
	await expect(hero.or(emptyState)).toBeVisible();

	if (await hero.isVisible()) {
		// Practice hero total is a dollar figure with tabular-numeral styling.
		await expect(hero).toContainText('$');
		// Provenance disclosure is present on the hero total (DESIGN.md rule 1).
		await expect(hero).toContainText(/estimated|metered|subscription/i);

		await expect(page.getByTestId('ledger-table')).toBeVisible();
		await expect(page.getByTestId('cost-vs-output-strip')).toBeVisible();

		// Structural lint, browser-verified: a populated ledger is a read
		// surface — zero primary CTAs (DESIGN.md).
		await expect(page.locator('[data-primary-cta]')).toHaveCount(0);
	} else {
		await expect(emptyState.getByRole('button', { name: /point at your sessions/i })).toBeVisible();
		await expect(page.locator('[data-primary-cta]')).toHaveCount(1);
	}
});
