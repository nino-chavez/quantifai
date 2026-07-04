/**
 * `reroute` (universal hook, runs before `handle`) — the host-split
 * routing mechanism this task's architecture spec calls for. It changes
 * which `src/routes/**` component tree SvelteKit matches WITHOUT changing
 * `event.url`/the address bar, so:
 *
 *  - app.quantifai.app and *.workers.dev keep matching "/" to the existing
 *    ledger route (src/routes/+page.svelte) exactly as before this task —
 *    `reroute` returns `undefined` for those hosts, i.e. does nothing.
 *  - quantifai.app's "/" is remapped, for routing purposes only, to
 *    `/landing` (src/routes/landing/+page.svelte) — the new public page.
 *    `www.quantifai.app` doesn't need an entry here: src/hooks.server.ts's
 *    `handle` redirects every www request to the apex before `resolve()`
 *    (and therefore before routing) ever runs.
 *
 * Must stay a pure function of `url` (SvelteKit caches reroute results per
 * URL) — no side effects, no I/O.
 */

import type { Reroute } from '@sveltejs/kit';

export const reroute: Reroute = ({ url }) => {
	if (url.hostname === 'quantifai.app' && url.pathname === '/') {
		return '/landing';
	}
};
