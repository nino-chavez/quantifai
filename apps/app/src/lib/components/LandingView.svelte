<script lang="ts">
	import { formatUsd } from '$lib/format';
	import { resolve } from '$app/paths';
	import type { PublicStats } from '$lib/server/public-stats';

	let { stats, turnstileSiteKey }: { stats: PublicStats; turnstileSiteKey: string } = $props();

	type FormState = 'idle' | 'submitting' | 'success' | 'error';
	let formState = $state<FormState>('idle');
	let errorMessage = $state('');
	let email = $state('');
	let note = $state('');

	// Cross-origin POST to workers.dev is the DOCUMENTED PRIMARY on the live
	// zone, not a fallback: the quantifai.app zone WAF serves a block page on
	// POSTs to the apex — verified live 2026-07-04 with a real Chromium
	// browser holding a valid Turnstile token, so it applies to legitimate
	// form posts, not just bot-shaped traffic (README "Deploy" section). The
	// same rule applies to ANY future in-app POST from a quantifai.app page.
	// CORS on the endpoint is configured for exactly this. Off the zone
	// (local dev, workers.dev itself) same-origin has no WAF and is used
	// directly; each side keeps the other as a content-type-sniffed fallback
	// so a WAF-rule change never strands the form.
	const WORKERS_DEV_WAITLIST_URL = 'https://quantifai-app.biq.workers.dev/api/v1/waitlist';
	const onZone =
		typeof location !== 'undefined' &&
		(location.hostname === 'quantifai.app' || location.hostname === 'www.quantifai.app');
	const WAITLIST_PRIMARY_URL = onZone ? WORKERS_DEV_WAITLIST_URL : '/api/v1/waitlist';
	const WAITLIST_FALLBACK_URL = onZone ? '/api/v1/waitlist' : WORKERS_DEV_WAITLIST_URL;

	function getTurnstileToken(form: HTMLFormElement): string | null {
		const input = form.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
		return input?.value || null;
	}

	function resetTurnstile() {
		const w = (globalThis as unknown as { turnstile?: { reset: () => void } }).turnstile;
		w?.reset();
	}

	async function postWaitlist(url: string, payload: unknown): Promise<Response> {
		return fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const token = getTurnstileToken(form);
		if (!token) {
			formState = 'error';
			errorMessage = 'Verify you are human, then try again.';
			return;
		}

		formState = 'submitting';
		errorMessage = '';
		const payload = { email, note: note.trim().length > 0 ? note.trim() : undefined, turnstileToken: token };

		try {
			let res = await postWaitlist(WAITLIST_PRIMARY_URL, payload);
			if (!res.headers.get('content-type')?.includes('application/json')) {
				res = await postWaitlist(WAITLIST_FALLBACK_URL, payload);
			}
			const body = await res.json().catch(() => ({}) as { error?: string });
			if (res.ok) {
				formState = 'success';
			} else {
				formState = 'error';
				errorMessage = body.error ?? 'Could not join the waitlist — try again.';
				resetTurnstile();
			}
		} catch {
			formState = 'error';
			errorMessage = 'Network error — try again.';
			resetTurnstile();
		}
	}

	function lastUpdatedLabel(iso: string | null): string {
		if (!iso) return 'no sessions recorded yet';
		const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
		return `updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
	}
</script>

<svelte:head>
	<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</svelte:head>

<div class="mx-auto max-w-4xl px-6 py-16">
	<header class="mb-14">
		<p class="font-display text-sm uppercase tracking-[0.2em] text-[var(--color-text-muted)]">QuantifAI</p>
	</header>

	<section class="mb-16">
		<h1 class="font-display max-w-3xl text-4xl font-semibold leading-tight text-[var(--color-text)] sm:text-5xl">
			What your practice cost, and what it produced.
		</h1>
		<p class="mt-6 max-w-2xl text-lg text-[var(--color-text-muted)]">
			QuantifAI prices AI-assisted work at the unit of work — an initiative, a project, a session — across
			subscription and API spend, and pairs every dollar with the commits it produced.
		</p>
	</section>

	<!-- Live proof strip — the personality moment: gold on warm dark, big tabular numbers. -->
	<section
		class="mb-16 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-8"
		data-testid="proof-strip"
	>
		<div class="flex flex-wrap gap-10">
			<div>
				<p class="text-sm text-[var(--color-text-muted)]">Estimated value (API-equivalent)</p>
				<p class="metric-number font-display mt-1 text-4xl font-semibold text-[var(--color-gold)]">
					{formatUsd(stats.estimatedValueUsd)}
				</p>
				<span class="provenance-badge provenance-badge--estimated mt-2">estimated</span>
			</div>
			<div>
				<p class="text-sm text-[var(--color-text-muted)]">Actual spend (real dollars)</p>
				<p class="metric-number font-display mt-1 text-4xl font-semibold text-[var(--color-savings-green)]">
					{formatUsd(stats.actualSpendUsd)}
				</p>
				<span class="provenance-badge provenance-badge--actual_spend mt-2">amortized + api metered</span>
			</div>
			<div>
				<p class="text-sm text-[var(--color-text-muted)]">Sessions</p>
				<p class="metric-number font-display mt-1 text-4xl font-semibold text-[var(--color-text)]">
					{stats.sessionCount}
				</p>
			</div>
			<div>
				<p class="text-sm text-[var(--color-text-muted)]">Units of work</p>
				<p class="metric-number font-display mt-1 text-4xl font-semibold text-[var(--color-text)]">
					{stats.unitCount}
				</p>
			</div>
			<div>
				<p class="text-sm text-[var(--color-text-muted)]">Deterministic-linked commits</p>
				<p class="metric-number font-display mt-1 text-4xl font-semibold text-[var(--color-usage-blue)]">
					{stats.deterministicCommitCount}
				</p>
			</div>
		</div>
		<p class="mt-6 text-xs text-[var(--color-text-muted)]">
			Measured from the operator's own practice, {lastUpdatedLabel(stats.lastUpdated)} — updated continuously.
		</p>
	</section>

	<!-- Three tiles: Collect / Price / Attribute — each answers what-you-get. -->
	<section class="mb-16 grid gap-6 sm:grid-cols-3">
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-6" data-testid="tile-collect">
			<h2 class="font-display text-sm uppercase tracking-[0.15em] text-[var(--color-gold)]">Collect</h2>
			<p class="mt-3 text-sm text-[var(--color-text-muted)]">
				Local session logs and provider billing APIs. Anthropic and OpenRouter today; your data stays in your
				own infrastructure.
			</p>
		</div>
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-6" data-testid="tile-price">
			<h2 class="font-display text-sm uppercase tracking-[0.15em] text-[var(--color-gold)]">Price</h2>
			<p class="mt-3 text-sm text-[var(--color-text-muted)]">
				Three provenances, never conflated: API-equivalent value, subscription amortization, metered API
				spend. Every number carries its provenance.
			</p>
		</div>
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-6" data-testid="tile-attribute">
			<h2 class="font-display text-sm uppercase tracking-[0.15em] text-[var(--color-gold)]">Attribute</h2>
			<p class="mt-3 text-sm text-[var(--color-text-muted)]">
				Commits link to the sessions that produced them — deterministically via git notes where instrumented,
				honestly labeled as time-correlated where not.
			</p>
		</div>
	</section>

	<!-- The honesty block. -->
	<section
		class="mb-16 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-8"
		data-testid="honesty-block"
	>
		<p class="font-display text-sm uppercase tracking-[0.15em] text-[var(--color-overage-red)]">
			What it doesn't do (yet)
		</p>
		<p class="mt-3 max-w-2xl text-[var(--color-text-muted)]">
			No Copilot or Cursor connectors. No teams. No hosted signup — this instance prices one operator's
			practice. The last version of this page claimed more than the code did; this one doesn't.
		</p>
	</section>

	<!-- The one primary CTA. -->
	<section
		class="mb-16 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-8"
		data-testid="waitlist"
	>
		<h2 class="font-display text-2xl font-semibold text-[var(--color-text)]">Want this for your practice?</h2>

		{#if formState === 'success'}
			<p class="mt-4 text-[var(--color-savings-green)]" data-testid="waitlist-success">
				Got it — you're on the list.
			</p>
		{:else}
			<form class="mt-6 max-w-md" onsubmit={handleSubmit} data-testid="waitlist-form">
				<label class="block text-sm text-[var(--color-text-muted)]" for="waitlist-email">Email</label>
				<input
					id="waitlist-email"
					name="email"
					type="email"
					required
					autocomplete="email"
					bind:value={email}
					class="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)]"
				/>

				<label class="mt-4 block text-sm text-[var(--color-text-muted)]" for="waitlist-note">
					What would you price first? (optional)
				</label>
				<textarea
					id="waitlist-note"
					name="note"
					bind:value={note}
					rows="3"
					class="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)]"
				></textarea>

				<div class="cf-turnstile mt-4" data-sitekey={turnstileSiteKey} data-theme="dark"></div>

				{#if formState === 'error'}
					<p class="mt-3 text-sm text-[var(--color-overage-red)]" data-testid="waitlist-error">{errorMessage}</p>
				{/if}

				<button
					type="submit"
					class="cta-primary mt-5"
					data-primary-cta
					disabled={formState === 'submitting'}
				>
					{formState === 'submitting' ? 'Joining…' : 'Join the waitlist'}
				</button>
			</form>
		{/if}
	</section>

	<footer class="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)] pt-8 text-sm text-[var(--color-text-muted)]">
		<p>Built in the open by Signal x Studio. QuantifAI is the instrument it measures itself with.</p>
		<a href={resolve('/ledger')} class="text-[var(--color-usage-blue)] hover:underline">Operator sign-in</a>
	</footer>
</div>

<style>
	.cta-primary {
		border-radius: 0.5rem;
		background: var(--color-gold);
		color: #14110a;
		font-weight: 600;
		padding: 0.625rem 1.25rem;
		border: none;
		cursor: pointer;
	}
	.cta-primary:hover:not(:disabled) {
		background: var(--color-gold-dark);
	}
	.cta-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
