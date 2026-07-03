/**
 * Blueprint telemetry adapter — read-only, one-directional.
 *
 * ADR-0004 decision 3: "quantifai-next understands Blueprint's format;
 * Blueprint never depends on quantifai." This module has zero import from
 * (or dependency on) the `blueprint` tool package — it independently
 * replicates the documented JSONL record shape emitted by
 * `tools/blueprint/template/tools/lib/telemetry.mjs`:
 *
 *   { ts, stage, effort, model_tier, duration_ms, reviewer }
 *
 * `duration_ms` is explicitly a tier-weighted TIME proxy per Blueprint's own
 * ADR-0003, not a cost figure — this adapter surfaces it as a stage boundary
 * (start/end derived from ts - duration_ms .. ts), never as a dollar amount.
 * quantifai-next is the one that prices it, by joining these boundaries
 * against session cost data.
 */

export interface BlueprintTelemetryRecord {
	ts: string;
	stage: string | null;
	effort: string | null;
	model_tier: string | null;
	duration_ms: number | null;
	reviewer: 'pass' | 'fail' | null;
}

export interface BlueprintStageBoundary {
	stage: string;
	startedAt: string;
	endedAt: string;
	effort: string | null;
	modelTier: string | null;
	reviewer: 'pass' | 'fail' | null;
}

/** Parses telemetry.jsonl text. Skips blank/garbled lines — never throws (matches the emitter's own tolerance). */
export function parseBlueprintTelemetry(jsonlText: string): BlueprintTelemetryRecord[] {
	const out: BlueprintTelemetryRecord[] = [];
	for (const line of jsonlText.split('\n')) {
		const s = line.trim();
		if (!s) continue;
		try {
			const parsed = JSON.parse(s);
			if (typeof parsed.ts !== 'string') continue; // ts is the one required field
			out.push({
				ts: parsed.ts,
				stage: parsed.stage ?? null,
				effort: parsed.effort ?? null,
				model_tier: parsed.model_tier ?? null,
				duration_ms: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : null,
				reviewer: parsed.reviewer === 'pass' || parsed.reviewer === 'fail' ? parsed.reviewer : null
			});
		} catch {
			// skip a torn line — telemetry files are append-only and can be interrupted mid-write
		}
	}
	return out;
}

/** Derives a start/end boundary per record. Zero-width (startedAt === endedAt) when duration_ms is absent. */
export function deriveStageBoundaries(records: BlueprintTelemetryRecord[]): BlueprintStageBoundary[] {
	return records
		.filter((r): r is BlueprintTelemetryRecord & { stage: string } => typeof r.stage === 'string')
		.map((r) => {
			const end = new Date(r.ts);
			const start =
				typeof r.duration_ms === 'number' ? new Date(end.getTime() - r.duration_ms) : end;
			return {
				stage: r.stage,
				startedAt: start.toISOString(),
				endedAt: end.toISOString(),
				effort: r.effort,
				modelTier: r.model_tier,
				reviewer: r.reviewer
			};
		});
}

/**
 * Reads `<repoPath>/.blueprint/telemetry.jsonl` if present. Returns `[]` on
 * any error (missing file, permission, garbled content) — telemetry absence
 * is a normal, expected state (most repos are not Blueprint initiatives),
 * never a crash. Node-only (uses `node:fs`); import from server code / import
 * scripts, not from Svelte components.
 */
export async function readBlueprintTelemetry(repoPath: string): Promise<BlueprintStageBoundary[]> {
	const { readFile } = await import('node:fs/promises');
	const { join } = await import('node:path');
	try {
		const text = await readFile(join(repoPath, '.blueprint', 'telemetry.jsonl'), 'utf8');
		return deriveStageBoundaries(parseBlueprintTelemetry(text));
	} catch {
		return [];
	}
}
