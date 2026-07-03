<script lang="ts">
	import { formatUsd } from '$lib/format';
	import { METHODOLOGY, type PracticeNumbersData } from '$lib/practice-numbers-shared';
	import { buildPracticeNumbersMarkdown, buildPracticeNumbersCsv } from '$lib/export/practice-numbers-export';
	import { resolve } from '$app/paths';

	let { data }: { data: PracticeNumbersData } = $props();

	const isEmpty = $derived(data.projects.length === 0);

	const WINDOW_OPTIONS: Array<{ label: '30' | '90' | 'all'; text: string }> = [
		{ label: '30', text: 'Last 30 days' },
		{ label: '90', text: 'Last 90 days' },
		{ label: 'all', text: 'All time' }
	];

	function amortizedCell(row: PracticeNumbersData['projects'][number]): string {
		if (!data.amortizationConfigured || row.amortized_interactive_sessions === 0) return 'unconfigured';
		return `${formatUsd(row.amortized_cost)} (${row.amortized_covered_sessions}/${row.amortized_interactive_sessions})`;
	}

	function downloadFile(filename: string, content: string, mimeType: string) {
		const blob = new Blob([content], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	function handleExport() {
		const suffix = data.window.label;
		downloadFile(`practice-numbers-${suffix}.md`, buildPracticeNumbersMarkdown(data), 'text/markdown');
		downloadFile(`practice-numbers-${suffix}.csv`, buildPracticeNumbersCsv(data), 'text/csv');
	}
</script>

<div class="mx-auto max-w-5xl px-6 py-12">
	<header class="mb-10 flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="font-display text-sm uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
				QuantifAI — practice numbers
			</p>
			<h1 class="font-display mt-2 text-2xl font-semibold text-[var(--color-text)]">
				The positioning-bracket export
			</h1>
			<a href={resolve('/')} class="mt-3 inline-block text-sm text-[var(--color-usage-blue)] hover:underline">
				&larr; Back to ledger
			</a>
		</div>
		<button
			type="button"
			class="cta-primary"
			data-primary-cta
			disabled={isEmpty}
			onclick={handleExport}
		>
			Export numbers
		</button>
	</header>

	<nav class="mb-8 flex gap-2 text-sm" data-testid="window-nav">
		{#each WINDOW_OPTIONS as option (option.label)}
			<a
				href={resolve(`/practice-numbers?window=${option.label}`)}
				class="rounded-full border px-3 py-1"
				style={data.window.label === option.label
					? 'border-color: var(--color-gold); color: var(--color-gold);'
					: 'border-color: var(--color-border); color: var(--color-text-muted);'}
			>
				{option.text}
			</a>
		{/each}
	</nav>

	<p class="mb-6 text-xs text-[var(--color-text-muted)]" data-testid="as-of">
		As of {new Date(data.asOf).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		})}
	</p>

	{#if isEmpty}
		<section
			class="flex flex-col items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-16 text-center"
			data-testid="empty-state"
		>
			<div class="text-4xl" aria-hidden="true">◎</div>
			<p class="max-w-md text-[var(--color-text-muted)]">
				No sessions or commits fall inside this window yet. Widen the window or ingest more history
				— the export button stays available, it will just carry an empty table.
			</p>
		</section>
	{:else}
		<section class="mt-2" data-testid="project-table">
			<h2 class="font-display text-sm uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
				Per-project / per-initiative
			</h2>
			<div class="mt-4 overflow-x-auto rounded-lg border border-[var(--color-border)]">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
							<th class="px-4 py-3 font-normal">Unit of work</th>
							<th class="px-4 py-3 font-normal">Sessions</th>
							<th class="px-4 py-3 font-normal">Cost (estimated)</th>
							<th class="px-4 py-3 font-normal">Cost (amortized)</th>
							<th class="px-4 py-3 font-normal">Commits</th>
							<th class="px-4 py-3 font-normal">Merges</th>
						</tr>
					</thead>
					<tbody>
						{#each data.projects as row (row.unit_id)}
							<tr class="border-b border-[var(--color-border)] last:border-0">
								<td class="px-4 py-3">
									<div class="text-[var(--color-text)]">{row.name}</div>
									<div class="text-xs text-[var(--color-text-muted)]">{row.kind}</div>
								</td>
								<td class="metric-number px-4 py-3 text-[var(--color-text)]">{row.session_count}</td>
								<td class="metric-number px-4 py-3 text-[var(--color-gold)]">{formatUsd(row.estimated_cost)}</td>
								<td class="metric-number px-4 py-3 text-[var(--color-usage-blue)]">{amortizedCell(row)}</td>
								<td class="metric-number px-4 py-3 text-[var(--color-text)]">{row.commit_count}</td>
								<td class="metric-number px-4 py-3 text-[var(--color-text)]">{row.merge_count}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<section class="mt-10" data-testid="practice-rates">
		<h2 class="font-display text-sm uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
			Practice-level rates &middot; {data.rates.weeks.toFixed(1)} weeks
		</h2>
		<div class="mt-4 overflow-x-auto rounded-lg border border-[var(--color-border)]">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
						<th class="px-4 py-3 font-normal">Metric</th>
						<th class="px-4 py-3 font-normal">Value</th>
						<th class="px-4 py-3 font-normal">Methodology</th>
					</tr>
				</thead>
				<tbody>
					<tr class="border-b border-[var(--color-border)]">
						<td class="px-4 py-3 text-[var(--color-text)]">Commits/week</td>
						<td class="metric-number px-4 py-3 text-[var(--color-text)]">{data.rates.commits_per_week.toFixed(1)}</td>
						<td class="px-4 py-3 text-xs text-[var(--color-text-muted)]">{METHODOLOGY.commits}</td>
					</tr>
					<tr class="border-b border-[var(--color-border)]">
						<td class="px-4 py-3 text-[var(--color-text)]">Merges/week</td>
						<td class="metric-number px-4 py-3 text-[var(--color-text)]">{data.rates.merges_per_week.toFixed(1)}</td>
						<td class="px-4 py-3 text-xs text-[var(--color-text-muted)]">{METHODOLOGY.merges}</td>
					</tr>
					<tr class="border-b border-[var(--color-border)]">
						<td class="px-4 py-3 text-[var(--color-text)]">Sessions/week</td>
						<td class="metric-number px-4 py-3 text-[var(--color-text)]">{data.rates.sessions_per_week.toFixed(1)}</td>
						<td class="px-4 py-3 text-xs text-[var(--color-text-muted)]">{METHODOLOGY.sessions}</td>
					</tr>
					<tr class="border-b border-[var(--color-border)]">
						<td class="px-4 py-3 text-[var(--color-text)]">Cost/week (estimated)</td>
						<td class="metric-number px-4 py-3 text-[var(--color-gold)]">{formatUsd(data.rates.estimated_cost_per_week)}</td>
						<td class="px-4 py-3 text-xs text-[var(--color-text-muted)]">{METHODOLOGY.estimatedCostPerWeek}</td>
					</tr>
					<tr class="border-b border-[var(--color-border)]">
						<td class="px-4 py-3 text-[var(--color-text)]">Cost/week (amortized)</td>
						<td class="metric-number px-4 py-3 text-[var(--color-usage-blue)]" data-testid="amortized-rate">
							{#if data.rates.amortized_cost_per_week === null}
								<span class="text-xs text-[var(--color-text-muted)]">unconfigured — set your plan fee</span>
							{:else}
								{formatUsd(data.rates.amortized_cost_per_week)}
							{/if}
						</td>
						<td class="px-4 py-3 text-xs text-[var(--color-text-muted)]">{METHODOLOGY.amortizedCostPerWeek}</td>
					</tr>
					<tr>
						<td class="px-4 py-3 text-[var(--color-text)]">Deploys/week</td>
						<td class="px-4 py-3 text-[var(--color-text-muted)]" data-testid="deploys-not-instrumented">not instrumented</td>
						<td class="px-4 py-3 text-xs text-[var(--color-text-muted)]">{METHODOLOGY.deploysPerWeek}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>
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
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
