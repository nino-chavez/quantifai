#!/usr/bin/env -S npx tsx
/**
 * Records (or updates) a `subscription_plans` row — the operator's actual
 * plan fee, entered by hand. NEVER fabricated: DESIGN.md rule 1 forbids a
 * guessed default, so every flag below is required and validated; there is
 * no fallback value anywhere in this script.
 *
 * This is an operator-run administrative action, not a machine-shipper
 * import, so (unlike import-claude-jsonl.ts / import-git-events.ts) it
 * writes directly via `wrangler d1 execute` — local or --remote — rather
 * than through the Bearer-gated /api/v1/ingest endpoint. That endpoint
 * exists for possibly-unattended importer machines; this script is always
 * run by the operator from their own authenticated wrangler session.
 *
 * Usage:
 *   npm run seed:plan -- --provider anthropic --plan "Claude Max" \
 *     --fee 200 --from 2026-01-01 [--to 2026-06-30] [--local]
 *
 *   --provider   matches sessions.provider (e.g. "anthropic")
 *   --plan       human-readable plan name (e.g. "Claude Max")
 *   --fee        monthly fee in USD, a positive number
 *   --from       ISO date (YYYY-MM-DD) the plan became active
 *   --to         ISO date (YYYY-MM-DD), inclusive end date; omit if still active
 *   --local      write to the local D1 file instead of the deployed database
 */

import { resolve } from 'node:path';
import { loadDotEnv, sqlLiteral, runD1File, randomUUID } from './lib/ingest-client';

loadDotEnv();

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
}
const LOCAL = args.includes('--local');
const APP_DIR = resolve(import.meta.dirname, '..'); // apps/app — where wrangler.jsonc lives

const USAGE =
	'Usage: npm run seed:plan -- --provider <provider> --plan "<name>" --fee <usd> --from <YYYY-MM-DD> [--to <YYYY-MM-DD>] [--local]';

const provider = argValue('--provider');
const planName = argValue('--plan');
const feeArg = argValue('--fee');
const activeFrom = argValue('--from');
const activeTo = argValue('--to') ?? null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): never {
	console.error(message);
	console.error(USAGE);
	console.error('No default plan fee is ever assumed — DESIGN.md rule 1 forbids a fabricated fee.');
	process.exit(1);
}

if (!provider || !planName || !feeArg || !activeFrom) {
	fail('Missing required flag(s).');
}

const fee = Number(feeArg);
if (!Number.isFinite(fee) || fee <= 0) {
	fail(`--fee must be a positive number, got: ${feeArg}`);
}
if (!ISO_DATE.test(activeFrom)) {
	fail(`--from must be an ISO date YYYY-MM-DD, got: ${activeFrom}`);
}
if (activeTo && !ISO_DATE.test(activeTo)) {
	fail(`--to must be an ISO date YYYY-MM-DD, got: ${activeTo}`);
}

const sql = `INSERT INTO subscription_plans (id, provider, plan_name, monthly_fee_usd, active_from, active_to)
	VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(provider)}, ${sqlLiteral(planName)}, ${fee}, ${sqlLiteral(activeFrom)}, ${sqlLiteral(activeTo)});`;

runD1File(sql, { cwd: APP_DIR, local: LOCAL });

console.log(
	`Recorded subscription plan: ${provider} / ${planName} — $${fee}/mo from ${activeFrom}` +
		`${activeTo ? ` to ${activeTo}` : ' (open-ended)'} (${LOCAL ? 'local D1' : 'remote D1'})`
);
