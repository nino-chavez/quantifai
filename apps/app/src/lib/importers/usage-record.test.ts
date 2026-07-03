import { describe, it, expect } from 'vitest';
import { extractUsageMessage, newAccumulator, accumulate, dominantModel } from './usage-record';

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
