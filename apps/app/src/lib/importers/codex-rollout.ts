/**
 * Codex rollout JSONL (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) ->
 * UsageMessage[], the same shape the Claude Code importer produces.
 *
 * A rollout carries usage two ways, and a file is read from exactly ONE of
 * them (summing both double-counts):
 *   - `token_usage_record` lines (newer Codex): one per API response, with a
 *     unique `response_id`. These also cover calls the running total leaves
 *     out — a compaction request is recorded here but never added to
 *     `total_token_usage`.
 *   - `token_count` events: a running `total_token_usage`. Per-turn usage is
 *     the change between consecutive totals. A total that goes DOWN is a
 *     reset (seen on resumed sessions), so the new total counts from zero.
 *     A repeated total adds nothing.
 *
 * Choice per file: records when the file's FIRST usage line is a record (the
 * file was written by a Codex that records every response, so records cover
 * all of it), else the running total. The rule depends only on the file's
 * opening lines, so a file can never switch source between runs as it grows —
 * switching would write a second set of message ids. Measured over 2,763
 * local rollouts on 2026-10-06, it matches "use whichever covers more" in
 * 2,739 files; the 3 it changes are resumed sessions where the running total
 * carried over (below), so records were right.
 *
 * Resumed sessions: a rollout that continues an earlier one starts its running
 * total where the earlier file ended, not at zero. Pass that file's last total
 * as `baselineTotal` so the carried-over usage is not counted twice.
 *
 * Token convention: OpenAI counts cached input INSIDE `input_tokens` and
 * reasoning INSIDE `output_tokens`. The schema's columns follow Anthropic's
 * convention (uncached input; cache reads separate), so input is stored as
 * input - cached, cache reads as cached, and reasoning is never added on top.
 */

import { estimateOpenAICost } from '../pricing/openai-pricing';
import type { UsageMessage } from './usage-record';

interface OpenAIUsage {
	input_tokens?: number;
	cached_input_tokens?: number;
	cache_write_input_tokens?: number;
	output_tokens?: number;
}

/** The payload fields this parser reads, across the rollout line types it handles. */
interface RolloutPayload {
	id?: string;
	cwd?: string;
	originator?: string;
	model?: string;
	type?: string;
	name?: string;
	session_id?: string;
	response_id?: string;
	usage?: OpenAIUsage;
	info?: { total_token_usage?: OpenAIUsage; last_token_usage?: OpenAIUsage } | null;
}

export interface CodexRollout {
	sessionId: string | null;
	cwd: string | null;
	editor: string | null;
	source: 'records' | 'running_total' | 'none';
	messages: UsageMessage[];
	/** Input tokens each source accounts for, for the importer's per-file gate. */
	recordsInputTokens: number;
	runningTotalInputTokens: number;
	unpricedTokens: number;
	/** The file's last running total — the next rollout of the same session starts from it. */
	lastTotal: OpenAIUsageTotals | null;
}

export type OpenAIUsageTotals = Required<OpenAIUsage>;

export interface CodexRolloutParserOptions {
	/** Identifies the rollout file in synthetic message ids, e.g. its filename stem. */
	fileKey?: string;
	/** Last running total of the previous rollout of this session, if any. */
	baselineTotal?: OpenAIUsageTotals | null;
}

/** "Codex Desktop" -> "codex-desktop", "codex_exec" -> "codex-exec". */
export function normalizeOriginator(originator: string | null | undefined): string | null {
	if (!originator) return null;
	return originator.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

interface Pending {
	key: string;
	timestamp: string;
	model: string;
	usage: Required<OpenAIUsage>;
}

function full(u: OpenAIUsage): Required<OpenAIUsage> {
	return {
		input_tokens: u.input_tokens ?? 0,
		cached_input_tokens: u.cached_input_tokens ?? 0,
		cache_write_input_tokens: u.cache_write_input_tokens ?? 0,
		output_tokens: u.output_tokens ?? 0
	};
}

export interface CodexRolloutParser {
	/** Feed one line; `index` is its 0-based line number (used for stable synthetic ids). */
	push(line: string, index: number): void;
	finish(): CodexRollout;
}

/** Streaming form — rollouts can exceed the 512 MB a single JS string can hold. */
export function createCodexRolloutParser(options: CodexRolloutParserOptions = {}): CodexRolloutParser {
	const fileKey = options.fileKey ?? 'file';
	let sessionId: string | null = null;
	let cwd: string | null = null;
	let editor: string | null = null;
	let model = 'unknown';
	let firstModel: string | null = null;
	const toolNames = new Set<string>();
	const records: Pending[] = [];
	const deltas: Pending[] = [];
	let prevTotal: Required<OpenAIUsage> | null = options.baselineTotal ?? null;
	let firstUsage: 'record' | 'total' | null = null;
	let firstTotalPending = true;

	function push(line: string, index: number): void {
		let rec: { type?: string; timestamp?: string; payload?: RolloutPayload };
		try {
			rec = JSON.parse(line);
		} catch {
			return; // torn trailing line from an interrupted write
		}
		const p: RolloutPayload = rec.payload ?? {};
		const ts = rec.timestamp ?? '';

		if (rec.type === 'session_meta') {
			sessionId ??= p.id ?? null;
			cwd ??= p.cwd ?? null;
			editor ??= normalizeOriginator(p.originator);
		} else if (rec.type === 'turn_context') {
			if (p.model) {
				model = p.model;
				firstModel ??= p.model;
			}
			cwd ??= p.cwd ?? null;
		} else if (rec.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
			if (p.name) toolNames.add(p.name);
		} else if (rec.type === 'token_usage_record' && p.usage) {
			sessionId ??= p.session_id ?? null;
			firstUsage ??= 'record';
			records.push({ key: p.response_id ?? `line${index}`, timestamp: ts, model, usage: full(p.usage) });
		} else if (rec.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
			const total = full(p.info.total_token_usage);
			firstUsage ??= 'total';
			// A drop is a reset. So is a resumed file's first total that equals its
			// own turn's usage: the counter restarted at zero, and subtracting the
			// previous file's total would undercount.
			const last = p.info.last_token_usage ? full(p.info.last_token_usage) : null;
			const restartedOnResume =
				firstTotalPending && options.baselineTotal != null && last !== null && total.input_tokens === last.input_tokens;
			firstTotalPending = false;
			const reset = prevTotal === null || total.input_tokens < prevTotal.input_tokens || restartedOnResume;
			const d = reset
				? total
				: {
						input_tokens: total.input_tokens - prevTotal!.input_tokens,
						cached_input_tokens: total.cached_input_tokens - prevTotal!.cached_input_tokens,
						cache_write_input_tokens: total.cache_write_input_tokens - prevTotal!.cache_write_input_tokens,
						output_tokens: total.output_tokens - prevTotal!.output_tokens
					};
			prevTotal = total;
			if (d.input_tokens || d.output_tokens || d.cached_input_tokens) {
				deltas.push({ key: `line${index}`, timestamp: ts, model, usage: d });
			}
		}
	}

	function finish(): CodexRollout {

	const recordsInputTokens = records.reduce((s, r) => s + r.usage.input_tokens, 0);
	const runningTotalInputTokens = deltas.reduce((s, r) => s + r.usage.input_tokens, 0);
	const useRecords = firstUsage === 'record';
	const chosen = useRecords ? records : deltas;
	const source = chosen.length === 0 ? 'none' : useRecords ? 'records' : 'running_total';

	let unpricedTokens = 0;
	const sid = sessionId ?? 'unknown';
	// Usage logged before the first turn_context (96 local files) belongs to the
	// file's first-announced model, not an "unknown" one priced at $0.
	for (const c of chosen) if (c.model === 'unknown' && firstModel) c.model = firstModel;
	const messages: UsageMessage[] = chosen.map((c, i) => {
		const cached = Math.min(c.usage.cached_input_tokens, c.usage.input_tokens);
		const tokens = {
			inputTokens: c.usage.input_tokens - cached,
			outputTokens: c.usage.output_tokens,
			cacheReadTokens: cached,
			cacheCreationTokens: c.usage.cache_write_input_tokens
		};
		const est = estimateOpenAICost(c.model, tokens);
		if (!est.matched) unpricedTokens += c.usage.input_tokens + c.usage.output_tokens;
		return {
			sessionId: sid,
			// response ids are globally unique; running-total rows get a stable
			// synthetic id from file + line (rollouts are append-only).
			messageId: useRecords && c.key.startsWith('resp_') ? c.key : `codex:${sid}:${fileKey}:${c.key}`,
			timestamp: c.timestamp,
			model: c.model,
			cwd,
			editor,
			...tokens,
			costUsd: est.costUsd,
			toolNames: i === 0 ? [...toolNames] : []
		};
	});

	return { sessionId, cwd, editor, source, messages, recordsInputTokens, runningTotalInputTokens, unpricedTokens, lastTotal: prevTotal };
	}

	return { push, finish };
}

export function parseCodexRollout(lines: string[], options: CodexRolloutParserOptions = {}): CodexRollout {
	const parser = createCodexRolloutParser(options);
	lines.forEach((line, index) => parser.push(line, index));
	return parser.finish();
}
