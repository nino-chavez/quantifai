<script lang="ts">
	import {
		formatUsd,
		provenanceMixLabel,
		formatCommitCount,
		formatSessionCount,
		dominantProvenance,
		amortizedCoverageLabel
	} from '$lib/format';
	import { resolve } from '$app/paths';
	import type { LedgerData, UnitOfWorkRow } from '$lib/server/ledger';

	let { data }: { data: LedgerData } = $props();

	const isEmpty = $derived(data.units.length === 0);
	const topUnits = $derived(data.units.slice(0, 5));
	const maxCost = $derived(Math.max(1, ...topUnits.map((u) => u.total_cost)));

	function kindLabel(kind: UnitOfWorkRow['kind']): string {
		return kind === 'initiative' ? 'Initiative' : kind === 'project' ? 'Project' : 'Session';
	}

	function lastActive(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<div class="mx-auto max-w-5xl px-6 py-12">
	<header class="mb-10">
		<p class="font-display text-sm uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
			QuantifAI — practice ledger
		</p>
		<h1 class="font-display mt-2 text-2xl font-semibold text-[var(--color-text)]">
			What your practice cost, and what it produced
		</h1>
		<a
			href={resolve('/practice-numbers')}
			class="mt-3 inline-block text-sm text-[var(--color-usage-blue)] hover:underline"
		>
			Practice numbers — rates, per-project export →
		</a>
	</header>

	{#if isEmpty}
		<section
			class="flex flex-col items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-16 text-center"
			data-testid="empty-state"
		>
			<div class="text-4xl" aria-hidden="true">◎</div>
			<p class="max-w-md text-[var(--color-text-muted)]">
				No sessions ingested yet. The ledger fills in once you point it at a Claude Code session
				history — each initiative and project you work in becomes a row, priced by real token usage.
			</p>
			<button type="button" class="cta-primary" data-primary-cta>
				Point at your sessions
			</button>
			<p class="text-xs text-[var(--color-text-muted)]">
				Run <code class="metric-number">npm run import:claude</code> to ingest
				<code class="metric-number">~/.claude/projects</code>, then reload.
			</p>
		</section>
	{:else}
		<!-- Practice hero total (DESIGN.md rule 1: provenance on every dollar). -->
		<section
			class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-8"
			data-testid="hero"
		>
			<div class="flex flex-wrap gap-10">
				<div>
					<p class="text-sm text-[var(--color-text-muted)]">Estimated, all time (API-equivalent)</p>
					<p class="metric-number font-display mt-1 text-5xl font-semibold text-[var(--color-gold)]">
						{formatUsd(data.totals.total_cost)}
					</p>
					<span class="provenance-badge provenance-badge--estimated mt-2">estimated</span>
				</div>
				<div data-testid="hero-amortized">
					<p class="text-sm text-[var(--color-text-muted)]">Amortized, all time (your subscription cost)</p>
					{#if data.totals.amortization_configured}
						<p class="metric-number font-display mt-1 text-5xl font-semibold text-[var(--color-usage-blue)]">
							{formatUsd(data.totals.amortized_cost)}
						</p>
						<span class="provenance-badge provenance-badge--subscription_amortized mt-2">
							subscription amortized
						</span>
					{:else}
						<p class="mt-1 max-w-xs text-sm text-[var(--color-text-muted)]" data-testid="amortization-empty">
							Amortization unconfigured — set your plan fee with
							<code class="metric-number">npm run seed:plan</code>.
						</p>
					{/if}
					<p class="mt-2 text-xs text-[var(--color-text-muted)]">
						{amortizedCoverageLabel(data.totals)}
					</p>
				</div>
			</div>
			<p class="mt-4 text-sm text-[var(--color-text-muted)]">
				{provenanceMixLabel(data.totals)} · {formatSessionCount(data.totals.total_sessions)} across
				{data.units.length}
				{data.units.length === 1 ? 'unit of work' : 'units of work'} · {formatCommitCount(
					data.totals.total_commits
				)}
			</p>
		</section>

		<!-- Cost-vs-output strip (DESIGN.md L3: the "so what" organism — cost beside output per unit). -->
		<section class="mt-8" data-testid="cost-vs-output-strip">
			<h2 class="font-display text-sm uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
				Cost vs. output — top units
			</h2>
			<ul class="mt-4 space-y-3">
				{#each topUnits as unit (unit.unit_id)}
					<li class="flex items-center gap-4">
						<span class="w-40 shrink-0 truncate text-sm text-[var(--color-text)]" title={unit.name}>
							{unit.name}
						</span>
						<span class="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
							<span
								class="absolute inset-y-0 left-0 rounded-full bg-[var(--color-gold)]"
								style={`width: ${Math.max(4, (unit.total_cost / maxCost) * 100)}%`}
							></span>
						</span>
						<span class="metric-number w-24 shrink-0 text-right text-sm text-[var(--color-gold)]">
							{formatUsd(unit.total_cost)}
						</span>
						<span class="w-32 shrink-0 text-right text-xs text-[var(--color-text-muted)]">
							{formatCommitCount(unit.commit_count)}
						</span>
					</li>
				{/each}
			</ul>
		</section>

		<!-- Unit-of-work ledger table (DESIGN.md L3 organism). -->
		<section class="mt-10" data-testid="ledger-table">
			<h2 class="font-display text-sm uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
				Unit-of-work ledger
			</h2>
			<div class="mt-4 overflow-x-auto rounded-lg border border-[var(--color-border)]">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
							<th class="px-4 py-3 font-normal">Unit of work</th>
							<th class="px-4 py-3 font-normal">Sessions</th>
							<th class="px-4 py-3 font-normal">Cost (estimated)</th>
							<th class="px-4 py-3 font-normal">Provenance</th>
							<th class="px-4 py-3 font-normal">Cost (amortized)</th>
							<th class="px-4 py-3 font-normal">Output (commits)</th>
							<th class="px-4 py-3 font-normal">Last active</th>
						</tr>
					</thead>
					<tbody>
						{#each data.units as unit (unit.unit_id)}
							<tr class="border-b border-[var(--color-border)] last:border-0">
								<td class="px-4 py-3">
									<div class="text-[var(--color-text)]">{unit.name}</div>
									<div class="text-xs text-[var(--color-text-muted)]">{kindLabel(unit.kind)}</div>
								</td>
								<td class="metric-number px-4 py-3 text-[var(--color-text)]">{unit.session_count}</td>
								<td class="metric-number px-4 py-3 text-[var(--color-gold)]">{formatUsd(unit.total_cost)}</td>
								<td class="px-4 py-3">
									{#if dominantProvenance(unit)}
										<span class="provenance-badge provenance-badge--{dominantProvenance(unit)}">
											{dominantProvenance(unit)?.replace('_', ' ')}
										</span>
									{:else}
										<span class="text-xs text-[var(--color-text-muted)]">{provenanceMixLabel(unit)}</span>
									{/if}
								</td>
								<td class="px-4 py-3">
									{#if data.totals.amortization_configured && unit.amortized_interactive_sessions > 0}
										<span class="metric-number text-[var(--color-usage-blue)]">
											{formatUsd(unit.amortized_cost)}
										</span>
										<div class="text-xs text-[var(--color-text-muted)]">
											{unit.amortized_covered_sessions}/{unit.amortized_interactive_sessions} sessions covered
										</div>
									{:else}
										<span class="text-xs text-[var(--color-text-muted)]">unconfigured</span>
									{/if}
								</td>
								<td class="metric-number px-4 py-3 text-[var(--color-text)]">{unit.commit_count}</td>
								<td class="px-4 py-3 text-[var(--color-text-muted)]">{lastActive(unit.last_session_at)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
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
	.cta-primary:hover {
		background: var(--color-gold-dark);
	}
</style>
