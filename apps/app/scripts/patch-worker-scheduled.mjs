#!/usr/bin/env node
/**
 * Postbuild step (wired as `postbuild` in package.json, so `npm run build`
 * runs it automatically — npm's pre/post script convention).
 *
 * Why this exists: @sveltejs/adapter-cloudflare (checked v7.2.9, 2026-07-03)
 * generates a worker module with only a `fetch` export — there is no
 * config option, file convention, or merge point for a `scheduled` (Cron
 * Trigger), `queue`, or `email` handler (confirmed by reading
 * node_modules/@sveltejs/adapter-cloudflare/index.js and files/worker.js:
 * the adapter's `adapt()` step `rimraf`s and fully rewrites whatever file
 * `wrangler.jsonc`'s `main` points to on every build, so a hand-written
 * wrapper at that same path would just get deleted). This script runs
 * after the adapter writes `.svelte-kit/cloudflare/_worker.js` and appends
 * a `scheduled` handler to its default export in place.
 *
 * The appended handler does an IN-PROCESS self-fetch (calling the same
 * `worker_default.fetch` already exported, not a real network hop) against
 * `POST /api/v1/sync-providers` — reusing that route's existing D1 access
 * and provider-sync logic wholesale rather than duplicating it here. Auth
 * for this internal call is `CRON_SYNC_SECRET` (src/lib/server/sync-auth.ts),
 * a Worker secret distinct from the ingest key.
 *
 * This script FAILS THE BUILD (non-zero exit) if the generated file's
 * shape doesn't match what it expects, rather than silently no-op'ing —
 * an adapter upgrade that changes the template should break CI loudly, not
 * quietly ship a worker that never runs its cron sync (the same
 * fail-closed principle LESSONS-LEARNED.md applies to cron-secret checks).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, '..', '.svelte-kit', 'cloudflare', '_worker.js');

const MARKER = '// === patch-worker-scheduled.mjs: scheduled handler ===';

const SCHEDULED_PATCH = `
${MARKER}
worker_default.scheduled = async function (_controller, env, ctx) {
	const request = new Request('https://internal.quantifai.invalid/api/v1/sync-providers', {
		method: 'POST',
		headers: { 'x-cron-secret': env.CRON_SYNC_SECRET ?? '' }
	});
	ctx.waitUntil(worker_default.fetch(request, env, ctx));
};
`;

function fail(message) {
	console.error(`patch-worker-scheduled.mjs: ${message}`);
	process.exit(1);
}

let source;
try {
	source = readFileSync(workerPath, 'utf8');
} catch (err) {
	fail(`could not read ${workerPath} — did \`vite build\` run first? (${err.message})`);
}

if (source.includes(MARKER)) {
	console.log('patch-worker-scheduled.mjs: already patched, skipping.');
	process.exit(0);
}

if (!source.includes('var worker_default')) {
	fail(
		`expected to find "var worker_default" in ${workerPath} — the adapter's generated worker shape has changed; update this script's assumptions (see the header comment).`
	);
}

const exportAnchor = source.lastIndexOf('\nexport {');
if (exportAnchor === -1) {
	fail(`expected to find a trailing "export {" statement in ${workerPath} — the adapter's generated worker shape has changed.`);
}

const patched = source.slice(0, exportAnchor) + '\n' + SCHEDULED_PATCH + source.slice(exportAnchor);
writeFileSync(workerPath, patched);
console.log(`patch-worker-scheduled.mjs: added scheduled() handler to ${workerPath}`);
