-- Public-landing waitlist (ADR-0003 re-target: the retired quantifai.app
-- landing's "request access" form becomes a plain waitlist — no invite-only
-- gate, no name/company fields, honest about what the instance actually is:
-- one operator's practice-pricing tool, not a multi-tenant SaaS signup).
--
-- `email` UNIQUE + NOT NULL: same NULL-breaks-UNIQUE-dedup rule the rest of
-- this schema follows (LESSONS-LEARNED.md) — there is no sentinel needed
-- here since email is always required by the endpoint before insert, but
-- the constraint itself still needs a plain UNIQUE, not a partial index,
-- so `ON CONFLICT (email) DO NOTHING` (src/lib/server/waitlist.ts) has a
-- target to match against.

CREATE TABLE waitlist_signups (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_waitlist_signups_created_at ON waitlist_signups(created_at);
