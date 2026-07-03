/**
 * `POST /api/v1/ingest` git-events handling (ADR-0004 deterministic-linkage
 * slice): a batch that carries a client-resolved `noteSessionId` (the
 * importer read a local refs/notes/quantifai note) must use it directly and
 * skip the server's own time-window join; a batch without one falls back to
 * the join exactly as before. Runs against the real SQLite fake-d1 harness
 * (same discipline as git-events.test.ts / provider-costs.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { createFakeD1 } from './test-support/fake-d1';
import { processIngestBatch, type IngestGitEvent } from './ingest';

function gitEvent(overrides: Partial<IngestGitEvent> = {}): IngestGitEvent {
	return {
		repo: 'quantifai-next',
		commitSha: 'abc123',
		authoredAt: '2026-07-03T10:15:00.000Z',
		message: 'feat: something',
		unitProjectPath: '/Users/nino/Workspace/dev/wip/quantifai-next',
		isMerge: false,
		...overrides
	};
}

describe('processIngestBatch — git-notes deterministic linkage', () => {
	it('uses noteSessionId directly (link_method=git_notes), skipping the time-window join entirely', async () => {
		const db = createFakeD1();
		// A session window that would NOT match this commit's authoredAt if the
		// time-window join ran — proves the join was skipped, not just that it
		// happened to agree.
		const result = await processIngestBatch(db, {
			unitsOfWork: [
				{ kind: 'project', name: 'quantifai-next', source: 'path', projectPath: '/Users/nino/Workspace/dev/wip/quantifai-next' }
			],
			sessions: [
				{
					sessionId: 'time-window-guess',
					projectPath: '/Users/nino/Workspace/dev/wip/quantifai-next',
					unitProjectPath: '/Users/nino/Workspace/dev/wip/quantifai-next',
					model: 'claude',
					provider: 'anthropic',
					editor: null,
					inputTokens: 0,
					outputTokens: 0,
					cacheRead: 0,
					cacheCreation: 0,
					totalCost: 0,
					costProvenance: 'estimated',
					messageCount: 1,
					startedAt: '2026-07-03T10:00:00.000Z',
					endedAt: '2026-07-03T10:30:00.000Z', // DOES cover the commit's authoredAt
					toolNames: [],
					source: 'interactive'
				}
			],
			gitEvents: [gitEvent({ noteSessionId: 'deterministic-session-from-note' })]
		});

		expect(result.gitEvents).toEqual({ accepted: 1, linked: 1, deterministic: 1 });

		const row = await db
			.prepare('SELECT session_id, link_method FROM git_events WHERE commit_sha = ?1')
			.bind('abc123')
			.first<{ session_id: string; link_method: string }>();
		// The note's session wins even though the seeded window would also match.
		expect(row).toEqual({ session_id: 'deterministic-session-from-note', link_method: 'git_notes' });
	});

	it('falls back to the time-window join when no noteSessionId is present (unchanged v0 behavior)', async () => {
		const db = createFakeD1();
		const result = await processIngestBatch(db, {
			unitsOfWork: [
				{ kind: 'project', name: 'quantifai-next', source: 'path', projectPath: '/Users/nino/Workspace/dev/wip/quantifai-next' }
			],
			sessions: [
				{
					sessionId: 'time-window-match',
					projectPath: '/Users/nino/Workspace/dev/wip/quantifai-next',
					unitProjectPath: '/Users/nino/Workspace/dev/wip/quantifai-next',
					model: 'claude',
					provider: 'anthropic',
					editor: null,
					inputTokens: 0,
					outputTokens: 0,
					cacheRead: 0,
					cacheCreation: 0,
					totalCost: 0,
					costProvenance: 'estimated',
					messageCount: 1,
					startedAt: '2026-07-03T10:00:00.000Z',
					endedAt: '2026-07-03T10:30:00.000Z',
					toolNames: [],
					source: 'interactive'
				}
			],
			gitEvents: [gitEvent()] // no noteSessionId
		});

		expect(result.gitEvents).toEqual({ accepted: 1, linked: 1, deterministic: 0 });

		const row = await db
			.prepare('SELECT session_id, link_method FROM git_events WHERE commit_sha = ?1')
			.bind('abc123')
			.first<{ session_id: string; link_method: string }>();
		expect(row).toEqual({ session_id: 'time-window-match', link_method: 'time_window' });
	});

	it('a commit outside every session window with no note stays unlinked, same as before', async () => {
		const db = createFakeD1();
		const result = await processIngestBatch(db, {
			gitEvents: [gitEvent({ unitProjectPath: null, authoredAt: '2020-01-01T00:00:00.000Z' })]
		});
		expect(result.gitEvents).toEqual({ accepted: 1, linked: 0, deterministic: 0 });
	});
});
