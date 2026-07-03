-- Merge-commit classification (practice-numbers slice): a commit with 2+
-- parents is a merge commit, per `git log --pretty=%P` (parent hashes,
-- space-separated). Classified once at import time (src/lib/importers/
-- git-log.ts) rather than recomputed from `message` at read time, since the
-- parent-count signal is cheap to capture during the same `git log` call
-- that already runs and is far more reliable than message-sniffing ("Merge
-- branch..." conventions vary by workflow / squash-merge settings).
ALTER TABLE git_events ADD COLUMN is_merge INTEGER NOT NULL DEFAULT 0;
