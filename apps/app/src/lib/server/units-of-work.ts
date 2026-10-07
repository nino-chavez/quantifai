/**
 * Atomic unit-of-work upsert — SQLite translation of the Postgres
 * `upsert_unit_of_work()` function (supabase/migrations/20260703000001_functions.sql),
 * per ADR-0005. Idempotent on (kind, project_path); `id` is generated
 * app-side (D1/SQLite has no `gen_random_uuid()`) and only takes effect on
 * first insert — ON CONFLICT DO UPDATE never touches the `id` column, so a
 * repeat call always returns the original row's id.
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
	canonicalRepo,
	pickUnitForRepo,
	repoKey,
	repoNames,
	NO_REPO_ALIASES,
	type RepoAliases,
	type UnitCandidate
} from '$lib/attribution/project-path';

export type UnitOfWorkKind = 'initiative' | 'project' | 'session';
export type UnitOfWorkSource = 'git' | 'blueprint' | 'path';

export interface UnitOfWorkInput {
	kind: UnitOfWorkKind;
	name: string;
	source: UnitOfWorkSource;
	projectPath: string;
}

export async function upsertUnitOfWork(db: D1Database, input: UnitOfWorkInput): Promise<string> {
	const id = crypto.randomUUID();
	const row = await db
		.prepare(
			`INSERT INTO units_of_work (id, kind, name, source, project_path)
			 VALUES (?1, ?2, ?3, ?4, ?5)
			 ON CONFLICT (kind, project_path) DO UPDATE SET
			   name = excluded.name,
			   source = excluded.source
			 RETURNING id`
		)
		.bind(id, input.kind, input.name, input.source, input.projectPath)
		.first<{ id: string }>();

	if (!row) throw new Error(`upsertUnitOfWork: no row returned for ${input.projectPath}`);
	return row.id;
}

/** Look up (don't create) a unit_of_work by project_path — mirrors import-git-events.ts's rule: a repo with zero Claude Code sessions has no unit yet, and git import must not invent one. */
export async function findUnitIdByProjectPath(
	db: D1Database,
	projectPath: string
): Promise<string | null> {
	const row = await db
		.prepare(`SELECT id FROM units_of_work WHERE project_path = ?1 LIMIT 1`)
		.bind(projectPath)
		.first<{ id: string }>();
	return row?.id ?? null;
}

/**
 * Look up (never create) the unit a git commit from `projectPath` belongs
 * to, across every path the repo has been stored under. An exact match is
 * all the old lookup could find, so a re-import from a moved checkout
 * (`labs/atelier` while the unit was recorded at `wip/atelier`) resolved no
 * unit — and, before the upsert's never-erase rule, wrote that NULL over the
 * stored one. See pickUnitForRepo for when it declines to choose.
 */
export async function findUnitIdForRepo(
	db: D1Database,
	projectPath: string,
	aliases: RepoAliases = NO_REPO_ALIASES
): Promise<string | null> {
	const names = repoNames(canonicalRepo(repoKey(projectPath), aliases), aliases);
	const { results } = await db
		.prepare(
			`SELECT id, project_path FROM units_of_work
			 WHERE ${names.map((_, i) => `instr(project_path, ?${i + 1}) > 0`).join(' OR ')}`
		)
		.bind(...names)
		.all<UnitCandidate>();
	return pickUnitForRepo(projectPath, results, aliases);
}
