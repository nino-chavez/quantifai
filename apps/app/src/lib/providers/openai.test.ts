import { describe, it, expect } from 'vitest';
import { normalizeOpenAiCostPage, openaiProvider, type OpenAiCostPage } from './openai';

const FIXTURE: OpenAiCostPage = {
	data: [
		{
			start_time: 1751328000, // 2025-07-01T00:00:00Z
			end_time: 1751414400,
			results: [
				{ amount: { value: 4.2, currency: 'usd' }, project_id: 'proj_1' },
				{ amount: { value: 0.8, currency: 'usd' }, project_id: null }
			]
		}
	],
	has_more: false,
	next_page: null
};

describe('normalizeOpenAiCostPage — OpenAI adapter boundary parsing (disabled, code-complete)', () => {
	it('normalizes one row per (date, project), using the "org" sentinel when project_id is null', () => {
		const rows = normalizeOpenAiCostPage(FIXTURE);
		expect(rows).toHaveLength(2);
		expect(rows).toContainEqual(
			expect.objectContaining({ provider: 'openai', date: '2025-07-01', workspaceOrKey: 'proj_1', amountUsd: 4.2 })
		);
		expect(rows).toContainEqual(
			expect.objectContaining({ provider: 'openai', date: '2025-07-01', workspaceOrKey: 'org', amountUsd: 0.8 })
		);
	});

	it('uppercases the currency code for schema consistency with the Anthropic adapter', () => {
		const rows = normalizeOpenAiCostPage(FIXTURE);
		expect(rows.every((r) => r.currency === 'USD')).toBe(true);
	});
});

describe('openaiProvider — disabled-provider state (DESIGN.md rule 7)', () => {
	it('is not connected without OPENAI_ADMIN_API_KEY', () => {
		expect(openaiProvider.isConnected({})).toBe(false);
	});

	it('is connected once the secret exists', () => {
		expect(openaiProvider.isConnected({ OPENAI_ADMIN_API_KEY: 'sk-admin-x' })).toBe(true);
	});

	it('throws (rather than silently returning empty) if fetchWindow is somehow called while disconnected', async () => {
		await expect(openaiProvider.fetchWindow({ sinceIso: '2026-01-01T00:00:00Z' }, {})).rejects.toThrow(
			/OPENAI_ADMIN_API_KEY/
		);
	});
});
