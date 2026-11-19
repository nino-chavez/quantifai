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
	requestId?: string;
	timestamp?: string;
	cwd?: string;
	entrypoint?: string;
	message?: {
		id?: string;
		model?: string;
		content?: RawContentBlock[];
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_creation?: {
				ephemeral_5m_input_tokens?: number;
				ephemeral_1h_input_tokens?: number;
			};
		};
	};
}

export interface UsageMessage {
	sessionId: string;
	messageId: string;
	/**
	 * The API response this record belongs to: `message.id|requestId`, or
	 * `uuid:<uuid>` when either is missing. Claude Code writes one response as
	 * one record per content block, all carrying the response's usage.
	 */
	responseKey: string;
	timestamp: string;
	model: string;
	cwd: string | null;
	editor: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	/** The 1-hour share of `cacheCreationTokens` (0 when the usage block has no breakdown). */
	cacheCreation1hTokens: number;
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
	const cacheCreation1hTokens = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;

	const { costUsd } = estimateAnthropicCost(model, {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens,
		cacheCreation1hTokens
	});

	const responseId = r.message?.id;
	return {
		sessionId: r.sessionId,
		messageId: r.uuid,
		responseKey: responseId && r.requestId ? `${responseId}|${r.requestId}` : `uuid:${r.uuid}`,
		timestamp: r.timestamp,
		model,
		cwd: r.cwd ?? null,
		editor: r.entrypoint ?? null,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens,
		cacheCreation1hTokens,
		costUsd,
		toolNames
	};
}

/** One response's largest usage seen so far, field by field. */
interface ResponseUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	cacheCreation1hTokens: number;
}

/** What one session has already counted: record uuids, and each response's usage so far. */
export interface SessionDedup {
	seen: Set<string>;
	responses: Map<string, ResponseUsage>;
}

export function newSessionDedup(): SessionDedup {
	return { seen: new Set(), responses: new Map() };
}

/**
 * Counts a session's usage once per API response. Feed it every record of one
 * session in file walk order.
 *
 * - A record whose uuid was already counted (the same record copied into a
 *   second file, such as the session's subagents folder) returns null.
 * - Otherwise the record carries only the increase over the largest usage its
 *   response has shown so far, field by field, and the cost of that increase.
 *   A response's records then sum to its true usage, whether every record
 *   repeats it or earlier records carry a partial output count.
 *
 * The record keeps its row, timestamp and tool names; only its usage changes.
 * quantifai-sync's collector implements the same rule; the parity golden
 * holds the two together.
 */
export function countOnce(state: SessionDedup, msg: UsageMessage): UsageMessage | null {
	if (state.seen.has(msg.messageId)) return null;
	state.seen.add(msg.messageId);

	const prev = state.responses.get(msg.responseKey);
	const next: ResponseUsage = {
		inputTokens: Math.max(prev?.inputTokens ?? 0, msg.inputTokens),
		outputTokens: Math.max(prev?.outputTokens ?? 0, msg.outputTokens),
		cacheReadTokens: Math.max(prev?.cacheReadTokens ?? 0, msg.cacheReadTokens),
		cacheCreationTokens: Math.max(prev?.cacheCreationTokens ?? 0, msg.cacheCreationTokens),
		cacheCreation1hTokens: Math.max(prev?.cacheCreation1hTokens ?? 0, msg.cacheCreation1hTokens)
	};
	state.responses.set(msg.responseKey, next);
	if (!prev) return msg;

	const costUsd = estimateAnthropicCost(msg.model, next).costUsd - estimateAnthropicCost(msg.model, prev).costUsd;
	return {
		...msg,
		inputTokens: next.inputTokens - prev.inputTokens,
		outputTokens: next.outputTokens - prev.outputTokens,
		cacheReadTokens: next.cacheReadTokens - prev.cacheReadTokens,
		cacheCreationTokens: next.cacheCreationTokens - prev.cacheCreationTokens,
		cacheCreation1hTokens: next.cacheCreation1hTokens - prev.cacheCreation1hTokens,
		costUsd
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
