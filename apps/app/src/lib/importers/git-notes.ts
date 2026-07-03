/**
 * Pure parsing for `git log --notes=<ref>` output carrying `%N` (the note
 * body) — the deterministic-linkage signal written by
 * `hooks/quantifai-post-commit` under `refs/notes/quantifai` (ADR-0004: the
 * Exceeds Ink git-notes mechanism this importer now reads, alongside the
 * time-window join it already had).
 *
 * Deliberately a separate module/format from src/lib/importers/git-log.ts
 * rather than a new field bolted onto `GIT_LOG_FORMAT` — that format's
 * message-parsing already relies on the commit subject being the last field
 * (`rest.join(FIELD_SEP)`), and a note is either present or not per commit
 * (independent of whether a commit has a message), so keeping the two log
 * invocations/parsers separate avoids re-deriving that contract instead of
 * risking it.
 */

export const QUANTIFAI_NOTES_REF = 'refs/notes/quantifai';

const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';

/** Pass to `git log --pretty=format:... --notes=refs/notes/quantifai`. */
export const GIT_NOTES_LOG_FORMAT = `%H${FIELD_SEP}%N${RECORD_SEP}`;

export interface QuantifaiNote {
	sessionId: string;
	/** Which rung of the hook's resolution ladder produced this note — 'env' | 'heartbeat' today; not a closed enum here since the hook is free to add rungs without a parser update. */
	source: string;
	ts: number;
}

/**
 * Parses one JSON note body. Tolerates malformed notes (bad JSON, wrong
 * shape, wrong field types) by returning null rather than throwing — a
 * corrupt or hand-edited note degrades that one commit back to the
 * time-window fallback, it never aborts the batch (DESIGN.md: an
 * un-attributed commit renders as such, never silently guessed, and here
 * that extends to "never silently crashes the whole import either").
 */
export function parseNoteJson(raw: string): QuantifaiNote | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;
	if (typeof obj.session_id !== 'string' || obj.session_id.length === 0) return null;
	if (typeof obj.source !== 'string' || obj.source.length === 0) return null;
	if (typeof obj.ts !== 'number' || !Number.isFinite(obj.ts)) return null;
	return { sessionId: obj.session_id, source: obj.source, ts: obj.ts };
}

/**
 * Parses the full `git log --pretty=format:GIT_NOTES_LOG_FORMAT --notes=...`
 * output into a sha -> note map. Commits with no note (the overwhelming
 * majority of pre-hook history) simply don't appear in the map — callers
 * treat a missing key the same as "no note," falling back to the
 * time-window join.
 */
export function parseGitNotesLog(output: string): Map<string, QuantifaiNote> {
	const notes = new Map<string, QuantifaiNote>();
	for (const rawRecord of output.split(RECORD_SEP)) {
		const record = rawRecord.replace(/^\n/, '');
		if (!record) continue;
		const sepIdx = record.indexOf(FIELD_SEP);
		if (sepIdx === -1) continue;
		const sha = record.slice(0, sepIdx).trim();
		const noteRaw = record.slice(sepIdx + 1);
		if (!sha || !noteRaw.trim()) continue;
		const note = parseNoteJson(noteRaw);
		if (note) notes.set(sha, note);
	}
	return notes;
}
