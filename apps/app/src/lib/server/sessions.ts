/**
 * Atomic session upsert — SQLite translation of the Postgres
 * `upsert_session()` function (supabase/migrations/20260703000001_functions.sql),
 * per ADR-0005.
 *
 * Stage 3 semantics preserved exactly:
 *   - Replace-not-accumulate on the numeric/measurement columns (tokens,
 *     cost, message_count, model/provider/editor/project/unit) — the
 *     importer always recomputes a session's full totals from source (the
 *     JSONL file, or the shipper's full-session view) and upserts the
 *     total, not a delta, so re-running is idempotent (see the note this
 *     migration inherits from the Postgres function).
 *   - Expand-never-shrink on started_at/ended_at (CASE-based LEAST/GREATEST
 *     — SQLite has no LEAST/GREATEST builtin) and on tool_names (JSON-array
 *     union via json_each/json_group_array — SQLite has no array type).
 */

import type { D1Database } from '@cloudflare/workers-types';

export type CostProvenance = 'subscription_amortized' | 'api_metered' | 'estimated';

export interface SessionAggregateInput {
	sessionId: string;
	projectPath: string;
	unitId: string | null;
	model: string;
	provider: string;
	editor: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheCreation: number;
	totalCost: number;
	costProvenance: CostProvenance;
	messageCount: number;
	startedAt: string | null;
	endedAt: string | null;
	toolNames: string[];
	source: 'interactive' | 'api';
}

export async function upsertSession(db: D1Database, input: SessionAggregateInput): Promise<void> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO sessions (
				id, session_id, project_path, unit_id, model, provider, editor,
				input_tokens, output_tokens, cache_read, cache_creation,
				total_cost, cost_provenance, message_count, started_at, ended_at,
				tool_names, source
			) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
			ON CONFLICT (session_id) DO UPDATE SET
				project_path = COALESCE(excluded.project_path, sessions.project_path),
				unit_id = COALESCE(excluded.unit_id, sessions.unit_id),
				model = COALESCE(excluded.model, sessions.model),
				provider = COALESCE(excluded.provider, sessions.provider),
				editor = COALESCE(excluded.editor, sessions.editor),
				input_tokens = excluded.input_tokens,
				output_tokens = excluded.output_tokens,
				cache_read = excluded.cache_read,
				cache_creation = excluded.cache_creation,
				total_cost = excluded.total_cost,
				cost_provenance = excluded.cost_provenance,
				message_count = excluded.message_count,
				started_at = CASE
					WHEN sessions.started_at IS NULL THEN excluded.started_at
					WHEN excluded.started_at IS NULL THEN sessions.started_at
					WHEN excluded.started_at < sessions.started_at THEN excluded.started_at
					ELSE sessions.started_at
				END,
				ended_at = CASE
					WHEN sessions.ended_at IS NULL THEN excluded.ended_at
					WHEN excluded.ended_at IS NULL THEN sessions.ended_at
					WHEN excluded.ended_at > sessions.ended_at THEN excluded.ended_at
					ELSE sessions.ended_at
				END,
				tool_names = (
					SELECT json_group_array(name) FROM (
						SELECT DISTINCT value AS name FROM json_each(sessions.tool_names)
						UNION
						SELECT DISTINCT value AS name FROM json_each(excluded.tool_names)
					)
				)`
		)
		.bind(
			id,
			input.sessionId,
			input.projectPath,
			input.unitId,
			input.model,
			input.provider,
			input.editor,
			input.inputTokens,
			input.outputTokens,
			input.cacheRead,
			input.cacheCreation,
			input.totalCost,
			input.costProvenance,
			input.messageCount,
			input.startedAt,
			input.endedAt,
			JSON.stringify(input.toolNames ?? []),
			input.source
		)
		.run();
}

export interface MessageRow {
	sessionId: string;
	messageId: string;
	timestamp: string;
	model: string;
	provider: string;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheCreation: number;
	estCost: number;
	costProvenance: CostProvenance;
	recordType: string | null;
}

/**
 * Bulk-insert message rows in one D1 batch, `ON CONFLICT DO NOTHING` as the
 * DB-level dedup layer (mirrors the Postgres migration's approach — see
 * import-claude-jsonl.ts's original comment). Caller is responsible for
 * chunking (`src/lib/importers/chunk.ts`) before calling this — D1's
 * `batch()` has its own statement-count practicalities, same discipline as
 * the 500-row chunks used elsewhere in this codebase.
 */
export async function insertMessages(db: D1Database, rows: MessageRow[]): Promise<number> {
	if (rows.length === 0) return 0;
	const stmt = db.prepare(
		`INSERT INTO messages (
			id, session_id, message_id, timestamp, model, provider,
			input_tokens, output_tokens, cache_read, cache_creation, est_cost, cost_provenance, record_type
		) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
		ON CONFLICT (message_id) DO NOTHING`
	);
	const batch = rows.map((row) =>
		stmt.bind(
			crypto.randomUUID(),
			row.sessionId,
			row.messageId,
			row.timestamp,
			row.model,
			row.provider,
			row.inputTokens,
			row.outputTokens,
			row.cacheRead,
			row.cacheCreation,
			row.estCost,
			row.costProvenance,
			row.recordType
		)
	);
	await db.batch(batch);
	return rows.length;
}
