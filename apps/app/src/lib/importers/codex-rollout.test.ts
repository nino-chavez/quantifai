import { describe, it, expect } from 'vitest';
import { parseCodexRollout, normalizeOriginator } from './codex-rollout';

const meta = (id = 'sess-1') =>
	JSON.stringify({ type: 'session_meta', timestamp: '2026-10-01T00:00:00Z', payload: { id, cwd: '/repo', originator: 'Codex Desktop' } });
const ctx = (model: string) => JSON.stringify({ type: 'turn_context', timestamp: '2026-10-01T00:00:01Z', payload: { model, cwd: '/repo' } });
const total = (ts: string, input: number, cached: number, output: number) =>
	JSON.stringify({
		type: 'event_msg',
		timestamp: ts,
		payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output } } }
	});
const record = (ts: string, id: string, input: number, cached: number, output: number) =>
	JSON.stringify({
		type: 'token_usage_record',
		timestamp: ts,
		payload: { session_id: 'sess-1', response_id: id, usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output } }
	});
const tool = (name: string) => JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name } });

const sum = (r: ReturnType<typeof parseCodexRollout>, k: 'inputTokens' | 'cacheReadTokens' | 'outputTokens') =>
	r.messages.reduce((s, m) => s + m[k], 0);

describe('parseCodexRollout', () => {
	it('uses per-response records when present and never adds the running total on top', () => {
		const r = parseCodexRollout([
			meta(),
			ctx('gpt-6-astra'),
			record('t1', 'resp_a', 100, 60, 10),
			total('t1', 100, 60, 10),
			record('t2', 'resp_b', 200, 150, 20),
			total('t2', 300, 210, 30)
		]);
		expect(r.source).toBe('records');
		expect(r.messages.map((m) => m.messageId)).toEqual(['resp_a', 'resp_b']);
		// Anthropic-shaped split: uncached input, cache reads separate.
		expect(sum(r, 'inputTokens')).toBe(300 - 210);
		expect(sum(r, 'cacheReadTokens')).toBe(210);
		expect(sum(r, 'outputTokens')).toBe(30);
	});

	it('keeps a compaction call the running total omits (records exceed the total)', () => {
		const r = parseCodexRollout([
			meta(),
			ctx('gpt-6-astra'),
			record('t1', 'resp_a', 100, 0, 10),
			total('t1', 100, 0, 10),
			JSON.stringify({ type: 'compacted', payload: {} }),
			record('t2', 'resp_compact', 5000, 0, 50), // no matching total increase
			total('t2', 100, 0, 10)
		]);
		expect(r.source).toBe('records');
		expect(r.recordsInputTokens).toBe(5100);
		expect(r.runningTotalInputTokens).toBe(100);
	});

	it('derives per-turn usage from running-total deltas, treating a drop as a reset', () => {
		const r = parseCodexRollout([
			meta(),
			ctx('gpt-5.6-terra'),
			total('t1', 100, 50, 10),
			total('t2', 100, 50, 10), // repeat: adds nothing
			total('t3', 250, 120, 25),
			total('t4', 40, 10, 5) // reset on resume: counts from zero
		]);
		expect(r.source).toBe('running_total');
		expect(r.messages).toHaveLength(3);
		expect(sum(r, 'inputTokens') + sum(r, 'cacheReadTokens')).toBe(250 + 40);
		expect(sum(r, 'outputTokens')).toBe(25 + 5);
		expect(r.messages[0].messageId).toMatch(/^codex:sess-1:line\d+$/);
	});

	it('falls back to the running total when records cover less (session began before records existed)', () => {
		const r = parseCodexRollout([meta(), ctx('gpt-6-sol'), total('t1', 1000, 0, 100), record('t2', 'resp_late', 50, 0, 5), total('t2', 1050, 0, 105)]);
		expect(r.source).toBe('running_total');
		expect(sum(r, 'inputTokens')).toBe(1050);
	});

	it('prices by the model in effect at each turn and counts unpriced tokens', () => {
		const r = parseCodexRollout([meta(), ctx('codex-auto-review'), record('t1', 'resp_a', 1_000_000, 0, 0), ctx('gpt-6-luna'), record('t2', 'resp_b', 1_000_000, 0, 0)]);
		expect(r.messages[0].costUsd).toBe(0);
		expect(r.messages[1].costUsd).toBeCloseTo(0.1, 6);
		expect(r.unpricedTokens).toBe(1_000_000);
	});

	it('carries session metadata, tool names, and survives a torn line', () => {
		const r = parseCodexRollout([meta('sess-9'), ctx('gpt-6-astra'), tool('shell'), tool('apply_patch'), record('t1', 'resp_a', 10, 0, 1), '{"type":"tok']);
		expect(r.sessionId).toBe('sess-9');
		expect(r.editor).toBe('codex-desktop');
		expect(r.messages[0].toolNames.sort()).toEqual(['apply_patch', 'shell']);
	});

	it('attributes usage logged before the first turn_context to the first model named', () => {
		const r = parseCodexRollout([meta(), record('t0', 'resp_early', 100, 0, 10), ctx('gpt-6-astra'), record('t1', 'resp_a', 100, 0, 10)]);
		expect(r.messages.map((m) => m.model)).toEqual(['gpt-6-astra', 'gpt-6-astra']);
		expect(r.unpricedTokens).toBe(0);
	});

	it('reports none for a rollout with no usage', () => {
		expect(parseCodexRollout([meta(), ctx('gpt-6-astra')]).source).toBe('none');
	});
});

describe('normalizeOriginator', () => {
	it('normalizes the observed originators', () => {
		expect(normalizeOriginator('Codex Desktop')).toBe('codex-desktop');
		expect(normalizeOriginator('codex_exec')).toBe('codex-exec');
		expect(normalizeOriginator(undefined)).toBeNull();
	});
});
