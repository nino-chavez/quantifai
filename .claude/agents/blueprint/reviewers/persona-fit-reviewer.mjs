// persona-fit-reviewer.mjs — executable gate for the MECHANICAL half of the
// persona-fit contract (research variant). The interface IS ADR-0002's review().
//
// Mechanical (here): personas exist + grounded; jobs resolvable; every decision &
// memo recommendation carries a `serves:` that resolves (or `serves: none` + reason);
// deliverable present; memo has the per-persona outcome section; portal not promoted.
// Judgment (stays in persona-fit-reviewer.md, agent-run): true vanity detection,
// whether acceptance criteria are genuinely observable, beneficiary nuance.
//
// Dependency-free, never throws. Returns { status, findings, metadata }.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findInitiativeRoot } from '../../lib/initiative-root.mjs';

async function read(p) { try { return await fs.readFile(p, 'utf8'); } catch { return null; } }
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function listMd(dir) {
  try { return (await fs.readdir(dir)).filter((f) => f.endsWith('.md') && !f.startsWith('_')); }
  catch { return []; }
}
function yamlScalar(t, k) {
  if (!t) return null;
  const m = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(t);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// Valid job index: every `slug/JOB-n`. Built from explicit tokens AND from
// `### Heading (`slug`) … JOB-n` sections (slug from a backtick token or the heading).
function buildJobIndex(text) {
  const jobs = new Set();
  if (!text) return jobs;
  for (const m of text.matchAll(/\b([a-z][a-z0-9-]*)\/(JOB-\d+)\b/g)) jobs.add(`${m[1]}/${m[2]}`);
  for (const sec of text.split(/^###\s+/m).slice(1)) {
    const head = sec.split('\n', 1)[0];
    const bt = head.match(/`([a-z][a-z0-9-]*)`/);
    const slug = bt ? bt[1] : slugify(head.replace(/\(.*$/, ''));
    if (!slug) continue;
    for (const jm of sec.matchAll(/\bJOB-(\d+)\b/g)) jobs.add(`${slug}/JOB-${jm[1]}`);
  }
  return jobs;
}
const servesRefs = (text) => new Set([...text.matchAll(/\b([a-z][a-z0-9-]*)\/(JOB-\d+)\b/g)].map((m) => `${m[1]}/${m[2]}`));

export default async function review({ targetDir, blueprintYml }) {
  const startedAt = Date.now();
  const findings = [];

  // Resolve the artifacts root (handles both blueprint.yml-at-root and blueprint.yml-in-subdir).
  const artifactsRoot = findInitiativeRoot(targetDir);

  const ymlText = await read(path.join(artifactsRoot, 'blueprint.yml'));
  const variant = (blueprintYml && blueprintYml.variant) || yamlScalar(ymlText, 'variant') || 'greenfield';

  if (variant !== 'research') {
    return {
      status: 'PASS',
      findings: [{ severity: 'INFO', location: 'blueprint.yml', message: `variant=${variant} — persona-fit-reviewer is research-only (OUT_OF_SCOPE_FOR_VARIANT).`, remediation: 'No action.', reference: 'persona-fit-reviewer.md' }],
      metadata: { reviewer: 'persona-fit-reviewer', targetSummary: `variant=${variant}; skipped`, durationMs: Date.now() - startedAt },
    };
  }

  // Personas exist + grounded
  const personasText = await read(path.join(artifactsRoot, 'research', 'personas-and-jtbd.md'));
  if (!personasText || personasText.trim().length < 50) {
    findings.push({ severity: 'BLOCK', location: 'research/personas-and-jtbd.md', message: 'PERSONAS_MISSING — the Stage-1 personas/JTBD gate is absent or empty.', remediation: 'Populate input-grounded personas + jobs before any downstream artifact.', reference: 'persona-fit-reviewer.md' });
  }
  const jobIndex = buildJobIndex(personasText || '');
  if (personasText && jobIndex.size === 0) {
    findings.push({ severity: 'BLOCK', location: 'research/personas-and-jtbd.md', message: 'NO_JOBS_FOUND — no resolvable jobs (expected `slug/JOB-n`, or `### Persona (`slug`)` + JOB-n).', remediation: 'Give each persona a slug and number its jobs JOB-1, JOB-2, …', reference: 'persona-fit-reviewer.md' });
  }
  for (const sec of (personasText || '').split(/^###\s+/m).slice(1)) {
    const head = sec.split('\n', 1)[0].trim();
    if (!/source:/i.test(sec)) {
      findings.push({ severity: 'BLOCK', location: `research/personas-and-jtbd.md (### ${head})`, message: `PERSONA_UNGROUNDED — "${head}" has no Source: (must derive from research/sources/).`, remediation: 'Add a Source: line pointing at the input asset.', reference: 'persona-fit-reviewer.md' });
    }
  }

  // Decisions + memo recommendations trace to jobs
  const decisionsDir = path.join(artifactsRoot, 'decisions');
  const artifacts = [];
  for (const f of await listMd(decisionsDir)) artifacts.push([`decisions/${f}`, await read(path.join(decisionsDir, f))]);
  const memoPath = path.join(artifactsRoot, 'docs', 'decision-memo.md');
  const memoText = await read(memoPath);
  if (memoText !== null) artifacts.push(['docs/decision-memo.md', memoText]);

  for (const [loc, text] of artifacts) {
    if (text === null) continue;
    if (/serves:\s*none/i.test(text)) {
      const reason = /serves_reason:\s*["']?(.+)/i.exec(text);
      if (!reason || reason[1].trim().split(/\s+/).length < 10) {
        findings.push({ severity: 'BLOCK', location: loc, message: 'SERVES_NONE_UNJUSTIFIED — `serves: none` needs a serves_reason of ≥10 substantive words.', remediation: 'Give a real infrastructure/provenance reason, or anchor to a persona job.', reference: 'persona-fit-reviewer.md' });
      }
      continue;
    }
    const refs = servesRefs(text);
    if (refs.size === 0) {
      findings.push({ severity: 'BLOCK', location: loc, message: 'ARTIFACT_UNANCHORED — no `serves:` persona-job reference (and not `serves: none`).', remediation: 'Add serves: <persona>/JOB-n tracing to research/personas-and-jtbd.md.', reference: 'persona-fit-reviewer.md' });
      continue;
    }
    if (jobIndex.size) {
      for (const r of refs) {
        if (!jobIndex.has(r)) {
          findings.push({ severity: 'BLOCK', location: loc, message: `BROKEN_JOB_REF — serves: ${r} does not resolve to a job in research/personas-and-jtbd.md.`, remediation: 'Fix the slug/JOB-n, or add the job to the personas file.', reference: 'persona-fit-reviewer.md' });
        }
      }
    }
  }

  // Deliverable + the "so what" outcome section
  if (memoText === null) {
    findings.push({ severity: 'BLOCK', location: 'docs/decision-memo.md', message: 'DELIVERABLE_MISSING — the research-variant deliverable (decision memo) is absent.', remediation: 'Author docs/decision-memo.md from the template.', reference: 'persona-fit-reviewer.md' });
  } else if (!/what each persona can do/i.test(memoText)) {
    findings.push({ severity: 'BLOCK', location: 'docs/decision-memo.md', message: 'OUTCOME_UNSTATED — memo lacks the "what each persona can do once this lands" section.', remediation: 'Add the per-persona outcome section.', reference: 'persona-fit-reviewer.md' });
  }

  // Vanity (mechanical slice): a portal presented alongside the memo
  if (await exists(path.join(artifactsRoot, 'apps', 'portal'))) {
    findings.push({ severity: 'WARN', location: 'apps/portal/', message: 'PORTAL_OVER_PROMOTED — for research the portal is optional provenance, not the deliverable; ensure the memo is the deliverable.', remediation: 'Keep the memo as the deliverable; mark the portal provenance-only or remove it.', reference: 'persona-fit-reviewer.md' });
  }

  const blocked = findings.some((f) => f.severity === 'BLOCK');
  return {
    status: blocked ? 'BLOCKED' : 'PASS',
    findings,
    metadata: { reviewer: 'persona-fit-reviewer', targetSummary: `variant=research; ${artifacts.length} traced artifacts, jobs=${jobIndex.size}`, durationMs: Date.now() - startedAt },
  };
}

// Self-test (fires only on direct `node persona-fit-reviewer.mjs`, not on import).
if (import.meta.url === `file://${process.argv[1]}`) {
  const os = await import('node:os');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pfr-'));
  const mk = async (rel, body) => { await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true }); await fs.writeFile(path.join(tmp, rel), body); };
  await mk('blueprint.yml', 'variant: research\n');
  await mk('research/personas-and-jtbd.md', '### Leadership (`exec`)\n- **Source:** S1\n- **JOB-1:** When …, I need …\n  - **Acceptance:** sees X\n');
  await mk('decisions/0001-x.md', '**serves:** `exec/JOB-1`\n# ADR-0001\n');
  await mk('docs/decision-memo.md', '# Memo\nserves: `exec/JOB-1`\n## What each persona can do\n| p | x |\n');
  const ok = await review({ targetDir: tmp });
  await mk('decisions/0002-bad.md', '# ADR-0002 no serves tag\n');
  const bad = await review({ targetDir: tmp });
  await fs.rm(tmp, { recursive: true, force: true });
  const pass = ok.status === 'PASS' && bad.status === 'BLOCKED';
  console.log(`persona-fit-reviewer self-test: ${pass ? 'PASS' : 'FAIL'} (clean=${ok.status}, unanchored=${bad.status})`);
  process.exit(pass ? 0 : 1);
}
