/**
 * Repo aliases (migration 0007): old repo folder names mapped to their
 * current name. Loaded once per ingest batch — the table holds one row per
 * rename, so a full read is cheaper than a lookup per event.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { RepoAliases } from '$lib/attribution/project-path';

export async function loadRepoAliases(db: D1Database): Promise<RepoAliases> {
	const { results } = await db
		.prepare('SELECT alias, canonical FROM repo_aliases')
		.all<{ alias: string; canonical: string }>();
	return new Map(results.map((r) => [r.alias, r.canonical]));
}
