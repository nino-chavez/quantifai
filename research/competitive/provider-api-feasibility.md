# Provider admin-API feasibility — July 2026

Date: 2026-07-03 · Stage 1 feasibility sweep answering the kill-question: can provider admin/usage/billing APIs feed the pilot's screens today? Verified-from-docs vs inferred marked per row. Supersedes the capability claims in `quantifai-platform/docs/deployment/provider-data-brief.md` (2026-03).

## Verdict

**Screen 1 (org spend by provider + trend + budget threshold): buildable today.** Anthropic Cost API, Cursor `/teams/spend`, and OpenAI Costs API give org-level USD directly; Copilot's Billing Usage API gives org-level USD since the June 2026 AI-Credits GA move (aggregate only, no user dimension). The one hole: ChatGPT Enterprise *seat* spend has no API — dashboard CSV export or invoice parsing only.

**Per-developer dollar drill-down: honestly buildable for 2 of 4.** Anthropic (Claude Code Analytics API: per-user email + `estimated_cost.amount`, api-vs-subscription split) and Cursor (`/teams/spend`: per-member cents — Enterprise plan required). Copilot and ChatGPT Enterprise are flat-seat: APIs give activity, not attributable dollars; a per-dev figure is seat-price ÷ headcount allocation. **Design rule for the PRD: the UI must never render allocated dollars visually equivalent to metered dollars without labeling them.**

## Per-provider capability table

| Provider | Org rollup $ | Per-dev $ | Seats assigned vs active | Gate | Freshness |
|---|---|---|---|---|---|
| Anthropic | Cost API `/v1/organizations/cost_report`, daily USD by workspace [verified] | Claude Code Analytics API per-user $ [verified]; Claude-chat per-user needs Enterprise Analytics API | `/v1/organizations/users` (no last-seen); DAU/WAU/MAU via Enterprise Analytics | Admin key `sk-ant-admin01-`; CC Analytics free; Enterprise Analytics = Enterprise plan | ~5min cost / ~1hr CC analytics / 4–24h enterprise |
| GitHub Copilot | Billing Usage API org USD, **no user field** [verified from schema] | **Not via API today**; per-user endpoint ambiguous for org-sponsored seats → needs live test | `/orgs/{org}/copilot/billing/seats` with `last_activity_at` — **null unless IDE telemetry enabled** [verified] | Business/Enterprise; `manage_billing:copilot` | CSV export async ~3min; limits undocumented |
| Cursor | `/teams/spend` rollup + `/teams/daily-usage-data` trend [verified] | `/teams/spend` per-member cents — cleanest of the four [verified] | `/teams/members` no last-active field; active-only query is a workaround | **Enterprise plan only** for both APIs (Vantage docs corroborate) | ≤1 poll/hr; 30-day max range; spend = current cycle only |
| OpenAI / ChatGPT | Costs API `/v1/organization/costs` daily USD (API-side) [verified]; ChatGPT Enterprise seat analytics **dashboard-only, no API** [search-snippet-sourced; page 403'd] | **Not buildable**: no `group_by=api_key_id` on Costs; per-key tokens only via Usage API. Codex per-user rows exist via Compliance API (ChatGPT-plan auth) | `/v1/organization/users`, no last-active | Admin key; Compliance API = Enterprise/Edu plan only | Compliance logs: minutes lag, **30-day retention** (archive required) |

Docs: [Anthropic usage/cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) · [Claude Code Analytics API](https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api) · [Copilot metrics](https://docs.github.com/en/rest/copilot/copilot-metrics) · [Copilot seats](https://docs.github.com/en/rest/copilot/copilot-user-management) · [GitHub billing usage](https://docs.github.com/en/rest/billing/usage) · [Cursor Admin API](https://cursor.com/docs/account/teams/admin-api) · [Cursor Analytics API](https://cursor.com/docs/account/teams/analytics-api) · [OpenAI Admin APIs](https://developers.openai.com/api/docs/guides/admin-apis) · [Codex governance](https://developers.openai.com/codex/enterprise/governance) · [Compliance vs analytics](https://help.openai.com/en/articles/11327494-compliance-api-vs-user-analytics-in-chatgpt-enterpriseedu)

## Items needing empirical verification before design commits

1. **Copilot per-user billing for org-sponsored seats** (`/users/{username}/settings/billing/usage` under AI Credits) — docs ambiguous; flagged independently twice. Highest-value single test against a live Copilot Business/Enterprise account; decides whether the Copilot drill-down is real or allocation-only.
2. **Commerce.com's Cursor plan tier** — the Admin/Analytics APIs are Enterprise-gated; if Commerce.com runs Cursor Business, the Cursor column downgrades to dashboard-CSV.
3. OpenAI help-center claims are snippet-sourced (403 on fetch) — re-verify before citing in a stakeholder-facing doc.

## Consequences for inherited code

quantifai-lite's Anthropic poller targets `usage_report/messages` with a hand-rolled cost table — the Cost API and Claude Code Analytics API now return USD directly; the poller's pagination/cron shell survives, the cost-table hack retires. The local Go shipper (quantifai-sync) remains the only path to per-message/per-session depth beyond what any provider API exposes — enrichment, not core.
