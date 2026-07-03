import { describe, it, expect } from 'vitest';
import { normalizeCostReport, anthropicProvider, hasNoCompleteDayToFetch, type CostReport } from './anthropic';

// Fixture shaped exactly like the documented Anthropic Cost Report response
// (platform.claude.com/docs/en/api/admin/cost_report, checked 2026-07-03).
const FIXTURE: CostReport = {
	data: [
		{
			starting_at: '2026-07-01T00:00:00Z',
			ending_at: '2026-07-02T00:00:00Z',
			results: [
				{ amount: '1.500000', currency: 'USD', workspace_id: 'wrkspc_abc' },
				{ amount: '0.250000', currency: 'USD', workspace_id: null }
			]
		},
		{
			starting_at: '2026-07-02T00:00:00Z',
			ending_at: '2026-07-03T00:00:00Z',
			results: [{ amount: '2.000000', currency: 'USD', workspace_id: 'wrkspc_abc' }]
		}
	],
	has_more: false,
	next_page: null
};

describe('normalizeCostReport — Anthropic adapter boundary parsing', () => {
	it('normalizes one row per (date, workspace), using the "org" sentinel when workspace_id is null', () => {
		const rows = normalizeCostReport(FIXTURE);
		expect(rows).toHaveLength(3);
		expect(rows).toContainEqual(
			expect.objectContaining({ provider: 'anthropic', date: '2026-07-01', workspaceOrKey: 'wrkspc_abc', amountUsd: 0.015 })
		);
		expect(rows).toContainEqual(
			expect.objectContaining({ provider: 'anthropic', date: '2026-07-01', workspaceOrKey: 'org', amountUsd: 0.0025 })
		);
		expect(rows).toContainEqual(
			expect.objectContaining({ provider: 'anthropic', date: '2026-07-02', workspaceOrKey: 'wrkspc_abc', amountUsd: 0.02 })
		);
	});

	it('reads the amount as lowest-currency-units (cents), matching the documented field semantics and a live-verified backfill (2026-07-03: undivided read was ~100x the operator\'s real invoice range)', () => {
		const rows = normalizeCostReport(FIXTURE);
		const row = rows.find((r) => r.date === '2026-07-01' && r.workspaceOrKey === 'wrkspc_abc');
		// "1.500000" cents -> $0.015, not $1.50 (which a direct-USD interpretation would produce).
		expect(row?.amountUsd).toBeCloseTo(0.015, 6);
	});

	it('sums multiple result rows defensively when more than one result shares (date, workspace)', () => {
		const withDuplicateGrouping: CostReport = {
			data: [
				{
					starting_at: '2026-07-01T00:00:00Z',
					ending_at: '2026-07-02T00:00:00Z',
					results: [
						{ amount: '1.00', currency: 'USD', workspace_id: 'w1' },
						{ amount: '2.00', currency: 'USD', workspace_id: 'w1' }
					]
				}
			],
			has_more: false,
			next_page: null
		};
		const rows = normalizeCostReport(withDuplicateGrouping);
		expect(rows).toHaveLength(1);
		expect(rows[0].amountUsd).toBeCloseTo(0.03, 6);
	});

	it('skips a malformed amount rather than guessing', () => {
		const malformed: CostReport = {
			data: [
				{
					starting_at: '2026-07-01T00:00:00Z',
					ending_at: '2026-07-02T00:00:00Z',
					results: [{ amount: 'not-a-number', currency: 'USD', workspace_id: 'w1' }]
				}
			],
			has_more: false,
			next_page: null
		};
		expect(normalizeCostReport(malformed)).toHaveLength(0);
	});
});

describe('hasNoCompleteDayToFetch — same-day re-sync guard (verified live 2026-07-03)', () => {
	it('is true when sinceIso falls within the same UTC day as now — no complete day-bucket exists yet', () => {
		expect(hasNoCompleteDayToFetch('2026-07-03T20:35:14.031Z', new Date('2026-07-03T20:47:00.000Z'))).toBe(true);
	});

	it('is false when sinceIso is on a prior UTC day — at least one complete day-bucket can be requested', () => {
		expect(hasNoCompleteDayToFetch('2026-07-02T20:35:14.031Z', new Date('2026-07-03T20:47:00.000Z'))).toBe(false);
	});
});

describe('anthropicProvider.isConnected — DESIGN.md rule 7 gate', () => {
	it('is connected when ANTHROPIC_ADMIN_API_KEY is present', () => {
		expect(anthropicProvider.isConnected({ ANTHROPIC_ADMIN_API_KEY: 'sk-ant-admin01-x' })).toBe(true);
	});

	it('is not connected when the secret is absent — never treated as an error', () => {
		expect(anthropicProvider.isConnected({})).toBe(false);
	});
});
