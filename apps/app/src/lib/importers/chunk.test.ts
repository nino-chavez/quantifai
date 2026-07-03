import { describe, it, expect } from 'vitest';
import { chunk, DEDUP_CHUNK_SIZE } from './chunk';

describe('chunk', () => {
	it('splits an array into groups of the given size', () => {
		const items = Array.from({ length: 1201 }, (_, i) => i);
		const chunks = chunk(items, 500);
		expect(chunks).toHaveLength(3);
		expect(chunks[0]).toHaveLength(500);
		expect(chunks[1]).toHaveLength(500);
		expect(chunks[2]).toHaveLength(201);
	});

	it('defaults to the LESSONS-LEARNED 500-row chunk size', () => {
		const items = Array.from({ length: 1000 }, (_, i) => i);
		expect(chunk(items)).toHaveLength(2);
		expect(DEDUP_CHUNK_SIZE).toBe(500);
	});

	it('returns a single chunk for input smaller than the chunk size', () => {
		expect(chunk([1, 2, 3], 500)).toEqual([[1, 2, 3]]);
	});

	it('returns an empty array for empty input', () => {
		expect(chunk([], 500)).toEqual([]);
	});

	it('rejects a non-positive chunk size rather than looping forever', () => {
		expect(() => chunk([1, 2, 3], 0)).toThrow();
		expect(() => chunk([1, 2, 3], -1)).toThrow();
	});
});
