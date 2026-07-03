/**
 * `git_events` upsert never-regress guarantee (ADR-0004's deterministic
 * linkage slice): once a commit is linked via git-notes (`link_method =
 * 'git_notes'`), a later re-import must never downgrade it back to
 * `time_window` — even when that re-import recomputed (or lost) a
 * time-window match for the same commit. The reverse (upgrading
 * `time_window` -> `git_notes` once a note appears) always wins. Runs
 * against a real SQLite engine (test-support/fake-d1.ts), exercising the
 * actual `ON CONFLICT` SQL, not a JS re-implementation of it — same
 * discipline as provider-costs.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createFakeD1 } from './test-support/fake-d1';
import { upsertGitEvent, commitStatsByUnit, type GitEventInput } from './git-events';

/** git_events.unit_id is FK-constrained to units_of_work(id) — seed one so tests can attribute commits to a unit. */
async function seedUnit(db: D1Database, id: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO units_of_work (id, kind, name, source, project_path) VALUES (?1, 'project', ?1, 'path', ?1)`
		)
		.bind(id)
		.run();
}

function event(overrides: Partial<GitEventInput> = {}): GitEventInput {
	return {
		repo: 'quantifai-next',
		commitSha: 'abc123',
		authoredAt: '2026-07-03T10:00:00.000Z',
		message: 'feat: something',
		unitId: null,
		sessionId: null,
		linkMethod: 'time_window',
		isMerge: false,
		...overrides
	};
}

describe('upsertGitEvent — never-regress on link_method', () => {
	it('a fresh insert persists whatever link_method/session_id it is given', async () => {
		const db = createFakeD1();
		await upsertGitEvent(db, event({ linkMethod: 'git_notes', sessionId: 's1' }));

		const row = await db
			.prepare('SELECT session_id, link_method FROM git_events WHERE commit_sha = ?1')
			.bind('abc123')
			.first<{ session_id: string; link_method: string }>();
		expect(row).toEqual({ session_id: 's1', link_method: 'git_notes' });
	});

	it('a re-import with a time_window match never downgrades an existing git_notes row', async () => {
		const db = createFakeD1();
		await upsertGitEvent(db, event({ linkMethod: 'git_notes', sessionId: 'deterministic-session' }));
		// Re-import recomputed (or lost) the note and only has a time-window guess this time.
		await upsertGitEvent(db, event({ linkMethod: 'time_window', sessionId: 'guessed-session' }));

		const row = await db
			.prepare('SELECT session_id, link_method FROM git_events WHERE commit_sha = ?1')
			.bind('abc123')
			.first<{ session_id: string; link_method: string }>();
		expect(row).toEqual({ session_id: 'deterministic-session', link_method: 'git_notes' });
	});

	it('a note appearing after the fact upgrades an existing time_window row to git_notes', async () => {
		const db = createFakeD1();
		await upsertGitEvent(db, event({ linkMethod: 'time_window', sessionId: 'guessed-session' }));
		await upsertGitEvent(db, event({ linkMethod: 'git_notes', sessionId: 'deterministic-session' }));

		const row = await db
			.prepare('SELECT session_id, link_method FROM git_events WHERE commit_sha = ?1')
			.bind('abc123')
			.first<{ session_id: string; link_method: string }>();
		expect(row).toEqual({ session_id: 'deterministic-session', link_method: 'git_notes' });
	});

	it('two time_window re-imports in a row simply update to the latest guess (no regression rule to apply)', async () => {
		const db = createFakeD1();
		await upsertGitEvent(db, event({ linkMethod: 'time_window', sessionId: 's-old' }));
		await upsertGitEvent(db, event({ linkMethod: 'time_window', sessionId: 's-new' }));

		const row = await db
			.prepare('SELECT session_id, link_method FROM git_events WHERE commit_sha = ?1')
			.bind('abc123')
			.first<{ session_id: string; link_method: string }>();
		expect(row).toEqual({ session_id: 's-new', link_method: 'time_window' });
	});

	it('unit_id and is_merge always update regardless of link_method direction', async () => {
		const db = createFakeD1();
		await seedUnit(db, 'unit-1');
		await upsertGitEvent(db, event({ linkMethod: 'git_notes', sessionId: 's1', unitId: null, isMerge: false }));
		await upsertGitEvent(
			db,
			event({ linkMethod: 'time_window', sessionId: 's-guess', unitId: 'unit-1', isMerge: true })
		);

		const row = await db
			.prepare('SELECT unit_id, is_merge, link_method FROM git_events WHERE commit_sha = ?1')
			.bind('abc123')
			.first<{ unit_id: string; is_merge: number; link_method: string }>();
		expect(row?.unit_id).toBe('unit-1');
		expect(row?.is_merge).toBe(1);
		expect(row?.link_method).toBe('git_notes'); // still never regressed
	});
});

describe('commitStatsByUnit — deterministic_commit_count', () => {
	it('counts git_notes-linked commits separately from the total, grouped by unit', async () => {
		const db = createFakeD1();
		await seedUnit(db, 'u1');
		await seedUnit(db, 'u2');
		await upsertGitEvent(db, event({ commitSha: 'c1', unitId: 'u1', linkMethod: 'git_notes', sessionId: 's1' }));
		await upsertGitEvent(db, event({ commitSha: 'c2', unitId: 'u1', linkMethod: 'time_window', sessionId: 's2' }));
		await upsertGitEvent(db, event({ commitSha: 'c3', unitId: 'u1', linkMethod: 'time_window', sessionId: null }));
		await upsertGitEvent(db, event({ commitSha: 'c4', unitId: 'u2', linkMethod: 'git_notes', sessionId: 's3' }));

		const stats = await commitStatsByUnit(db, null);
		const u1 = stats.find((s) => s.unit_id === 'u1');
		const u2 = stats.find((s) => s.unit_id === 'u2');

		expect(u1).toMatchObject({ commit_count: 3, deterministic_commit_count: 1 });
		expect(u2).toMatchObject({ commit_count: 1, deterministic_commit_count: 1 });
	});

	it('reports zero deterministic commits when every link is time_window', async () => {
		const db = createFakeD1();
		await seedUnit(db, 'u1');
		await upsertGitEvent(db, event({ commitSha: 'c1', unitId: 'u1', linkMethod: 'time_window' }));

		const stats = await commitStatsByUnit(db, null);
		expect(stats[0].deterministic_commit_count).toBe(0);
	});
});
