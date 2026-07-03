import { describe, it, expect } from 'vitest';
import { parseBlueprintTelemetry, deriveStageBoundaries, readBlueprintTelemetry } from './blueprint';

describe('parseBlueprintTelemetry', () => {
	it('parses well-formed records matching the emitter shape', () => {
		const text = [
			JSON.stringify({
				ts: '2026-07-03T10:00:00.000Z',
				stage: 'research',
				effort: 'high',
				model_tier: 'inherit',
				duration_ms: 600000,
				reviewer: 'pass'
			}),
			JSON.stringify({
				ts: '2026-07-03T11:00:00.000Z',
				stage: 'prototype',
				effort: 'high',
				model_tier: 'sonnet',
				duration_ms: null,
				reviewer: null
			})
		].join('\n');

		const records = parseBlueprintTelemetry(text);
		expect(records).toHaveLength(2);
		expect(records[0].stage).toBe('research');
		expect(records[1].duration_ms).toBeNull();
	});

	it('skips blank and garbled lines without throwing — matches the emitter own tolerance test', () => {
		const text = [
			JSON.stringify({ ts: '2026-07-03T10:00:00.000Z', stage: 'x', duration_ms: 1 }),
			'{ not json',
			'',
			JSON.stringify({ ts: '2026-07-03T10:00:03.000Z', stage: 'x', duration_ms: 3 })
		].join('\n');

		const records = parseBlueprintTelemetry(text);
		expect(records).toHaveLength(2);
	});

	it('drops a record with no ts field (the one required field)', () => {
		const text = JSON.stringify({ stage: 'research', duration_ms: 100 });
		expect(parseBlueprintTelemetry(text)).toHaveLength(0);
	});
});

describe('deriveStageBoundaries', () => {
	it('derives startedAt as ts - duration_ms and endedAt as ts', () => {
		const boundaries = deriveStageBoundaries([
			{
				ts: '2026-07-03T10:10:00.000Z',
				stage: 'research',
				effort: 'high',
				model_tier: 'inherit',
				duration_ms: 600000, // 10 minutes
				reviewer: 'pass'
			}
		]);
		expect(boundaries).toHaveLength(1);
		expect(boundaries[0].endedAt).toBe('2026-07-03T10:10:00.000Z');
		expect(boundaries[0].startedAt).toBe('2026-07-03T10:00:00.000Z');
	});

	it('produces a zero-width boundary when duration_ms is absent', () => {
		const boundaries = deriveStageBoundaries([
			{
				ts: '2026-07-03T10:10:00.000Z',
				stage: 'deploy',
				effort: null,
				model_tier: null,
				duration_ms: null,
				reviewer: null
			}
		]);
		expect(boundaries[0].startedAt).toBe(boundaries[0].endedAt);
	});

	it('drops records with no stage (cannot become a unit of work)', () => {
		const boundaries = deriveStageBoundaries([
			{ ts: '2026-07-03T10:10:00.000Z', stage: null, effort: null, model_tier: null, duration_ms: null, reviewer: null }
		]);
		expect(boundaries).toHaveLength(0);
	});
});

describe('readBlueprintTelemetry', () => {
	it('returns [] for a repo with no .blueprint/telemetry.jsonl — the common case, not an error', async () => {
		const result = await readBlueprintTelemetry('/tmp/definitely-not-a-real-blueprint-repo-xyz');
		expect(result).toEqual([]);
	});
});
