import { test, expect } from '@playwright/test';

/**
 * @smoke — practice-numbers (DESIGN.md L4, JTBD-3). Same "requires real
 * imported data / local D1" caveat as ledger.e2e.ts: run the importers first
 * (`npm run import:claude -- --local`, `npm run import:git -- --local`).
 */

test('@smoke practice-numbers renders the window nav, rates table, and exactly one primary CTA', async ({
	page
}) => {
	await page.goto('/practice-numbers');

	await expect(page.getByRole('heading', { name: /positioning-bracket export/i })).toBeVisible();
	await expect(page.getByTestId('window-nav')).toBeVisible();
	await expect(page.getByTestId('practice-rates')).toBeVisible();
	await expect(page.getByTestId('as-of')).toBeVisible();

	// Deploys/week must read "not instrumented" — never a merge-count proxy.
	await expect(page.getByTestId('deploys-not-instrumented')).toHaveText('not instrumented');

	// Structural lint, browser-verified: practice-numbers always has exactly
	// one primary CTA — "Export numbers" (DESIGN.md's per-page CTA table).
	await expect(page.locator('[data-primary-cta]')).toHaveCount(1);
	await expect(page.getByRole('button', { name: /export numbers/i })).toBeVisible();
});

test('@smoke export CTA downloads real markdown + CSV built from the live data', async ({ page }) => {
	await page.goto('/practice-numbers?window=all');

	const exportButton = page.getByRole('button', { name: /export numbers/i });
	// Only exercise the download when the window has data (empty local DB
	// disables the button — that state is covered by the component tests).
	if (await exportButton.isDisabled()) {
		test.skip(true, 'no imported data in local D1 — export disabled');
	}

	// Two downloads fire from one click; two parallel waitForEvent calls would
	// both resolve with the SAME first event, so accumulate via page.on instead.
	const downloads: import('@playwright/test').Download[] = [];
	page.on('download', (dl) => downloads.push(dl));
	await exportButton.click();
	await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(2);

	const names = downloads.map((d) => d.suggestedFilename()).sort();
	expect(names[0]).toBe('practice-numbers-all.csv');
	expect(names[1]).toBe('practice-numbers-all.md');

	// Persist for inspection — the report's verbatim-export source.
	const outDir = 'test-results/exports';
	for (const dl of downloads) {
		await dl.saveAs(`${outDir}/${dl.suggestedFilename()}`);
	}
});
