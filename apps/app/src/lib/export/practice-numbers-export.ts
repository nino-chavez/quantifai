/**
 * Pure markdown/CSV builders for the practice-numbers export — the
 * positioning-bracket export (research/personas/solo-operator.md JTBD-3:
 * "exportable as of a date, with methodology attached"). No DOM/fetch
 * dependency, so this is unit-testable directly and reusable from the
 * Svelte component's click handler (browser download) or a script/test that
 * wants the real generated content.
 */

import { formatUsd, formatCommitCell } from '../format';
import { METHODOLOGY, type PracticeNumbersData, type ProjectRow } from '../practice-numbers-shared';

function windowLabel(data: PracticeNumbersData): string {
	if (data.window.label === 'all') return 'all time';
	return `last ${data.window.label} days`;
}

function amortizedCell(row: ProjectRow, amortizationConfigured: boolean): string {
	if (!amortizationConfigured || row.amortized_interactive_sessions === 0) return 'unconfigured';
	return `${formatUsd(row.amortized_cost)} (${row.amortized_covered_sessions}/${row.amortized_interactive_sessions} sessions covered)`;
}

function amortizedRateCell(data: PracticeNumbersData): string {
	if (data.rates.amortized_cost_per_week === null) {
		return 'amortization unconfigured — set your plan fee';
	}
	return `${formatUsd(data.rates.amortized_cost_per_week)}/week`;
}

export function buildPracticeNumbersMarkdown(data: PracticeNumbersData): string {
	const lines: string[] = [];
	lines.push('# QuantifAI — practice numbers');
	lines.push('');
	lines.push(`As of ${data.asOf} · window: ${windowLabel(data)}`);
	lines.push('');
	lines.push('## Per-project / per-initiative');
	lines.push('');
	lines.push('| Unit | Kind | Sessions | Cost (estimated) | Cost (amortized) | Commits | Merges |');
	lines.push('|---|---|---|---|---|---|---|');
	if (data.projects.length === 0) {
		lines.push('| _no activity in this window_ | | | | | | |');
	} else {
		for (const row of data.projects) {
			lines.push(
				`| ${row.name} | ${row.kind} | ${row.session_count} | ${formatUsd(row.estimated_cost)} | ${amortizedCell(row, data.amortizationConfigured)} | ${formatCommitCell(row.commit_count, row.deterministic_commit_count)} | ${row.merge_count} |`
			);
		}
	}
	lines.push('');
	lines.push(`## Practice-level rates (${windowLabel(data)}, ${data.rates.weeks.toFixed(1)} weeks)`);
	lines.push('');
	lines.push('| Metric | Value | Methodology |');
	lines.push('|---|---|---|');
	lines.push(`| Commits/week | ${data.rates.commits_per_week.toFixed(1)} | ${METHODOLOGY.commits} |`);
	lines.push(`| Merges/week | ${data.rates.merges_per_week.toFixed(1)} | ${METHODOLOGY.merges} |`);
	lines.push(`| Sessions/week | ${data.rates.sessions_per_week.toFixed(1)} | ${METHODOLOGY.sessions} |`);
	lines.push(
		`| Cost/week (estimated) | ${formatUsd(data.rates.estimated_cost_per_week)}/week | ${METHODOLOGY.estimatedCostPerWeek} |`
	);
	lines.push(`| Cost/week (amortized) | ${amortizedRateCell(data)} | ${METHODOLOGY.amortizedCostPerWeek} |`);
	lines.push(
		`| Cost/week (API metered) | ${formatUsd(data.rates.api_metered_cost_per_week)}/week | ${METHODOLOGY.apiMeteredCostPerWeek} |`
	);
	lines.push(
		`| Actual spend/week | ${formatUsd(data.rates.actual_spend_per_week)}/week | ${METHODOLOGY.actualSpendPerWeek} |`
	);
	lines.push(`| Deploys/week | not instrumented | ${METHODOLOGY.deploysPerWeek} |`);
	lines.push('');
	lines.push(
		'_Estimated cost is a list-price token valuation on subscription usage, not a metered bill. Amortized cost spreads the operator-entered subscription plan fee across a calendar month'
	);
	lines.push(
		'by each session\'s share of input+output tokens; API-metered usage (from provider cost APIs, src/lib/providers/) is out of scope for amortization. Amortized and API-metered cost are both real spend and compose into "actual spend"; estimated cost never sums with either._'
	);
	return lines.join('\n') + '\n';
}

export function buildPracticeNumbersCsv(data: PracticeNumbersData): string {
	const escape = (value: string | number): string => {
		const s = String(value);
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};

	const header = [
		'unit',
		'kind',
		'project_path',
		'sessions',
		'estimated_cost_usd',
		'amortized_cost_usd',
		'amortized_covered_sessions',
		'amortized_interactive_sessions',
		'commits',
		'commits_deterministic',
		'merges'
	];

	const rows = data.projects.map((row) =>
		[
			row.name,
			row.kind,
			row.project_path,
			row.session_count,
			row.estimated_cost.toFixed(2),
			row.amortized_cost.toFixed(2),
			row.amortized_covered_sessions,
			row.amortized_interactive_sessions,
			row.commit_count,
			row.deterministic_commit_count,
			row.merge_count
		]
			.map(escape)
			.join(',')
	);

	return [header.join(','), ...rows].join('\n') + '\n';
}
