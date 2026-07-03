/**
 * LESSONS-LEARNED.md: Supabase `.in()` / bulk operations must chunk at 500 —
 * PostgREST URL-encodes `.in()` arrays and 414s past that; bulk INSERT
 * statement sizes have the same practical ceiling. Applied wherever this
 * codebase batches rows for a single round-trip.
 */
export const DEDUP_CHUNK_SIZE = 500;

export function chunk<T>(items: T[], size: number = DEDUP_CHUNK_SIZE): T[][] {
	if (size <= 0) throw new Error('chunk size must be positive');
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}
