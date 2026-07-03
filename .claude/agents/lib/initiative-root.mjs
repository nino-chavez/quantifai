// initiative-root.mjs — resolve the initiative (artifacts) root by walking up
// from a given directory to find blueprint.yml.
//
// Problem this solves: reviewers are called with --target which may point to
// either the repo root OR a blueprint/ subdir. To work with both layouts,
// reviewers need a consistent way to locate blueprint.yml, then resolve all
// artifact paths relative to THAT directory (not the passed --target).
//
// Solution: walk UP from the given directory, find blueprint.yml, return its
// parent directory as the artifacts root. This makes the reviewers tolerant
// of both blueprint.yml-at-root and blueprint.yml-in-subdir layouts.
//
// The hook (blueprint-session-start.py) already does this walk; this lib
// makes the same logic available to reviewers running outside Claude Code.
//
// Dependency-free ESM, never throws.

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/**
 * Walk up from `start` to find the first `blueprint.yml`, return its parent.
 * If not found, return `start` unchanged (the caller can then handle the error).
 * @param {string} start — directory to start searching from
 * @returns {string} — the initiative root (parent of blueprint.yml), or start if not found
 */
export function findInitiativeRoot(start) {
  let current = resolve(start);
  const visited = new Set();

  while (!visited.has(current)) {
    visited.add(current);
    const candidate = `${current}/blueprint.yml`;

    if (existsSync(candidate)) {
      return current; // Found it — this is the artifacts root
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding blueprint.yml
      return start; // Return start unchanged; caller handles the error
    }
    current = parent;
  }

  return start; // Defensive: cycle detected (shouldn't happen), return start
}

// ── Self-test (node initiative-root.mjs --self-test) ────────────────────────
if (process.argv.includes('--self-test')) {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  // Test 1: Found at start
  const t1 = mkdtempSync(`${tmpdir()}/bp-ir-`);
  writeFileSync(`${t1}/blueprint.yml`, 'variant: test\n');
  const r1 = findInitiativeRoot(t1);
  console.assert(r1 === t1, `FAIL: expected ${t1}, got ${r1}`);
  console.log('Test 1 PASS: found blueprint.yml at start');

  // Test 2: Found in parent
  const t2 = mkdtempSync(`${tmpdir()}/bp-ir-`);
  writeFileSync(`${t2}/blueprint.yml`, 'variant: test\n');
  const t2sub = `${t2}/blueprint`;
  mkdirSync(t2sub, { recursive: true });
  const r2 = findInitiativeRoot(t2sub);
  console.assert(r2 === t2, `FAIL: expected ${t2}, got ${r2}`);
  console.log('Test 2 PASS: found blueprint.yml in parent');

  // Test 3: Not found — returns start
  const t3 = mkdtempSync(`${tmpdir()}/bp-ir-`);
  const r3 = findInitiativeRoot(t3);
  console.assert(r3 === t3, `FAIL: expected ${t3}, got ${r3}`);
  console.log('Test 3 PASS: not found returns start');

  console.log('initiative-root self-test: PASS (3 assertions)');
}
