import { describe, it, expect } from 'vitest';
import { resolveWindow } from './practice-numbers-shared';

const NOW = new Date('2026-07-03T12:00:00.000Z');

describe('resolveWindow', () => {
	it('defaults to the 30-day window when no param is given', () => {
		const w = resolveWindow(null, NOW);
		expect(w.label).toBe('30');
		expect(w.days).toBe(30);
	});

	it('resolves the 90-day window', () => {
		const w = resolveWindow('90', NOW);
		expect(w.label).toBe('90');
		expect(w.days).toBe(90);
		expect(w.sinceIso).toBe(new Date(NOW.getTime() - 90 * 86_400_000).toISOString());
	});

	it('resolves the all-time window with no lower bound', () => {
		const w = resolveWindow('all', NOW);
		expect(w.label).toBe('all');
		expect(w.days).toBeNull();
		expect(w.sinceIso).toBeNull();
	});

	it('falls back to 30 days for an unrecognized param rather than throwing', () => {
		const w = resolveWindow('garbage', NOW);
		expect(w.label).toBe('30');
	});
});
