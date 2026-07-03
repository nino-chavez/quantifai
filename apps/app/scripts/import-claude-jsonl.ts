#!/usr/bin/env -S npx tsx
/**
 * Importer: ~/.claude/projects/**\/*.jsonl -> sessions / messages / units_of_work.
 *
 * Reads THIS machine's real Claude Code session history directly (no
 * fixtures). Two write paths (ADR-0005):
 *   - Default (remote): POST the normalized batch to the deployed ingest
 *     endpoint (`POST /api/v1/ingest`) — QUANTIFAI_API_URL + QUANTIFAI_API_KEY.
 *   - `--local`: write directly to the local D1 file via `wrangler d1
 *     execute --local` (no server round-trip; for iterating on this
 *     importer or the schema without `wrangler dev` running).
 *
 * Re-running against the same files is idempotent either way: each run
 * recomputes full session totals from source and upserts the total, not a
 * delta (see src/lib/server/sessions.ts's upsertSession header).
 *
 * Coverage note: a Claude Code project directory contains not just top-level
 * `<session-uuid>.jsonl` files but nested `<session-uuid>/subagents/**.jsonl`
 * files for Task-tool subagent fan-outs. Those nested files carry the SAME
 * `sessionId` as their parent (subagent spend belongs to the session that
 * spawned it) — confirmed by inspection, not assumed. This importer walks
 * every .jsonl file under a project directory recursively and groups by the
 * `sessionId` field found INSIDE each record, never by filename, so a
 * nine-agent fan-out's cost rolls into its parent session's total instead of
 * vanishing into an unindexed subagent file.
 *
 * Usage:
 *   npm run import:claude [-- --dir ~/.claude/projects] [--limit N] [--local]
 */

import { readdirSync, statSync, existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
	loadDotEnv,
	sqlLiteral,
	runD1File,
	runD1Query,
	postIngestBatch,
	randomUUID
} from './lib/ingest-client';
import { chunk } from '../src/lib/importers/chunk';
import {
	extractUsageMessage,
	newAccumulator,
	accumulate,
	dominantModel,
	type SessionAccumulator
} from '../src/lib/importers/usage-record';
import { normalizeProjectPath } from '../src/lib/attribution/project-path';

loadDotEnv();

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
}
const LOCAL = args.includes('--local');
const APP_DIR = resolve(import.meta.dirname, '..'); // apps/app — where wrangler.jsonc lives

const PROJECTS_DIR = resolve(argValue('--dir') ?? join(homedir(), '.claude', 'projects'));
const LIMIT_FILES = argValue('--limit') ? Number(argValue('--limit')) : undefined;

const MESSAGE_POST_CHUNK = 4000; // stays comfortably under the server's 10k MAX_BATCH_SIZE

function walkJsonlFiles(dir: string): string[] {
	const out: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			out.push(...walkJsonlFiles(full));
		} else if (entry.endsWith('.jsonl')) {
			out.push(full);
		}
	}
	return out;
}

async function readJsonlLines(path: string, onLine: (line: string) => void): Promise<void> {
	const stream = createReadStream(path, { encoding: 'utf8' });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });
	for await (const line of rl) {
		if (line.trim()) onLine(line);
	}
}

interface UnitInput {
	kind: 'initiative' | 'project';
	name: string;
	source: 'path';
	projectPath: string;
}

interface SessionInput {
	sessionId: string;
	unitProjectPath: string;
	projectPath: string;
	model: string;
	provider: string;
	editor: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheCreation: number;
	totalCost: number;
	costProvenance: 'estimated';
	messageCount: number;
	startedAt: string | null;
	endedAt: string | null;
	toolNames: string[];
	source: 'interactive';
}

interface MessageInput {
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
	costProvenance: 'estimated';
	recordType: string | null;
}

async function main() {
	if (!existsSync(PROJECTS_DIR)) {
		console.error(`Projects dir not found: ${PROJECTS_DIR}`);
		process.exit(1);
	}

	let apiUrl = '';
	let apiKey = '';
	if (!LOCAL) {
		apiUrl = process.env.QUANTIFAI_API_URL ?? '';
		apiKey = process.env.QUANTIFAI_API_KEY ?? '';
		if (!apiUrl || !apiKey) {
			console.error(
				'QUANTIFAI_API_URL and QUANTIFAI_API_KEY must be set (or pass --local to write directly to local D1).'
			);
			process.exit(1);
		}
	}

	const projectDirs = readdirSync(PROJECTS_DIR).filter((d) =>
		statSync(join(PROJECTS_DIR, d)).isDirectory()
	);
	console.log(`Found ${projectDirs.length} project directories under ${PROJECTS_DIR}`);

	const units = new Map<string, UnitInput>(); // keyed by projectPath
	const sessions: SessionInput[] = [];
	const messages: MessageInput[] = [];

	let filesProcessed = 0;

	for (const projectDirName of projectDirs) {
		const projectDirPath = join(PROJECTS_DIR, projectDirName);
		let files = walkJsonlFiles(projectDirPath);
		if (LIMIT_FILES) files = files.slice(0, LIMIT_FILES);
		if (files.length === 0) continue;

		const sessionAccs = new Map<string, SessionAccumulator>();
		const projectMessages: MessageInput[] = [];
		let firstCwd: string | null = null;

		for (const file of files) {
			filesProcessed += 1;
			await readJsonlLines(file, (line) => {
				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch {
					return; // torn line — JSONL files can be interrupted mid-write
				}
				const msg = extractUsageMessage(parsed);
				if (!msg) return;

				if (!firstCwd && msg.cwd) firstCwd = msg.cwd;

				let acc = sessionAccs.get(msg.sessionId);
				if (!acc) {
					acc = newAccumulator(msg.sessionId);
					sessionAccs.set(msg.sessionId, acc);
				}
				accumulate(acc, msg);

				projectMessages.push({
					sessionId: msg.sessionId,
					messageId: msg.messageId,
					timestamp: msg.timestamp,
					model: msg.model,
					provider: 'anthropic',
					inputTokens: msg.inputTokens,
					outputTokens: msg.outputTokens,
					cacheRead: msg.cacheReadTokens,
					cacheCreation: msg.cacheCreationTokens,
					estCost: msg.costUsd,
					costProvenance: 'estimated',
					recordType: null
				});
			});
		}

		if (sessionAccs.size === 0) continue;

		const { projectPath, repoName, normalized } = normalizeProjectPath(projectDirName, firstCwd);
		const hasBlueprintYml = normalized && existsSync(join(projectPath, 'blueprint.yml'));
		const kind = hasBlueprintYml ? 'initiative' : 'project';

		units.set(projectPath, { kind, name: repoName, source: 'path', projectPath });

		for (const [sessionId, acc] of sessionAccs) {
			sessions.push({
				sessionId,
				unitProjectPath: projectPath,
				projectPath,
				model: dominantModel(acc),
				provider: 'anthropic',
				editor: acc.editor,
				inputTokens: acc.inputTokens,
				outputTokens: acc.outputTokens,
				cacheRead: acc.cacheReadTokens,
				cacheCreation: acc.cacheCreationTokens,
				totalCost: acc.costUsd,
				costProvenance: 'estimated', // see anthropic-pricing.ts header: list-price valuation on subscription usage, never api_metered
				messageCount: acc.messageCount,
				startedAt: acc.startedAt,
				endedAt: acc.endedAt,
				toolNames: Array.from(acc.toolNames),
				source: 'interactive'
			});
		}

		messages.push(...projectMessages);

		console.log(
			`  ${repoName} (${kind}): ${sessionAccs.size} sessions, ${projectMessages.length} messages, $${[...sessionAccs.values()].reduce((s, a) => s + a.costUsd, 0).toFixed(2)}`
		);
	}

	const totalSessions = sessions.length;
	const totalCost = sessions.reduce((s, x) => s + x.totalCost, 0);

	if (LOCAL) {
		await writeLocal(units, sessions, messages);
	} else {
		await writeRemote(units, sessions, messages, { apiUrl, apiKey });
	}

	console.log('');
	console.log(
		`Import complete: ${filesProcessed} files, ${totalSessions} sessions, ${messages.length} messages, $${totalCost.toFixed(2)} estimated total`
	);
}

// ============================================================
// Local D1 write path (`--local`) — direct `wrangler d1 execute`, no server.
// Mirrors src/lib/server/{units-of-work,sessions}.ts's SQL shape exactly;
// see scripts/lib/ingest-client.ts's header for why this can't just import
// those modules (D1Database binding only exists inside the Worker runtime).
// ============================================================

async function writeLocal(
	units: Map<string, UnitInput>,
	sessions: SessionInput[],
	messages: MessageInput[]
) {
	const d1opts = { cwd: APP_DIR, local: true };

	// Pass 1: upsert units_of_work.
	const unitUpsertSql = Array.from(units.values())
		.map(
			(u) => `INSERT INTO units_of_work (id, kind, name, source, project_path)
				VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(u.kind)}, ${sqlLiteral(u.name)}, ${sqlLiteral(u.source)}, ${sqlLiteral(u.projectPath)})
				ON CONFLICT (kind, project_path) DO UPDATE SET name = excluded.name, source = excluded.source;`
		)
		.join('\n');
	if (unitUpsertSql) runD1File(unitUpsertSql, d1opts);

	// Pass 2: read back real ids (INSERT's own id only "wins" when there was
	// no prior row — ON CONFLICT DO UPDATE never touches `id`).
	const paths = Array.from(units.keys());
	const unitRows = paths.length
		? runD1Query<{ id: string; kind: string; project_path: string }>(
				`SELECT id, kind, project_path FROM units_of_work WHERE project_path IN (${paths.map((p) => sqlLiteral(p)).join(',')})`,
				d1opts
			)
		: [];
	const unitIdByPath = new Map(unitRows.map((r) => [r.project_path, r.id]));

	// Pass 3: sessions + messages, chunked into one file per chunk to keep
	// each `wrangler d1 execute --file` invocation to a reasonable size.
	for (const batch of chunk(sessions, 500)) {
		const sql = batch
			.map((s) => {
				const unitId = unitIdByPath.get(s.unitProjectPath) ?? null;
				return `INSERT INTO sessions (
					id, session_id, project_path, unit_id, model, provider, editor,
					input_tokens, output_tokens, cache_read, cache_creation,
					total_cost, cost_provenance, message_count, started_at, ended_at,
					tool_names, source
				) VALUES (
					${sqlLiteral(randomUUID())}, ${sqlLiteral(s.sessionId)}, ${sqlLiteral(s.projectPath)}, ${sqlLiteral(unitId)},
					${sqlLiteral(s.model)}, ${sqlLiteral(s.provider)}, ${sqlLiteral(s.editor)},
					${sqlLiteral(s.inputTokens)}, ${sqlLiteral(s.outputTokens)}, ${sqlLiteral(s.cacheRead)}, ${sqlLiteral(s.cacheCreation)},
					${sqlLiteral(s.totalCost)}, ${sqlLiteral(s.costProvenance)}, ${sqlLiteral(s.messageCount)}, ${sqlLiteral(s.startedAt)}, ${sqlLiteral(s.endedAt)},
					${sqlLiteral(s.toolNames)}, ${sqlLiteral(s.source)}
				)
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
					started_at = CASE WHEN sessions.started_at IS NULL THEN excluded.started_at WHEN excluded.started_at IS NULL THEN sessions.started_at WHEN excluded.started_at < sessions.started_at THEN excluded.started_at ELSE sessions.started_at END,
					ended_at = CASE WHEN sessions.ended_at IS NULL THEN excluded.ended_at WHEN excluded.ended_at IS NULL THEN sessions.ended_at WHEN excluded.ended_at > sessions.ended_at THEN excluded.ended_at ELSE sessions.ended_at END,
					tool_names = (SELECT json_group_array(name) FROM (SELECT DISTINCT value AS name FROM json_each(sessions.tool_names) UNION SELECT DISTINCT value AS name FROM json_each(excluded.tool_names)));`;
			})
			.join('\n');
		runD1File(sql, d1opts);
	}

	for (const batch of chunk(messages, 500)) {
		const sql = batch
			.map(
				(m) => `INSERT INTO messages (id, session_id, message_id, timestamp, model, provider, input_tokens, output_tokens, cache_read, cache_creation, est_cost, cost_provenance, record_type)
				VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(m.sessionId)}, ${sqlLiteral(m.messageId)}, ${sqlLiteral(m.timestamp)}, ${sqlLiteral(m.model)}, ${sqlLiteral(m.provider)}, ${sqlLiteral(m.inputTokens)}, ${sqlLiteral(m.outputTokens)}, ${sqlLiteral(m.cacheRead)}, ${sqlLiteral(m.cacheCreation)}, ${sqlLiteral(m.estCost)}, ${sqlLiteral(m.costProvenance)}, ${sqlLiteral(m.recordType)})
				ON CONFLICT (message_id) DO NOTHING;`
			)
			.join('\n');
		runD1File(sql, d1opts);
	}
}

// ============================================================
// Remote write path (default) — POST to the deployed ingest endpoint.
// ============================================================

async function writeRemote(
	units: Map<string, UnitInput>,
	sessions: SessionInput[],
	messages: MessageInput[],
	api: { apiUrl: string; apiKey: string }
) {
	const unitsOfWork = Array.from(units.values());
	const messageChunks = chunk(messages, MESSAGE_POST_CHUNK);

	if (messageChunks.length === 0) {
		await postIngestBatch({ unitsOfWork, sessions, messages: [] }, api);
		return;
	}

	for (let i = 0; i < messageChunks.length; i += 1) {
		// units + sessions are cheap to resend (idempotent upserts) — only
		// send them on the first chunk to avoid redundant work on the server.
		const batch =
			i === 0
				? { unitsOfWork, sessions, messages: messageChunks[i] }
				: { messages: messageChunks[i] };
		const result = await postIngestBatch(batch, api);
		console.log(`  POST chunk ${i + 1}/${messageChunks.length}:`, JSON.stringify(result));
	}
}

main().catch((err) => {
	console.error('Import failed:', err);
	process.exit(1);
});
