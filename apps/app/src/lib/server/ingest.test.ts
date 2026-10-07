/**
 * `POST /api/v1/ingest` git-events handling (ADR-0004 deterministic-linkage
 * slice): a batch that carries a client-resolved `noteSessionId` (the
 * importer read a local refs/notes/quantifai note) must use it directly and
 * skip the server's own time-window join; a batch without one falls back to
 * the join exactly as before. Runs against the real SQLite fake-d1 harness
 * (same discipline as git-events.test.ts / provider-costs.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { createFakeD1, d1RoundTrips } from './test-support/fake-d1';
import { processIngestBatch, type IngestGitEvent, type IngestSessionAggregate } from './ingest';

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

function session(sessionId: string, projectPath: string, startedAt: string, endedAt: string): IngestSessionAggregate {
	return {
		sessionId,
		projectPath,
		unitProjectPath: projectPath,
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
		startedAt,
		endedAt,
		toolNames: [],
		source: 'interactive'
	};
}

const DEV = '/Users/nino/Workspace/dev';
const unitAt = (projectPath: string) => ({ kind: 'project' as const, name: 'atelier', source: 'path' as const, projectPath });

async function storedLink(db: ReturnType<typeof createFakeD1>, sha: string) {
	return db
		.prepare(
			`SELECT g.session_id, u.project_path AS unit_path FROM git_events g
			 LEFT JOIN units_of_work u ON u.id = g.unit_id WHERE g.commit_sha = ?1`
		)
		.bind(sha)
		.first<{ session_id: string | null; unit_path: string | null }>();
}

describe('processIngestBatch — linking across a repo’s path spellings', () => {
	it('links a commit from the current checkout to sessions stored under older, other-Mac, and worktree paths', async () => {
		const db = createFakeD1();
		await processIngestBatch(db, {
			unitsOfWork: [unitAt(`${DEV}/wip/atelier`)],
			sessions: [
				session('pre-reorg', `${DEV}/wip/atelier`, '2026-05-01T10:00:00.000Z', '2026-05-01T11:00:00.000Z'),
				session('other-mac', '/Users/nino.chavez/Workspace/dev/wip/atelier', '2026-05-02T10:00:00.000Z', '2026-05-02T11:00:00.000Z'),
				session('worktree', `${DEV}/labs/atelier/.worktrees/feat/x`, '2026-05-03T10:00:00.000Z', '2026-05-03T11:00:00.000Z'),
				session('different-repo', `${DEV}/apps/atelier-dashboard-blueprint`, '2026-05-04T10:00:00.000Z', '2026-05-04T11:00:00.000Z')
			]
		});

		const commitAt = (commitSha: string, authoredAt: string) =>
			gitEvent({ repo: 'atelier', commitSha, authoredAt, unitProjectPath: `${DEV}/labs/atelier` });
		const result = await processIngestBatch(db, {
			gitEvents: [
				commitAt('c1', '2026-05-01T10:30:00.000Z'),
				commitAt('c2', '2026-05-02T10:30:00.000Z'),
				commitAt('c3', '2026-05-03T10:30:00.000Z'),
				commitAt('c4', '2026-05-04T10:30:00.000Z') // only a different repo's session covers this
			]
		});

		expect(result.gitEvents).toEqual({ accepted: 4, linked: 3, deterministic: 0 });
		expect(await storedLink(db, 'c1')).toEqual({ session_id: 'pre-reorg', unit_path: `${DEV}/wip/atelier` });
		expect((await storedLink(db, 'c2'))?.session_id).toBe('other-mac');
		expect((await storedLink(db, 'c3'))?.session_id).toBe('worktree');
		expect((await storedLink(db, 'c4'))?.session_id).toBeNull();
	});

	it('replays the 2026-10-06 incident: a re-run that can place nothing keeps every link and reports them', async () => {
		const db = createFakeD1();
		await processIngestBatch(db, {
			unitsOfWork: [unitAt(`${DEV}/wip/atelier`)],
			sessions: [session('s1', `${DEV}/wip/atelier`, '2026-05-01T10:00:00.000Z', '2026-05-01T11:00:00.000Z')]
		});
		const first = { repo: 'atelier', commitSha: 'c1', authoredAt: '2026-05-01T10:30:00.000Z' };
		await processIngestBatch(db, { gitEvents: [gitEvent({ ...first, unitProjectPath: `${DEV}/wip/atelier` })] });

		// Same commit, re-imported from a path this database cannot place at all.
		const rerun = await processIngestBatch(db, {
			gitEvents: [gitEvent({ ...first, unitProjectPath: `${DEV}/labs/atelier-renamed` })]
		});

		expect(await storedLink(db, 'c1')).toEqual({ session_id: 's1', unit_path: `${DEV}/wip/atelier` });
		expect(rerun.gitEvents).toEqual({ accepted: 1, linked: 1, deterministic: 0 });
	});
});

describe('processIngestBatch — git-event query cost', () => {
	it('resolves the unit and session windows once per repo and upserts in batches, not one query per commit', async () => {
		const db = createFakeD1();
		await processIngestBatch(db, {
			unitsOfWork: [unitAt(`${DEV}/labs/atelier`)],
			sessions: [session('s1', `${DEV}/labs/atelier`, '2026-05-01T00:00:00.000Z', '2026-05-02T00:00:00.000Z')]
		});
		const before = d1RoundTrips(db);

		const events = Array.from({ length: 1000 }, (_, i) =>
			gitEvent({
				repo: 'atelier',
				commitSha: `sha-${i}`,
				authoredAt: '2026-05-01T12:00:00.000Z',
				unitProjectPath: `${DEV}/labs/atelier`
			})
		);
		const result = await processIngestBatch(db, { gitEvents: events });
		const after = d1RoundTrips(db);

		expect(result.gitEvents).toEqual({ accepted: 1000, linked: 1000, deterministic: 0 });
		expect(after.queries - before.queries).toBe(2); // one unit lookup + one session-window query
		expect(after.batches - before.batches).toBe(10); // 1000 upserts / 100 per batch
	});

	it('caches a unit lookup that found nothing instead of repeating it per commit', async () => {
		const db = createFakeD1();
		const before = d1RoundTrips(db);
		const events = Array.from({ length: 50 }, (_, i) =>
			gitEvent({ repo: 'no-sessions', commitSha: `sha-${i}`, unitProjectPath: `${DEV}/labs/no-sessions` })
		);
		await processIngestBatch(db, { gitEvents: events });
		expect(d1RoundTrips(db).queries - before.queries).toBe(2);
	});
});
