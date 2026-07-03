import { defineConfig } from '@playwright/test';

/**
 * ADR-0005: the app runs on Cloudflare Workers now, not Vite's Node preview
 * server — `vite preview` can't serve a Workers-target build (no SSR
 * runtime, no D1 binding). `wrangler dev` runs the actual built worker
 * (`.svelte-kit/cloudflare/_worker.js`) against local D1, which is what the
 * @smoke test needs to hit a real load function.
 */
export default defineConfig({
	webServer: { command: 'npm run build && wrangler dev --port 8787', port: 8787 },
	use: { baseURL: 'http://127.0.0.1:8787' },
	testMatch: '**/*.e2e.{ts,js}'
});
