-- Subscription plans — the operator's actual plan fee(s), entered by hand
-- (scripts/seed-subscription-plan.ts). This table is NEVER seeded with a
-- fabricated default: it starts empty, and stays empty until the operator
-- runs the seed script with a real number. src/lib/pricing/amortization.ts
-- treats an empty table (or no plan overlapping a given provider/month) as
-- "unconfigured" and returns $0/covered:false for that period, never a
-- guessed fee — the app layer renders that as an explicit empty state
-- (DESIGN.md rule 1 + the standardized empty-state pattern).
--
-- `active_from`/`active_to` are ISO dates (YYYY-MM-DD). `active_to` is
-- inclusive and nullable (NULL = still active). Overlapping rows for the
-- same provider are allowed (a fee change mid-month) — the amortization
-- module prorates by day-overlap across whatever rows overlap a month
-- rather than assuming exactly one plan is active at a time.

CREATE TABLE subscription_plans (
    id                TEXT PRIMARY KEY,
    provider          TEXT NOT NULL,
    plan_name         TEXT NOT NULL,
    monthly_fee_usd   REAL NOT NULL,
    active_from       TEXT NOT NULL,
    active_to         TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_subscription_plans_provider ON subscription_plans(provider);
