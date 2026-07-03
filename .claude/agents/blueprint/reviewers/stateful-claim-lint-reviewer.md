# stateful-claim-lint-reviewer

**Gate**: cadence + `doctor` check 8 (every doctor run, so CI gates on it per wave 55's enforcement wiring). Never blocks a *stage* — it guards the living doc surface, not a pipeline transition.

**Pair**: `stateful-claim-lint-reviewer.mjs` (executable, ADR-0002 contract, `--self-test`).

## What it reviews

Hardcoded state in prose rots: counts, versions, and "latest X" claims drift from their sources of truth while every gate stays green. Promoted past the second-instance rule on the 2026-06-10/11 evidence — "forty-nine waves captured in CLAUDE.md" (five waves stale), HANDOFF's "Latest wave (49)", the charter's "at rest as of wave 54" and "0.1.0 on npm" — every instance operator-caught, none gate-caught.

Five mechanical checks, each against a located source of truth (absent source → check skipped with INFO, so the reviewer is safe in consumer repos):

| Check | Claim shape | Source of truth | Severity on drift |
|---|---|---|---|
| `wave-currency` | "Current state: wave N", "latest wave (N)", "N waves of changes", "all N waves" (digits or number-words) | max `- Wave N` in `WAVE-LOG.md` | **BLOCK** — these shapes unambiguously assert "now" |
| `consumer-count` | "N consumers" / "N registered" on registry-flavored lines | `- repo:` entries in `consumers.yml` | WARN |
| `reviewer-count` | "reviewer fleet: N (M executable)" | spec/executable counts in this directory | WARN |
| `doctor-checks` | "doctor … N checks" (≤50 chars proximity) | distinct `add('<name>')` calls in `doctor.mjs` | WARN |
| `version-pin` | `<package>@X.Y.Z` in prose | `package.json` version | WARN |

## Honest scope

- **Living docs only**: root README / METHODOLOGY / CONTRIBUTING / CLAUDE / HANDOFF + `docs/**` + `template/CLAUDE.md`. Excluded as point-in-time records: `WAVE-LOG.md`, `METHODOLOGY-AMENDMENTS.md`, `feedback/**`, `docs/_archive/**`, `docs/case-studies/**`, `docs/decisions/**` (ADRs), date-prefixed docs.
- **Fences stripped** — example output legitimately contains frozen counts.
- **Deprecation lines skipped** for version pins ("npm deprecate <pkg>@OLD" is a deliberate old-version mention).
- **Under-matching by design**: claim detection is tight regex; novel currency phrasings won't match. The judgment variant ("does this paragraph imply currency?") is agent-verified territory — a looser matcher would manufacture noise into a gate (the first repo run proved it: 27 findings before flavor/proximity/exclusion guards, 5 true positives after).
- Whether a pinned version is **live on npm** is agent-verified — no network in reviewers.

## The alternative this encodes against

De-rot by phrasing ("see `blueprint fleet`" instead of "12 consumers") remains the better fix where it reads well — this lint is the net under the numbers that stay, not a license to freeze more of them.

## Lineage

Filed 2026-06-10 (enforcement-gaps amendment, instance 1); third sighting 2026-06-11 crossed the second-instance threshold; built wave 59. Sibling: `doc-currency-reviewer` (same living-docs scope, reference-rot class).
