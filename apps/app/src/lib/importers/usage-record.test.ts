import { describe, it, expect } from 'vitest';
import { extractUsageMessage, newAccumulator, accumulate, dominantModel, newSessionDedup, countOnce } from './usage-record';

function assistantLine(overrides: Record<string, unknown> = {}) {
	return {
		type: 'assistant',
		sessionId: 'sess-1',
		uuid: 'msg-1',
		timestamp: '2026-07-03T16:57:26.061Z',
		cwd: '/Users/nino/Workspace/dev/wip/quantifai-next',
		entrypoint: 'sdk-cli',
		message: {
			model: 'claude-sonnet-4-5',
			content: [{ type: 'tool_use', name: 'Read' }],
			usage: {
				input_tokens: 1000,
				output_tokens: 200,
				cache_read_input_tokens: 500,
				cache_creation_input_tokens: 100
			}
		},
		...overrides
	};
}

describe('extractUsageMessage', () => {
	it('extracts a full usage message from a well-formed assistant record', () => {
		const msg = extractUsageMessage(assistantLine());
		expect(msg).not.toBeNull();
		expect(msg!.sessionId).toBe('sess-1');
		expect(msg!.messageId).toBe('msg-1');
		expect(msg!.model).toBe('claude-sonnet-4-5');
		expect(msg!.inputTokens).toBe(1000);
		expect(msg!.toolNames).toEqual(['Read']);
		expect(msg!.costUsd).toBeGreaterThan(0);
	});

	it('returns null for non-assistant record types (user, attachment, etc.)', () => {
		expect(extractUsageMessage({ type: 'user', sessionId: 'x', uuid: 'y', timestamp: 'z' })).toBeNull();
	});

	it('returns null for an assistant record with no usage block (e.g. a thinking-only echo)', () => {
		const line = assistantLine();
		// @ts-expect-error - deliberately malformed for the test
		delete line.message.usage;
		expect(extractUsageMessage(line)).toBeNull();
	});

	it('returns null when required identity fields are missing', () => {
		expect(extractUsageMessage(assistantLine({ sessionId: undefined }))).toBeNull();
		expect(extractUsageMessage(assistantLine({ uuid: undefined }))).toBeNull();
		expect(extractUsageMessage(assistantLine({ timestamp: undefined }))).toBeNull();
	});

	it('never throws on garbage input', () => {
		expect(extractUsageMessage(null)).toBeNull();
		expect(extractUsageMessage(undefined)).toBeNull();
		expect(extractUsageMessage('not an object')).toBeNull();
		expect(extractUsageMessage(42)).toBeNull();
		expect(extractUsageMessage({})).toBeNull();
	});

	it('defaults model to "unknown" and tokens to 0 when usage sub-fields are absent', () => {
		const line = assistantLine();
		// @ts-expect-error - deliberately empty usage object for the test
		line.message.usage = {};
		delete (line.message as Record<string, unknown>).model;
		const msg = extractUsageMessage(line);
		expect(msg!.model).toBe('unknown');
		expect(msg!.inputTokens).toBe(0);
		expect(msg!.costUsd).toBe(0);
	});
});

describe('accumulate / dominantModel', () => {
	it('sums tokens and cost across multiple messages in a session', () => {
		const acc = newAccumulator('sess-1');
		accumulate(acc, extractUsageMessage(assistantLine())!);
		accumulate(acc, extractUsageMessage(assistantLine({ uuid: 'msg-2', timestamp: '2026-07-03T17:00:00.000Z' }))!);

		expect(acc.messageCount).toBe(2);
		expect(acc.inputTokens).toBe(2000);
		expect(acc.startedAt).toBe('2026-07-03T16:57:26.061Z');
		expect(acc.endedAt).toBe('2026-07-03T17:00:00.000Z');
		expect(acc.cwd).toBe('/Users/nino/Workspace/dev/wip/quantifai-next');
		expect(acc.toolNames.has('Read')).toBe(true);
	});

	it('tracks min/max timestamps regardless of arrival order', () => {
		const acc = newAccumulator('sess-1');
		accumulate(acc, extractUsageMessage(assistantLine({ uuid: 'msg-2', timestamp: '2026-07-03T18:00:00.000Z' }))!);
		accumulate(acc, extractUsageMessage(assistantLine({ uuid: 'msg-1', timestamp: '2026-07-03T16:00:00.000Z' }))!);

		expect(acc.startedAt).toBe('2026-07-03T16:00:00.000Z');
		expect(acc.endedAt).toBe('2026-07-03T18:00:00.000Z');
	});

	it('picks the most frequently used model as dominant', () => {
		const acc = newAccumulator('sess-1');
		accumulate(acc, extractUsageMessage(assistantLine({ uuid: 'm1', message: { ...assistantLine().message, model: 'claude-opus-4' } }))!);
		accumulate(acc, extractUsageMessage(assistantLine({ uuid: 'm2' }))!); // sonnet
		accumulate(acc, extractUsageMessage(assistantLine({ uuid: 'm3' }))!); // sonnet

		expect(dominantModel(acc)).toBe('claude-sonnet-4-5');
	});

	it('returns "unknown" for an accumulator with no messages', () => {
		expect(dominantModel(newAccumulator('empty'))).toBe('unknown');
	});
});

type TestLine = Record<string, unknown> & { message: Record<string, unknown> };

describe('countOnce — usage counted once per API response', () => {
	// Claude Code writes one API response as one record per content block. Each
	// record has its own uuid, the same message.id and requestId, and a usage
	// block: identical on every record, or (older versions) a partial output
	// count on the earlier ones.
	function block(uuid: string, usage: Record<string, unknown>, ids: { id?: string; requestId?: string } = { id: 'msg_1', requestId: 'req_1' }, model = 'claude-opus-5-5') {
		const line = assistantLine({ uuid, ...(ids.requestId ? { requestId: ids.requestId } : {}) }) as TestLine;
		line.message = { ...line.message, model, usage, ...(ids.id ? { id: ids.id } : {}) };
		return extractUsageMessage(line)!;
	}
	const full = { input_tokens: 2, output_tokens: 300, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2_000 };

	it('keys a record by message.id and requestId, falling back to its uuid', () => {
		expect(block('a', full).responseKey).toBe('msg_1|req_1');
		expect(block('b', full, { id: 'msg_1' }).responseKey).toBe('uuid:b');
		expect(block('c', full, { requestId: 'req_1' }).responseKey).toBe('uuid:c');
	});

	it('counts a response written as two records with identical usage once', () => {
		const state = newSessionDedup();
		const first = countOnce(state, block('a', full))!;
		const second = countOnce(state, block('b', full))!;
		expect([first.outputTokens, first.cacheReadTokens, first.cacheCreationTokens]).toEqual([300, 50_000, 2_000]);
		expect([second.inputTokens, second.outputTokens, second.cacheReadTokens, second.cacheCreationTokens]).toEqual([0, 0, 0, 0]);
		expect(second.costUsd).toBe(0);
		expect(first.costUsd + second.costUsd).toBeCloseTo(block('x', full).costUsd, 12);
	});

	it('takes a partial output count on an earlier record up to the full count, once', () => {
		const state = newSessionDedup();
		const first = countOnce(state, block('a', { ...full, output_tokens: 1 }))!;
		const second = countOnce(state, block('b', full))!;
		expect([first.outputTokens, second.outputTokens]).toEqual([1, 299]);
		expect(first.cacheReadTokens + second.cacheReadTokens).toBe(50_000);
		expect(first.costUsd + second.costUsd).toBeCloseTo(block('x', full).costUsd, 12);
	});

	it('skips a record whose uuid was already counted in the session', () => {
		const state = newSessionDedup();
		expect(countOnce(state, block('a', full))).not.toBeNull();
		expect(countOnce(state, block('a', full))).toBeNull();
	});

	it('counts records without a requestId as separate responses', () => {
		const state = newSessionDedup();
		const a = countOnce(state, block('a', full, { id: 'msg_1' }))!;
		const b = countOnce(state, block('b', full, { id: 'msg_1' }))!;
		expect([a.outputTokens, b.outputTokens]).toEqual([300, 300]);
	});

	it('keeps tool names on a record whose usage was already counted', () => {
		const state = newSessionDedup();
		countOnce(state, block('a', full));
		const line = assistantLine({ uuid: 'b', requestId: 'req_1' }) as TestLine;
		line.message = { ...line.message, id: 'msg_1', model: 'claude-opus-5-5', usage: full, content: [{ type: 'tool_use', name: 'Bash' }] };
		const second = countOnce(state, extractUsageMessage(line)!)!;
		expect(second.toolNames).toEqual(['Bash']);
		expect(second.outputTokens).toBe(0);
	});

	it('reads the 1-hour share of a cache write', () => {
		const msg = block('a', { ...full, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1_500 } });
		expect(msg.cacheCreation1hTokens).toBe(1_500);
		expect(msg.costUsd).toBeCloseTo((2 * 4 + 300 * 20 + 50_000 * 0.2 + 500 * 5 + 1_500 * 8) / 1e6, 12);
	});
});
