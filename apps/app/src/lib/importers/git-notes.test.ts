import { describe, it, expect } from 'vitest';
import { parseNoteJson, parseGitNotesLog, GIT_NOTES_LOG_FORMAT, QUANTIFAI_NOTES_REF } from './git-notes';

describe('parseNoteJson', () => {
	it('parses a well-formed note', () => {
		const note = parseNoteJson('{"session_id":"abc-123","source":"heartbeat","ts":1783112449}');
		expect(note).toEqual({ sessionId: 'abc-123', source: 'heartbeat', ts: 1783112449 });
	});

	it('tolerates surrounding whitespace/newlines (git notes storage often adds a trailing newline)', () => {
		const note = parseNoteJson('\n{"session_id":"abc","source":"env","ts":1}\n');
		expect(note).toEqual({ sessionId: 'abc', source: 'env', ts: 1 });
	});

	it('returns null for invalid JSON rather than throwing', () => {
		expect(parseNoteJson('not json at all')).toBeNull();
	});

	it('returns null for an empty string', () => {
		expect(parseNoteJson('')).toBeNull();
		expect(parseNoteJson('   ')).toBeNull();
	});

	it('returns null when session_id is missing', () => {
		expect(parseNoteJson('{"source":"env","ts":1}')).toBeNull();
	});

	it('returns null when session_id is not a string', () => {
		expect(parseNoteJson('{"session_id":123,"source":"env","ts":1}')).toBeNull();
	});

	it('returns null when source is missing or empty', () => {
		expect(parseNoteJson('{"session_id":"abc","ts":1}')).toBeNull();
		expect(parseNoteJson('{"session_id":"abc","source":"","ts":1}')).toBeNull();
	});

	it('returns null when ts is missing or not a number', () => {
		expect(parseNoteJson('{"session_id":"abc","source":"env"}')).toBeNull();
		expect(parseNoteJson('{"session_id":"abc","source":"env","ts":"not-a-number"}')).toBeNull();
	});

	it('returns null for a JSON array or primitive (well-formed JSON, wrong shape)', () => {
		expect(parseNoteJson('[1,2,3]')).toBeNull();
		expect(parseNoteJson('"just a string"')).toBeNull();
		expect(parseNoteJson('42')).toBeNull();
	});

	it('ignores unknown extra fields rather than rejecting the note', () => {
		const note = parseNoteJson('{"session_id":"abc","source":"env","ts":1,"future_field":"whatever"}');
		expect(note).toEqual({ sessionId: 'abc', source: 'env', ts: 1 });
	});
});

describe('GIT_NOTES_LOG_FORMAT / QUANTIFAI_NOTES_REF', () => {
	it('references the notes ref this importer reads', () => {
		expect(QUANTIFAI_NOTES_REF).toBe('refs/notes/quantifai');
	});

	it('uses %H and %N with non-pipe separators', () => {
		expect(GIT_NOTES_LOG_FORMAT).toContain('%H');
		expect(GIT_NOTES_LOG_FORMAT).toContain('%N');
		expect(GIT_NOTES_LOG_FORMAT).not.toContain('|');
	});
});

describe('parseGitNotesLog', () => {
	it('maps commits with a note, skipping commits without one', () => {
		const output = ['abc123\x1f{"session_id":"s1","source":"heartbeat","ts":100}', 'def456\x1f'].join('\x1e');
		const notes = parseGitNotesLog(output);
		expect(notes.size).toBe(1);
		expect(notes.get('abc123')).toEqual({ sessionId: 's1', source: 'heartbeat', ts: 100 });
		expect(notes.has('def456')).toBe(false);
	});

	it('tolerates the leading newline git inserts before each record after the first (git log record separator behavior)', () => {
		const output = 'abc\x1f{"session_id":"s1","source":"env","ts":1}\x1e\ndef\x1f\x1e';
		const notes = parseGitNotesLog(output);
		expect(notes.get('abc')?.sessionId).toBe('s1');
		expect(notes.size).toBe(1);
	});

	it('returns an empty map for empty output', () => {
		expect(parseGitNotesLog('').size).toBe(0);
	});

	it('skips a malformed note (bad JSON) without dropping other commits in the same batch', () => {
		const output = [
			'abc\x1fnot-json',
			'def\x1f{"session_id":"s2","source":"env","ts":2}',
			'ghi\x1f{"session_id":123,"source":"env","ts":3}' // wrong type
		].join('\x1e');
		const notes = parseGitNotesLog(output);
		expect(notes.size).toBe(1);
		expect(notes.get('def')?.sessionId).toBe('s2');
		expect(notes.has('abc')).toBe(false);
		expect(notes.has('ghi')).toBe(false);
	});

	it('skips a record missing the sha', () => {
		const output = '\x1f{"session_id":"s1","source":"env","ts":1}\x1e' + 'abc\x1f{"session_id":"s2","source":"env","ts":2}';
		const notes = parseGitNotesLog(output);
		expect(notes.size).toBe(1);
		expect(notes.get('abc')?.sessionId).toBe('s2');
	});
});
