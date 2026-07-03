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
import { findSessionForCommit } from '$lib/importers/git-log';
import { upsertUnitOfWork, findUnitIdByProjectPath, type UnitOfWorkInput } from './units-of-work';
import { upsertSession, insertMessages, type SessionAggregateInput, type MessageRow } from './sessions';
import { upsertGitEvent, sessionWindowsForProject } from './git-events';

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
	gitEvents: { accepted: number; linked: number };
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
	let sessionsWritten = 0;
	for (const batchOfSessions of chunk(batch.sessions ?? [], UPSERT_CHUNK_SIZE)) {
		for (const session of batchOfSessions) {
			const unitId =
				(session.unitProjectPath && unitIdByPath.get(session.unitProjectPath)) ??
				(session.unitProjectPath ? await findUnitIdByProjectPath(db, session.unitProjectPath) : null);
			await upsertSession(db, { ...session, unitId: unitId ?? null });
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
	// scripts/import-git-events.ts — then do the time-window join against
	// this project's sessions server-side (ADR-0004: honest v0, no
	// cryptographic link; ADR-0005: no row cap means no reason to push this
	// join onto the importer's machine).
	let gitEventsAccepted = 0;
	let gitEventsLinked = 0;
	const windowCache = new Map<string, Awaited<ReturnType<typeof sessionWindowsForProject>>>();
	for (const event of batch.gitEvents ?? []) {
		const unitId =
			(event.unitProjectPath && unitIdByPath.get(event.unitProjectPath)) ??
			(event.unitProjectPath ? await findUnitIdByProjectPath(db, event.unitProjectPath) : null);

		let windows = event.unitProjectPath ? windowCache.get(event.unitProjectPath) : undefined;
		if (event.unitProjectPath && !windows) {
			windows = await sessionWindowsForProject(db, event.unitProjectPath);
			windowCache.set(event.unitProjectPath, windows);
		}
		const match = windows
			? findSessionForCommit(
					{ sha: event.commitSha, authoredAt: event.authoredAt, message: event.message ?? '' },
					windows
				)
			: null;

		await upsertGitEvent(db, {
			repo: event.repo,
			commitSha: event.commitSha,
			authoredAt: event.authoredAt,
			message: event.message,
			unitId: unitId ?? null,
			sessionId: match?.sessionId ?? null,
			linkMethod: 'time_window'
		});
		gitEventsAccepted += 1;
		if (match) gitEventsLinked += 1;
	}

	return {
		unitsOfWork: unitIdByPath.size,
		sessions: sessionsWritten,
		messages: { accepted: messagesAccepted, errors: messageErrors },
		gitEvents: { accepted: gitEventsAccepted, linked: gitEventsLinked }
	};
}
