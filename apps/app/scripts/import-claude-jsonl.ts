#!/usr/bin/env -S npx tsx
/**
 * Importer: ~/.claude/projects/**\/*.jsonl -> sessions / messages / units_of_work.
 *
 * Reads THIS machine's real Claude Code session history directly (no
 * fixtures) and writes it via the atomic SQL upsert functions defined in
 * supabase/migrations/20260703000001_functions.sql. Re-running against the
 * same files is idempotent: each run recomputes full session totals from
 * source and upserts the total (not a delta) — see the note in
 * upsert_session()'s migration.
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
 * Usage: npm run import:claude [-- --dir ~/.claude/projects] [--limit N]
 */

import { readdirSync, statSync, existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadDotEnv, createPgPool, chunk } from './lib/pg-client';
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

const PROJECTS_DIR = resolve(argValue('--dir') ?? join(homedir(), '.claude', 'projects'));
const LIMIT_FILES = argValue('--limit') ? Number(argValue('--limit')) : undefined;

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

interface MessageRow {
	session_id: string;
	message_id: string;
	timestamp: string;
	model: string;
	input_tokens: number;
	output_tokens: number;
	cache_read: number;
	cache_creation: number;
	est_cost: number;
}

async function main() {
	if (!existsSync(PROJECTS_DIR)) {
		console.error(`Projects dir not found: ${PROJECTS_DIR}`);
		process.exit(1);
	}

	const projectDirs = readdirSync(PROJECTS_DIR).filter((d) =>
		statSync(join(PROJECTS_DIR, d)).isDirectory()
	);

	console.log(`Found ${projectDirs.length} project directories under ${PROJECTS_DIR}`);

	const pool = createPgPool();
	const client = await pool.connect();

	let totalSessions = 0;
	let totalMessages = 0;
	let totalCost = 0;
	let filesProcessed = 0;

	try {
		await client.query('BEGIN');

		for (const projectDirName of projectDirs) {
			const projectDirPath = join(PROJECTS_DIR, projectDirName);
			let files = walkJsonlFiles(projectDirPath);
			if (LIMIT_FILES) files = files.slice(0, LIMIT_FILES);
			if (files.length === 0) continue;

			const sessionAccs = new Map<string, SessionAccumulator>();
			const messageRows: MessageRow[] = [];
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

					messageRows.push({
						session_id: msg.sessionId,
						message_id: msg.messageId,
						timestamp: msg.timestamp,
						model: msg.model,
						input_tokens: msg.inputTokens,
						output_tokens: msg.outputTokens,
						cache_read: msg.cacheReadTokens,
						cache_creation: msg.cacheCreationTokens,
						est_cost: msg.costUsd
					});
				});
			}

			if (sessionAccs.size === 0) continue;

			// One unit_of_work per Claude Code project directory. Kind is
			// 'initiative' when the resolved repo has a blueprint.yml at its
			// root (it IS a Blueprint initiative); 'project' otherwise. Falls
			// back to 'project' with the raw encoded key when no cwd was ever
			// observed (normalizeProjectPath's documented fallback).
			const { projectPath, repoName, normalized } = normalizeProjectPath(
				projectDirName,
				firstCwd
			);
			const hasBlueprintYml = normalized && existsSync(join(projectPath, 'blueprint.yml'));
			const kind = hasBlueprintYml ? 'initiative' : 'project';

			const unitResult = await client.query<{ upsert_unit_of_work: string }>(
				`SELECT upsert_unit_of_work($1, $2, $3, $4) AS upsert_unit_of_work`,
				[kind, repoName, 'path', projectPath]
			);
			const unitId = unitResult.rows[0].upsert_unit_of_work;

			for (const [sessionId, acc] of sessionAccs) {
				const model = dominantModel(acc);
				await client.query(
					`SELECT upsert_session($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
					[
						sessionId,
						projectPath,
						unitId,
						model,
						'anthropic',
						acc.editor,
						acc.inputTokens,
						acc.outputTokens,
						acc.cacheReadTokens,
						acc.cacheCreationTokens,
						acc.costUsd.toFixed(6),
						'estimated', // see anthropic-pricing.ts header: list-price valuation on subscription usage, never api_metered
						acc.messageCount,
						acc.startedAt,
						acc.endedAt,
						Array.from(acc.toolNames),
						'interactive'
					]
				);
				totalSessions += 1;
				totalCost += acc.costUsd;
			}

			// Bulk-insert message rows, chunked at 500 (LESSONS-LEARNED.md) with
			// ON CONFLICT DO NOTHING as the DB-level dedup layer — the
			// application-level layer is simply "we recompute from source and
			// let the constraint absorb re-runs."
			for (const batch of chunk(messageRows, 500)) {
				const values: unknown[] = [];
				const placeholders = batch
					.map((row, i) => {
						const base = i * 10;
						values.push(
							row.session_id,
							row.message_id,
							row.timestamp,
							row.model,
							'anthropic',
							row.input_tokens,
							row.output_tokens,
							row.cache_read,
							row.cache_creation,
							row.est_cost
						);
						return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, 'estimated')`;
					})
					.join(',');

				await client.query(
					`INSERT INTO messages (session_id, message_id, timestamp, model, provider, input_tokens, output_tokens, cache_read, cache_creation, est_cost, cost_provenance)
					 VALUES ${placeholders}
					 ON CONFLICT (message_id) DO NOTHING`,
					values
				);
				totalMessages += batch.length;
			}

			console.log(
				`  ${repoName} (${kind}): ${sessionAccs.size} sessions, ${messageRows.length} messages, $${[...sessionAccs.values()].reduce((s, a) => s + a.costUsd, 0).toFixed(2)}`
			);
		}

		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
		await pool.end();
	}

	console.log('');
	console.log(`Import complete: ${filesProcessed} files, ${totalSessions} sessions, ${totalMessages} messages, $${totalCost.toFixed(2)} estimated total`);
}

main().catch((err) => {
	console.error('Import failed:', err);
	process.exit(1);
});
