# roadmap-registry-sync-reviewer

**Gate**: cadence + `doctor` check 9 (every doctor run, so CI gates on it per wave 55's enforcement wiring). Never blocks a *stage* — it guards the pair of artifacts.

**Pair**: `roadmap-registry-sync-reviewer.mjs` (executable, ADR-0002 contract, `--self-test`).

## What it reviews

Registries (machine-readable status) and their declared view documents must stay synchronized. Promoted past the second-instance rule on the 2026-06-11 evidence — rally-hq prescription.yml and roadmap.md drifted silently across multiple waves while 12 arcs shipped, advisory rules alone never caught the drift, and every instance was operator-caught not gate-caught (the same evidence shape that produced stateful-claim-lint).

Four mechanical checks, each against a declared registry-view pair (default pair: `prescription.yml` ↔ the initiative's roadmap doc when both exist):

| Check | Constraint | Severity on drift |
|---|---|---|
| `registry-presence-in-view` | every `planned`/`in-progress` item in the registry must appear in the view | **BLOCK** |
| `shipped-not-in-build-tier` | no item referenced in the build-tier section of the view may have status `shipped` | **BLOCK** |
| `view-id-validity` | every item-id the view references must exist in the registry | **BLOCK** |
| `id-uniqueness` | item ids must be unique within the registry | **BLOCK** |

## Configuration

Declare stateful artifact pairs in `blueprint.yml`:

```yaml
stateful_pairs:
  - registry: prescription.yml        # path to the status registry (YAML, JSON, or custom)
    view: docs/roadmap.md             # path to the view document (Markdown)
  - registry: custom-registry.json
    view: progress-dashboard.md
```

Default (when `stateful_pairs` is absent or empty): if both `prescription.yml` and `docs/roadmap.md` exist at the initiative root, they form the default pair. If neither exists, the check is skipped (INFO, safe in consumer repos with no registries).

## Honest scope

- **Registry formats**: YAML (prescription.yml standard) and JSON. Custom registries with item-id columns are supported if the reviewer can locate the id column via a configurable pattern.
- **View extraction**: Markdown tables only (most common roadmap/status pattern). The reviewer scans tables for item-id references and extracts status claims.
- **Skips when sources absent** — if a declared pair cannot be located, the check is skipped (INFO), so the reviewer is safe in consumer repos that have no registries.
- **Under-matching by design** — detection is tight regex; novel table shapes or id formats won't match. The judgment variant ("does this table claim to represent the registry status?") is agent-verified territory.

## The alternative this encodes against

Manual reconciliation ("sweep the registry and roadmap once per sprint") remains valid but does not scale across parallel sessions. Gates are stronger than advisory rules because gates cannot be skipped and do not rely on operator discipline per commit.

## Lineage

Filed 2026-06-11 (rally-hq amendment, roadmap sync section); promoted on wave 27 as the first candidate from rally-hq's methodology-amendments backlog. Sibling: `stateful-claim-lint-reviewer` (same enforcement shape for doc prose; this one for structured artifact pairs).
