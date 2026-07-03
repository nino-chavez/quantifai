/**
 * Deterministic REPO_ROOT discovery. The original loaders used
 * `dirname(fileURLToPath(import.meta.url))` plus 4× `..` to walk up from
 * src/lib/, but Astro's prerender pipeline rewrites `import.meta.url` for
 * nested routes (try/scenarios, inspect/gates, etc), producing a wrong
 * anchor and an `apps/apps/...` path.
 *
 * Instead, walk up from process.cwd() looking for blueprint.yml — the
 * consumer-universal marker that sits at every initiative root (the file the
 * stamper writes and portal-config.ts reads). Falls back to cwd so the loaders
 * still resolve (and degrade-to-empty) if the marker is ever absent.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

let _root: string | null = null;

export function repoRoot(): string {
  if (_root) return _root;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'blueprint.yml'))) {
      _root = dir;
      return _root;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  _root = process.cwd();
  return _root;
}
