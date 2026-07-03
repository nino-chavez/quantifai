/**
 * Server-side data access for the `practice-numbers` page (DESIGN.md L4,
 * JTBD-3 — "substantiate the leverage claim with practice-level numbers").
 * Windowed (30/90/all) rollup of per-project/initiative cost+output plus
 * practice-wide rates (commits/week, merges/week, sessions/week, cost/week).
 *
 * Types, window resolution, and methodology copy live in
 * src/lib/practice-numbers-shared.ts (client-safe — the page component and
 * export builders need them, and SvelteKit forbids importing `$lib/server/*`
 * into client code); this module owns only the D1 queries.
 *
 * `deploys_per_week` is deliberately `null` — DESIGN.md is explicit that this
 * slice has no deploy signal; rendering "not instrumented" honestly beats
 * proxying merges as deploys (a merge and a deploy are not the same event,
 * and conflating them would be exactly the kind of unearned confidence
 * DESIGN.md's honest-positive framing rule forbids).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { computeAmortizationRollup, UNASSIGNED_UNIT_KEY } from './amortization-query';
import { listSubscriptionPlans } from './subscription-plans';
import { commitStatsByUnit } from './git-events';
import {
	resolveWindow,
	type PracticeNumbersData,
	type PracticeRates,
	type ProjectRow
} from '../practice-numbers-shared';

async function earliestActivityIso(db: D1Database): Promise<string | null> {
	const [sessionRow, gitRow] = await Promise.all([
		db.prepare(`SELECT MIN(started_at) AS m FROM sessions WHERE started_at IS NOT NULL`).first<{ m: string | null }>(),
		db.prepare(`SELECT MIN(authored_at) AS m FROM git_events`).first<{ m: string | null }>()
	]);
	const candidates = [sessionRow?.m, gitRow?.m].filter((v): v is string => Boolean(v));
	if (candidates.length === 0) return null;
	return candidates.sort()[0];
}

async function unitBaseRows(db: D1Database): Promise<
	Array<{ unit_id: string; kind: ProjectRow['kind']; name: string; project_path: string }>
> {
	const { results } = await db
		.prepare(`SELECT id AS unit_id, kind, name, project_path FROM units_of_work`)
		.all<{ unit_id: string; kind: ProjectRow['kind']; name: string; project_path: string }>();
	return results;
}

interface SessionWindowStats {
	unit_id: string | null;
	session_count: number;
	estimated_cost: number;
}

async function sessionStatsByUnit(db: D1Database, sinceIso: string | null): Promise<SessionWindowStats[]> {
	const { results } = await db
		.prepare(
			`SELECT
				unit_id,
				COUNT(*) AS session_count,
				COALESCE(SUM(total_cost), 0) AS estimated_cost
			 FROM sessions
			 WHERE (?1 IS NULL OR started_at >= ?1)
			 GROUP BY unit_id`
		)
		.bind(sinceIso)
		.all<SessionWindowStats>();
	return results;
}

export async function loadPracticeNumbers(
	db: D1Database,
	windowParam: string | null,
	now: Date = new Date()
): Promise<PracticeNumbersData> {
	const window = resolveWindow(windowParam, now);

	const [units, sessionStats, gitStats, plans] = await Promise.all([
		unitBaseRows(db),
		sessionStatsByUnit(db, window.sinceIso),
		commitStatsByUnit(db, window.sinceIso),
		listSubscriptionPlans(db)
	]);

	const amortizationRollup = await computeAmortizationRollup(db, plans, window.sinceIso);
	const amortizationConfigured = plans.length > 0;

	const sessionByUnit = new Map(sessionStats.map((s) => [s.unit_id ?? UNASSIGNED_UNIT_KEY, s]));
	const gitByUnit = new Map(gitStats.map((g) => [g.unit_id ?? UNASSIGNED_UNIT_KEY, g]));

	const projects: ProjectRow[] = units
		.map((unit) => {
			const sess = sessionByUnit.get(unit.unit_id);
			const git = gitByUnit.get(unit.unit_id);
			const amort = amortizationRollup.perUnit.get(unit.unit_id);
			return {
				...unit,
				session_count: sess?.session_count ?? 0,
				estimated_cost: sess?.estimated_cost ?? 0,
				amortized_cost: amort?.amortizedCostUsd ?? 0,
				amortized_covered_sessions: amort?.coveredSessions ?? 0,
				amortized_interactive_sessions: amort?.totalInteractiveSessions ?? 0,
				commit_count: git?.commit_count ?? 0,
				merge_count: git?.merge_count ?? 0
			};
		})
		.filter((row) => row.session_count > 0 || row.commit_count > 0)
		.sort((a, b) => b.estimated_cost - a.estimated_cost);

	// Practice-wide totals include unit-less activity (a repo scanned before
	// any Claude Code session gave it a unit) — sum the raw per-group stats
	// directly rather than summing the (unit-filtered) `projects` rows.
	const totalSessions = sessionStats.reduce((s, r) => s + r.session_count, 0);
	const totalEstimatedCost = sessionStats.reduce((s, r) => s + r.estimated_cost, 0);
	const totalCommits = gitStats.reduce((s, r) => s + r.commit_count, 0);
	const totalMerges = gitStats.reduce((s, r) => s + r.merge_count, 0);

	let weeks: number;
	if (window.days !== null) {
		weeks = window.days / 7;
	} else {
		const earliest = await earliestActivityIso(db);
		const spanMs = earliest ? now.getTime() - new Date(earliest).getTime() : 0;
		const spanDays = Math.max(1, spanMs / (24 * 60 * 60 * 1000));
		weeks = spanDays / 7;
	}
	weeks = Math.max(weeks, 1 / 7); // guard against a same-day window collapsing to 0

	const rates: PracticeRates = {
		weeks,
		commits_per_week: totalCommits / weeks,
		merges_per_week: totalMerges / weeks,
		sessions_per_week: totalSessions / weeks,
		estimated_cost_per_week: totalEstimatedCost / weeks,
		amortized_cost_per_week: amortizationConfigured ? amortizationRollup.totals.amortizedCostUsd / weeks : null,
		deploys_per_week: null
	};

	return {
		window,
		asOf: now.toISOString(),
		amortizationConfigured,
		projects,
		rates
	};
}
