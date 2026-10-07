/**
 * POST /api/v1/ingest batch processing — shared by the route handler and
 * (indirectly, as the reference shape) the importer scripts' remote mode.
 *
 * Salvaged from quantifai-platform's `POST /api/v1/ingest`
 * (dedup-via-ON-CONFLICT-DO-NOTHING, chunked upserts, batch-size cap) and
 * adapted to D1 + this schema's normalized-batch wire format: the importer
 * has already read the local JSONL/git-log source and computed session
 * aggregates client-side (same `SessionAccumulator` logic as the local-D1
 * path uses), so the batch carries units-of-work + session aggregates +
 * message rows + git events, not raw per-message shipper records the server
 * would need to aggregate itself.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { chunk } from '$lib/importers/chunk';
import { findSessionForCommitInRepo } from '$lib/importers/git-log';
import { upsertUnitOfWork, findUnitIdByProjectPath, findUnitIdForRepo, type UnitOfWorkInput } from './units-of-work';
import { upsertSession, insertMessages, type SessionAggregateInput, type MessageRow } from './sessions';
import { upsertGitEvents, sessionWindowsForRepo, type GitEventInput } from './git-events';
import { canonicalRepo, repoKey, NO_REPO_ALIASES } from '$lib/attribution/project-path';
import { loadRepoAliases } from './repo-aliases';

/** Batch-size cap on the largest array (messages) — mirrors the retired platform's MAX_BATCH_SIZE. */
export const MAX_BATCH_SIZE = 10_000;
const UPSERT_CHUNK_SIZE = 500;

export interface IngestSessionAggregate extends Omit<SessionAggregateInput, 'unitId'> {
	/** Resolved server-side from the batch's units-of-work — client sends the path, not a server-generated id it can't know yet. */
	unitProjectPath: string | null;
}

/**
 * Raw commit — no client-resolved session/unit. The server does the
 * time-window join itself (it has direct D1 access with no row cap, per
 * ADR-0005), so scripts/import-git-events.ts's remote mode only has to ship
 * `git log` output, not pre-joined rows.
 */
export interface IngestGitEvent {
	repo: string;
	commitSha: string;
	authoredAt: string;
	message: string | null;
	/** Look up (never create) — a repo with zero Claude Code sessions has no unit yet. */
	unitProjectPath: string | null;
	/** Classified client-side from `%P` parent-hash count (src/lib/importers/git-log.ts) — 2+ parents = merge. */
	isMerge: boolean;
	/**
	 * Session id resolved from a LOCAL `refs/notes/quantifai` git-note on the
	 * importer's machine (src/lib/importers/git-notes.ts) — deterministic
	 * linkage, ADR-0004. Notes never leave the machine that wrote them unless
	 * explicitly pushed, so the importer resolves this client-side and ships
	 * the result; the server has no way to read a note it was never sent.
	 * When present, this always wins over the server's own time-window join
	 * for the same commit.
	 */
	noteSessionId?: string | null;
}

export interface IngestBatch {
	unitsOfWork?: UnitOfWorkInput[];
	sessions?: IngestSessionAggregate[];
	messages?: MessageRow[];
	gitEvents?: IngestGitEvent[];
}

export interface IngestResult {
	unitsOfWork: number;
	sessions: number;
	messages: { accepted: number; errors: number };
	/** `linked` counts every git_event that ended up with a session_id, by either method; `deterministic` is the git-notes subset of `linked`. */
	gitEvents: { accepted: number; linked: number; deterministic: number };
}

export class IngestBatchTooLargeError extends Error {}

function assertBatchSize(batch: IngestBatch) {
	const total =
		(batch.messages?.length ?? 0) +
		(batch.sessions?.length ?? 0) +
		(batch.gitEvents?.length ?? 0);
	if (total > MAX_BATCH_SIZE) {
		throw new IngestBatchTooLargeError(`Batch too large: ${total} > ${MAX_BATCH_SIZE}`);
	}
}

export async function processIngestBatch(db: D1Database, batch: IngestBatch): Promise<IngestResult> {
	assertBatchSize(batch);

	// 1. Units of work first — sessions/git-events resolve against them.
	const unitIdByPath = new Map<string, string>();
	for (const unit of batch.unitsOfWork ?? []) {
		const id = await upsertUnitOfWork(db, unit);
		unitIdByPath.set(unit.projectPath, id);
	}

	// 2. Sessions (chunked — each is its own atomic upsert; D1 has no
	// multi-row upsert-with-merge, so this is N statements, not 1).
	// Lookups are cached per path, misses included: a batch's sessions and
	// commits share a handful of paths, and an uncached lookup per row was
	// half of the ~9.6k queries an 8,000-commit import issued (2026-10-06).
	const sessionUnitCache = new Map<string, string | null>(unitIdByPath);
	async function sessionUnitId(projectPath: string | null): Promise<string | null> {
		if (!projectPath) return null;
		if (!sessionUnitCache.has(projectPath)) {
			sessionUnitCache.set(projectPath, await findUnitIdByProjectPath(db, projectPath));
		}
		return sessionUnitCache.get(projectPath) ?? null;
	}

	let sessionsWritten = 0;
	for (const batchOfSessions of chunk(batch.sessions ?? [], UPSERT_CHUNK_SIZE)) {
		for (const session of batchOfSessions) {
			const unitId = await sessionUnitId(session.unitProjectPath);
			await upsertSession(db, { ...session, unitId });
			sessionsWritten += 1;
		}
	}

	// 3. Messages — bulk INSERT ... ON CONFLICT DO NOTHING, chunked.
	let messagesAccepted = 0;
	let messageErrors = 0;
	for (const batchOfMessages of chunk(batch.messages ?? [], UPSERT_CHUNK_SIZE)) {
		try {
			messagesAccepted += await insertMessages(db, batchOfMessages);
		} catch (err) {
			console.error('insertMessages chunk failed:', err);
			messageErrors += batchOfMessages.length;
		}
	}

	// 4. Git events — look up (never create) the unit_id, same rule as
	// scripts/import-git-events.ts. A commit with a client-resolved
	// `noteSessionId` (a local git-notes record — deterministic, ADR-0004)
	// uses that directly and skips the join; everything else falls back to
	// the server-side time-window join (ADR-0005: no row cap means no reason
	// to push that join onto the importer's machine). Both the unit and the
	// session windows resolve by repo identity (repoKey), not one exact path,
	// so history recorded under a repo's older paths still links.
	// Old repo names (migration 0007) resolve to the current name before the
	// row is keyed, so a client still reporting a pre-rename folder name
	// updates the canonical row instead of starting a duplicate history.
	const aliases = batch.gitEvents?.length ? await loadRepoAliases(db) : NO_REPO_ALIASES;
	const gitUnitCache = new Map<string, string | null>();
	async function gitUnitId(projectPath: string | null): Promise<string | null> {
		if (!projectPath) return null;
		const fromBatch = unitIdByPath.get(projectPath);
		if (fromBatch) return fromBatch;
		if (!gitUnitCache.has(projectPath)) {
			gitUnitCache.set(projectPath, await findUnitIdForRepo(db, projectPath, aliases));
		}
		return gitUnitCache.get(projectPath) ?? null;
	}
	const windowCache = new Map<string, Awaited<ReturnType<typeof sessionWindowsForRepo>>>();
	async function windowsFor(key: string) {
		let windows = windowCache.get(key);
		if (!windows) {
			windows = await sessionWindowsForRepo(db, key, aliases);
			windowCache.set(key, windows);
		}
		return windows;
	}

	const gitInputs: GitEventInput[] = [];
	for (const event of batch.gitEvents ?? []) {
		let sessionId: string | null;
		let linkMethod: 'git_notes' | 'time_window';
		if (event.noteSessionId) {
			sessionId = event.noteSessionId;
			linkMethod = 'git_notes';
		} else {
			const key = canonicalRepo(event.unitProjectPath ? repoKey(event.unitProjectPath) : event.repo, aliases);
			const match = findSessionForCommitInRepo(
				{ sha: event.commitSha, authoredAt: event.authoredAt, message: event.message ?? '' },
				await windowsFor(key),
				event.unitProjectPath
			);
			sessionId = match?.sessionId ?? null;
			linkMethod = 'time_window';
		}
		gitInputs.push({
			repo: canonicalRepo(event.repo, aliases),
			commitSha: event.commitSha,
			authoredAt: event.authoredAt,
			message: event.message,
			unitId: await gitUnitId(event.unitProjectPath),
			sessionId,
			linkMethod,
			isMerge: event.isMerge
		});
	}

	// Count what the rows hold after the upsert, not what this run computed:
	// the never-regress and never-erase rules can keep a stored link over a
	// NULL or a guess, and the import summary is what an operator reads to
	// decide whether a re-run lost links.
	const stored = await upsertGitEvents(db, gitInputs);
	const gitEventsAccepted = stored.length;
	const gitEventsLinked = stored.filter((r) => r.sessionId).length;
	const gitEventsDeterministic = stored.filter((r) => r.linkMethod === 'git_notes').length;

	return {
		unitsOfWork: unitIdByPath.size,
		sessions: sessionsWritten,
		messages: { accepted: messagesAccepted, errors: messageErrors },
		gitEvents: { accepted: gitEventsAccepted, linked: gitEventsLinked, deterministic: gitEventsDeterministic }
	};
}
