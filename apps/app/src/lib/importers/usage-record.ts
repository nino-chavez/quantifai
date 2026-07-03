/**
 * Pure parsing/aggregation logic for Claude Code JSONL session records.
 * Kept dependency-free of Node's fs/pg so it's unit-testable without a
 * filesystem or database — the CLI orchestration (file walking, DB writes)
 * lives in `scripts/import-claude-jsonl.ts` and imports these functions.
 */

import { estimateAnthropicCost } from '../pricing/anthropic-pricing';

interface RawContentBlock {
	type?: string;
	name?: string;
}

interface RawAssistantRecord {
	type?: string;
	sessionId?: string;
	uuid?: string;
	timestamp?: string;
	cwd?: string;
	entrypoint?: string;
	message?: {
		model?: string;
		content?: RawContentBlock[];
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
		};
	};
}

export interface UsageMessage {
	sessionId: string;
	messageId: string;
	timestamp: string;
	model: string;
	cwd: string | null;
	editor: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	costUsd: number;
	toolNames: string[];
}

/**
 * Extracts a usage record from one parsed JSONL line. Returns null for
 * non-assistant records, assistant records with no usage block (e.g. pure
 * tool-result echoes), or malformed input — never throws. Filtering here
 * mirrors LESSONS-LEARNED.md's "filter noise messages" pattern: only
 * substantive, cost-bearing records become rows.
 */
export function extractUsageMessage(raw: unknown): UsageMessage | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as RawAssistantRecord;
	if (r.type !== 'assistant') return null;
	if (!r.sessionId || !r.uuid || !r.timestamp) return null;

	const usage = r.message?.usage;
	if (!usage) return null;

	const toolNames = (r.message?.content ?? [])
		.filter((c) => c.type === 'tool_use' && typeof c.name === 'string')
		.map((c) => c.name as string);

	const model = r.message?.model ?? 'unknown';
	const inputTokens = usage.input_tokens ?? 0;
	const outputTokens = usage.output_tokens ?? 0;
	const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
	const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;

	const { costUsd } = estimateAnthropicCost(model, {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens
	});

	return {
		sessionId: r.sessionId,
		messageId: r.uuid,
		timestamp: r.timestamp,
		model,
		cwd: r.cwd ?? null,
		editor: r.entrypoint ?? null,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens,
		costUsd,
		toolNames
	};
}

export interface SessionAccumulator {
	sessionId: string;
	cwd: string | null;
	editor: string | null;
	modelCounts: Map<string, number>;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	costUsd: number;
	messageCount: number;
	startedAt: string | null;
	endedAt: string | null;
	toolNames: Set<string>;
}

export function newAccumulator(sessionId: string): SessionAccumulator {
	return {
		sessionId,
		cwd: null,
		editor: null,
		modelCounts: new Map(),
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		costUsd: 0,
		messageCount: 0,
		startedAt: null,
		endedAt: null,
		toolNames: new Set()
	};
}

/** Folds one usage message into a session accumulator, in place. Idempotent grouping is by the caller (dedup on messageId happens at the DB layer via UNIQUE(message_id)). */
export function accumulate(acc: SessionAccumulator, msg: UsageMessage): void {
	if (!acc.cwd && msg.cwd) acc.cwd = msg.cwd;
	if (!acc.editor && msg.editor) acc.editor = msg.editor;

	acc.modelCounts.set(msg.model, (acc.modelCounts.get(msg.model) ?? 0) + 1);
	acc.inputTokens += msg.inputTokens;
	acc.outputTokens += msg.outputTokens;
	acc.cacheReadTokens += msg.cacheReadTokens;
	acc.cacheCreationTokens += msg.cacheCreationTokens;
	acc.costUsd += msg.costUsd;
	acc.messageCount += 1;

	if (!acc.startedAt || msg.timestamp < acc.startedAt) acc.startedAt = msg.timestamp;
	if (!acc.endedAt || msg.timestamp > acc.endedAt) acc.endedAt = msg.timestamp;

	for (const name of msg.toolNames) acc.toolNames.add(name);
}

/** The most-used model across a session's messages — used as the session's headline `model` column. */
export function dominantModel(acc: SessionAccumulator): string {
	let best: string = 'unknown';
	let bestCount = -1;
	for (const [model, count] of acc.modelCounts) {
		if (count > bestCount) {
			best = model;
			bestCount = count;
		}
	}
	return best;
}
