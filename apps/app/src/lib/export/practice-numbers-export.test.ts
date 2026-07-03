import { describe, it, expect } from 'vitest';
import { buildPracticeNumbersMarkdown, buildPracticeNumbersCsv } from './practice-numbers-export';
import type { PracticeNumbersData } from '../practice-numbers-shared';

const BASE: PracticeNumbersData = {
	window: { label: '30', days: 30, sinceIso: '2026-06-03T00:00:00.000Z' },
	asOf: '2026-07-03T12:00:00.000Z',
	amortizationConfigured: true,
	projects: [
		{
			unit_id: 'u1',
			kind: 'initiative',
			name: 'quantifai-next',
			project_path: '/Users/nino/Workspace/dev/wip/quantifai-next',
			session_count: 12,
			estimated_cost: 45.5,
			amortized_cost: 30.0,
			amortized_covered_sessions: 12,
			amortized_interactive_sessions: 12,
			commit_count: 8,
			merge_count: 2
		}
	],
	rates: {
		weeks: 4.2857,
		commits_per_week: 1.87,
		merges_per_week: 0.47,
		sessions_per_week: 2.8,
		estimated_cost_per_week: 10.62,
		amortized_cost_per_week: 7.0,
		api_metered_cost_per_week: 3.5,
		actual_spend_per_week: 10.5,
		deploys_per_week: null
	}
};

describe('buildPracticeNumbersMarkdown', () => {
	it('includes the as-of date, window label, and both provenance columns', () => {
		const md = buildPracticeNumbersMarkdown(BASE);
		expect(md).toContain('As of 2026-07-03T12:00:00.000Z');
		expect(md).toContain('last 30 days');
		expect(md).toContain('quantifai-next');
		expect(md).toContain('$45.5'.slice(0, 4)); // sanity: dollar figure present
		expect(md).toMatch(/Cost \(estimated\)/);
		expect(md).toMatch(/Cost \(amortized\)/);
	});

	it('never sums the estimated and amortized figures into one total', () => {
		const md = buildPracticeNumbersMarkdown(BASE);
		expect(md).not.toContain('75.5'); // 45.5 + 30 would be the wrong, summed figure
	});

	it('renders "not instrumented" for deploys/week, never a merge-count proxy', () => {
		const md = buildPracticeNumbersMarkdown(BASE);
		expect(md).toContain('| Deploys/week | not instrumented |');
	});

	it('carries a one-line methodology note for every practice-level rate', () => {
		const md = buildPracticeNumbersMarkdown(BASE);
		expect(md).toContain('divided by weeks in the window');
		expect(md).toContain('2+ parents');
	});

	it('renders the amortization-unconfigured message instead of a bare number when unconfigured', () => {
		const unconfigured: PracticeNumbersData = {
			...BASE,
			amortizationConfigured: false,
			rates: { ...BASE.rates, amortized_cost_per_week: null }
		};
		const md = buildPracticeNumbersMarkdown(unconfigured);
		expect(md).toContain('amortization unconfigured — set your plan fee');
		expect(md).toContain('unconfigured |'); // per-project cell
	});

	it('renders an honest empty-window row rather than omitting the table entirely', () => {
		const empty: PracticeNumbersData = { ...BASE, projects: [] };
		const md = buildPracticeNumbersMarkdown(empty);
		expect(md).toContain('_no activity in this window_');
	});
});

describe('buildPracticeNumbersCsv', () => {
	it('produces a header row plus one row per project with both provenance columns', () => {
		const csv = buildPracticeNumbersCsv(BASE);
		const lines = csv.trim().split('\n');
		expect(lines[0]).toBe(
			'unit,kind,project_path,sessions,estimated_cost_usd,amortized_cost_usd,amortized_covered_sessions,amortized_interactive_sessions,commits,merges'
		);
		expect(lines[1]).toBe(
			'quantifai-next,initiative,/Users/nino/Workspace/dev/wip/quantifai-next,12,45.50,30.00,12,12,8,2'
		);
	});

	it('quotes fields containing commas', () => {
		const withComma: PracticeNumbersData = {
			...BASE,
			projects: [{ ...BASE.projects[0], name: 'foo, bar' }]
		};
		const csv = buildPracticeNumbersCsv(withComma);
		expect(csv).toContain('"foo, bar"');
	});

	it('renders an empty-body CSV (header only) when there is no activity in the window', () => {
		const empty: PracticeNumbersData = { ...BASE, projects: [] };
		const csv = buildPracticeNumbersCsv(empty);
		expect(csv.trim().split('\n')).toHaveLength(1);
	});
});
