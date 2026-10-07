-- ============================================================
-- Repo aliases — old repo names mapped to their current name.
--
-- git_events is keyed on (repo, commit_sha) with repo = the checkout's
-- folder name, and session matching keys on the same name (repoKey in
-- src/lib/attribution/project-path.ts). A folder rename therefore splits one
-- repo's history in two: re-importing it under the new name duplicates every
-- commit, and sessions recorded under the old folder stop matching. The
-- 2026-08-12 workspace reorg renamed three repos this way.
--
-- The server and the --local importer map an alias to its canonical name
-- before writing a git_events row and when matching sessions or units, so a
-- client that still reports an old name (a queued commit, an old checkout)
-- lands on the canonical row. The GitHub repos were renamed too, so the git
-- remote is not a stable key either.
--
-- A canonical name must not itself be an alias (no chains); add a new row
-- per rename instead of editing an old one. This deployment is single-user,
-- so its renames are seeded here.
-- ============================================================

CREATE TABLE repo_aliases (
    alias       TEXT PRIMARY KEY,
    canonical   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (alias <> canonical)
);

INSERT INTO repo_aliases (alias, canonical) VALUES
    ('photography', 'nino-chavez-photography'),
    ('website-nc', 'nino-chavez-site'),
    ('quantifai-next', 'quantifai');

-- Re-key rows still stored under an old name whose commit has no row under
-- the new name. A commit stored under BOTH names is left alone: folding the
-- pair needs history matching (a rewritten history changes commit ids),
-- which SQL cannot do. On production this is a no-op: the 2026-10-06 rename
-- (backup and SQL in ~/.local/state/quantifai-import/rename-migration-20261006/)
-- already folded every old-name row.
UPDATE git_events
SET repo = (SELECT canonical FROM repo_aliases WHERE alias = git_events.repo)
WHERE repo IN (SELECT alias FROM repo_aliases)
  AND NOT EXISTS (
    SELECT 1 FROM git_events AS renamed
    WHERE renamed.repo = (SELECT canonical FROM repo_aliases WHERE alias = git_events.repo)
      AND renamed.commit_sha = git_events.commit_sha
  );
