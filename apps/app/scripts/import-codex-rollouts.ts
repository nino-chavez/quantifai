#!/usr/bin/env -S npx tsx
/**
 * Importer: Codex rollouts (~/.codex/sessions, ~/.codex/archived_sessions)
 * -> sessions / messages / units_of_work, provider `openai`.
 *
 * Adds a Codex reader at the operator's request (2026-10-06). ADR-0004's v1
 * source list names Claude Code JSONL, git events, and BYOK pollers only; this
 * is the JTBD it said a new reader waits for.
 *
 * Parsing and the one-source-per-file rule live in
 * src/lib/importers/codex-rollout.ts. This script groups by session id ACROSS
 * files (a resumed thread can span two rollouts) because the server overwrites
 * session totals: every file of a session must be in the same run.
 *
 * Project path: a session's cwd collapses to its repo root for `<repo>/.worktrees/...`
 * and `.claude/worktrees/`. A Codex-managed worktree (~/.codex/worktrees/<id>/<repo>)
 * resolves to its main checkout through `git --git-common-dir` while the worktree
 * still exists. For a deleted one, the folder name decides: if exactly one other
 * session's resolved project has that name (or exactly one such project still
 * exists on disk), the worktree session joins it;
 * otherwise it keeps its own path and is counted as unresolved.
 *
 * Cost: `estimated` from openai-pricing.ts. A model the pricing page does not
 * list is stored at $0 and reported as unpriced — never guessed.
 *
 * Usage:
 *   npm run import:codex -- --dry-run            # totals only, no network
 *   npm run import:codex -- --session <id>       # one session, then query it back
 *   npm run import:codex                         # everything
 * Env: QUANTIFAI_API_URL, QUANTIFAI_API_KEY (remote write); CODEX_HOME (default ~/.codex).
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { loadDotEnv, postIngestBatch } from './lib/ingest-client';
import { createCodexRolloutParser, type CodexRollout, type OpenAIUsageTotals } from '../src/lib/importers/codex-rollout';
import { newAccumulator, accumulate, dominantModel, type UsageMessage } from '../src/lib/importers/usage-record';
import { normalizeProjectPath } from '../src/lib/attribution/project-path';
import { chunk } from '../src/lib/importers/chunk';

loadDotEnv();

const args = process.argv.slice(2);
const argValue = (flag: string) => {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = args.includes('--dry-run');
const ONLY_SESSION = argValue('--session');
const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const ROOTS = [join(CODEX_HOME, 'sessions'), join(CODEX_HOME, 'archived_sessions')];
const MESSAGE_POST_CHUNK = 4000;
const SESSION_POST_CHUNK = 1000;

function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) out.push(...walk(full));
		else if (entry.endsWith('.jsonl')) out.push(full);
	}
	return out;
}

/** The session id from a rollout's session_meta line (first lines only). */
async function sessionIdOf(path: string): Promise<string | null> {
	const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
	try {
		for await (const line of rl) {
			if (!line.includes('"session_meta"')) continue;
			try {
				return JSON.parse(line).payload?.id ?? null;
			} catch {
				return null;
			}
		}
		return null;
	} finally {
		rl.close();
	}
}

async function parseFile(path: string, baselineTotal: OpenAIUsageTotals | null): Promise<CodexRollout> {
	const parser = createCodexRolloutParser({ fileKey: basename(path, '.jsonl'), baselineTotal });
	const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
	let index = 0;
	for await (const line of rl) parser.push(line, index++);
	return parser.finish();
}

const commonDirCache = new Map<string, string | null>();
let unresolvedCodexWorktrees = 0;

/** Repo root for a session cwd; see header for the rules. */
function projectRoot(cwd: string): string {
	const dotWorktrees = cwd.indexOf('/.worktrees/');
	if (dotWorktrees !== -1) return cwd.slice(0, dotWorktrees);
	if (cwd.includes('/.codex/worktrees/')) {
		if (!commonDirCache.has(cwd)) {
			let root: string | null;
			try {
				const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'ignore']
				}).trim();
				root = common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : null;
			} catch {
				root = null;
			}
			commonDirCache.set(cwd, root);
		}
		const root = commonDirCache.get(cwd);
		if (root) return root;
		unresolvedCodexWorktrees += 1;
		return cwd;
	}
	return normalizeProjectPath('', cwd).projectPath; // collapses .claude/worktrees
}

async function main() {
	const files = ROOTS.flatMap(walk);
	console.log(`Found ${files.length} rollout files under ${ROOTS.join(', ')}`);

	// Group files by session id, then parse each session's rollouts oldest
	// first (filenames start with the rollout's start time) so a resumed file's
	// running total is read against the previous file's last total.
	const filesBySession = new Map<string, string[]>();
	for (const file of files) {
		const sid = (await sessionIdOf(file)) ?? `nometa:${file}`;
		if (ONLY_SESSION && sid !== ONLY_SESSION) continue;
		if (!filesBySession.has(sid)) filesBySession.set(sid, []);
		filesBySession.get(sid)!.push(file);
	}

	const bySession = new Map<string, { cwd: string | null; editor: string | null; messages: Map<string, UsageMessage> }>();
	const sourceCounts: Record<string, number> = {};
	let unpricedTokens = 0;
	let resumedFiles = 0;
	for (const sessionFiles of filesBySession.values()) {
		sessionFiles.sort((a, b) => basename(a).localeCompare(basename(b)));
		let baseline: OpenAIUsageTotals | null = null;
		for (const file of sessionFiles) {
			if (baseline) resumedFiles += 1;
			const r = await parseFile(file, baseline);
			baseline = r.lastTotal;
			sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
			if (!r.sessionId || r.messages.length === 0) continue;
			unpricedTokens += r.unpricedTokens;
			let s = bySession.get(r.sessionId);
			if (!s) bySession.set(r.sessionId, (s = { cwd: r.cwd, editor: r.editor, messages: new Map() }));
			for (const m of r.messages) {
				// A repeated response id is the same response logged twice (safe to
				// dedupe). A repeated synthetic id means two rows collided: stop.
				if (s.messages.has(m.messageId) && m.messageId.startsWith('codex:')) {
					throw new Error(`synthetic message id collision ${m.messageId} in session ${r.sessionId}`);
				}
				s.messages.set(m.messageId, m);
			}
		}
	}

	const units = new Map<string, { kind: 'initiative' | 'project'; name: string; source: 'path'; projectPath: string }>();
	const sessions: unknown[] = [];
	const messages: unknown[] = [];
	const perModel = new Map<string, { messages: number; input: number; cached: number; output: number; cost: number }>();

	// Resolve paths first, then fold deleted Codex worktrees into the one real
	// project with the same folder name (ambiguous or absent names stay put).
	const resolved = new Map<string, string>();
	for (const [sessionId, s] of bySession) resolved.set(sessionId, s.cwd && s.cwd.startsWith('/') ? projectRoot(s.cwd) : 'unknown');
	const realByName = new Map<string, Set<string>>();
	for (const p of resolved.values()) {
		if (p === 'unknown' || p.includes('/.codex/worktrees/')) continue;
		const name = p.split('/').filter(Boolean).pop()!;
		if (!realByName.has(name)) realByName.set(name, new Set());
		realByName.get(name)!.add(p);
	}
	let foldedByName = 0;
	for (const [sessionId, p] of resolved) {
		if (!p.includes('/.codex/worktrees/')) continue;
		const all = [...(realByName.get(p.split('/').filter(Boolean).pop()!) ?? [])];
		// Same name under an old (pre-reorg) path too: the one still on disk wins.
		const matches = all.length > 1 ? all.filter((m) => existsSync(m)) : all;
		if (matches.length === 1) {
			resolved.set(sessionId, matches[0]);
			foldedByName += 1;
			unresolvedCodexWorktrees -= 1;
		}
	}

	for (const [sessionId, s] of bySession) {
		const projectPath = resolved.get(sessionId)!;
		const repoName = projectPath.split('/').filter(Boolean).pop() ?? projectPath;
		if (projectPath !== 'unknown' && !units.has(projectPath)) {
			units.set(projectPath, {
				kind: existsSync(join(projectPath, 'blueprint.yml')) ? 'initiative' : 'project',
				name: repoName,
				source: 'path',
				projectPath
			});
		}
		const acc = newAccumulator(sessionId);
		for (const m of s.messages.values()) {
			accumulate(acc, m);
			const pm = perModel.get(m.model) ?? { messages: 0, input: 0, cached: 0, output: 0, cost: 0 };
			pm.messages += 1;
			pm.input += m.inputTokens;
			pm.cached += m.cacheReadTokens;
			pm.output += m.outputTokens;
			pm.cost += m.costUsd;
			perModel.set(m.model, pm);
			messages.push({
				sessionId,
				messageId: m.messageId,
				timestamp: m.timestamp,
				model: m.model,
				provider: 'openai',
				inputTokens: m.inputTokens,
				outputTokens: m.outputTokens,
				cacheRead: m.cacheReadTokens,
				cacheCreation: m.cacheCreationTokens,
				estCost: m.costUsd,
				costProvenance: 'estimated',
				recordType: null
			});
		}
		sessions.push({
			sessionId,
			unitProjectPath: projectPath === 'unknown' ? null : projectPath,
			projectPath,
			model: dominantModel(acc),
			provider: 'openai',
			editor: s.editor,
			inputTokens: acc.inputTokens,
			outputTokens: acc.outputTokens,
			cacheRead: acc.cacheReadTokens,
			cacheCreation: acc.cacheCreationTokens,
			totalCost: acc.costUsd,
			costProvenance: 'estimated',
			messageCount: acc.messageCount,
			startedAt: acc.startedAt,
			endedAt: acc.endedAt,
			toolNames: Array.from(acc.toolNames),
			source: 'interactive'
		});
	}

	console.log(`Per-file usage source:`, JSON.stringify(sourceCounts), `| resumed rollouts read against a prior file: ${resumedFiles}`);
	console.log(`${sessions.length} sessions, ${messages.length} messages, ${units.size} units; deleted Codex worktrees: ${foldedByName} joined their repo by name, ${unresolvedCodexWorktrees} kept their own path`);
	for (const [model, pm] of [...perModel].sort((a, b) => b[1].cost - a[1].cost)) {
		console.log(
			`  ${model.padEnd(20)} ${String(pm.messages).padStart(7)} msgs  in ${(pm.input / 1e6).toFixed(1)}M  cached ${(pm.cached / 1e6).toFixed(1)}M  out ${(pm.output / 1e6).toFixed(2)}M  $${pm.cost.toFixed(2)}`
		);
	}
	console.log(`Unpriced tokens (model not on the OpenAI pricing page, stored at $0): ${unpricedTokens.toLocaleString()}`);
	if (DRY_RUN) return;

	const apiUrl = process.env.QUANTIFAI_API_URL ?? '';
	const apiKey = process.env.QUANTIFAI_API_KEY ?? '';
	if (!apiUrl || !apiKey) throw new Error('QUANTIFAI_API_URL and QUANTIFAI_API_KEY must be set (or pass --dry-run).');
	const api = { apiUrl, apiKey };
	const unitsOfWork = Array.from(units.values());

	for (const sessionChunk of chunk(sessions, SESSION_POST_CHUNK)) {
		const result = (await postIngestBatch({ unitsOfWork, sessions: sessionChunk }, api)) as { sessions?: number };
		// A 200 that wrote nothing is the failure this guards against.
		if (result.sessions !== sessionChunk.length) {
			throw new Error(`server wrote ${result.sessions} of ${sessionChunk.length} sessions: ${JSON.stringify(result)}`);
		}
		console.log(`  POST units+sessions chunk: ${JSON.stringify(result)}`);
	}
	const messageChunks = chunk(messages, MESSAGE_POST_CHUNK);
	for (let i = 0; i < messageChunks.length; i += 1) {
		const result = (await postIngestBatch({ messages: messageChunks[i] }, api)) as { messages?: { accepted: number; errors: number } };
		if (!result.messages || result.messages.errors > 0) {
			throw new Error(`message chunk ${i + 1} failed: ${JSON.stringify(result)}`);
		}
		console.log(`  POST messages chunk ${i + 1}/${messageChunks.length}: ${JSON.stringify(result.messages)}`);
	}
	console.log(`Import complete: ${sessions.length} sessions, ${messages.length} messages`);
}

main().catch((err) => {
	console.error('Codex import failed:', err);
	process.exit(1);
});
