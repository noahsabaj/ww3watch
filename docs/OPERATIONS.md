# WW3Watch operations

## Domain cutover and recovery

The production workflow reads the repository variable `PAGES_BASE_PATH`.
Use `/ww3watch` for the original GitHub Pages address and an empty value for
`ww3watch.org`. The recovery build omits CNAME and preserves a prerendered index.

Recovery: set `PAGES_BASE_PATH=/ww3watch`, deploy the matching build, then clear
the GitHub Pages custom-domain setting. Check the original URL, assets, and a
reader query link. Never clear the domain while serving root-only asset paths.

Cutover: verify public DNS points to GitHub Pages, set the custom domain, clear
`PAGES_BASE_PATH`, and deploy. Verify GitHub certificate issuance and enable
HTTPS enforcement. Check apex, www, HTTP, the old GitHub URL, and reader query
links from public clients. If certificate issuance remains blocked, restore the
recovery build and setting. A successful DNS lookup alone is not acceptance.

GitHub provisions the certificate only while the custom domain is attached;
allow a supervised cutover window and retain the prior successful deployment.

Verified 2026-09-20: apex HTTPS, HTTP upgrade, www and the old GitHub address all
return the new site; article query parameters survive redirects. GitHub's
certificate expires 2026-12-19 and HTTPS enforcement is enabled. Search Console
domain ownership is verified; the submitted sitemap succeeded with five pages.
UptimeRobot monitor 804040223 checks the apex every five minutes and emails the
owner. Repository checks cover certificate expiry because that UptimeRobot
feature requires a paid plan.

## Spending and stale ingestion

The planning target is $25/month excluding the domain: $20 classification, $3
translation and $2 unallocated reserve. Classification went from $15 to $20 on
2026-09-23: with every stage working it measured ~$0.65-0.71 a day before that
day's zero-regression cuts (reused Trending judgments, no unread topic question,
no merge re-asks), ~$17-18 a month after them, so $15 would have stopped
judging late in each month. This is not a promise covering unknown
provider charges, database egress, taxes or other projects on shared accounts.
Keep GitHub Pages and Supabase on their current free plans.

`ai_budgets` contains verified model names and per-million-token rates;
`ai_months` contains opening usage plus settled and uncertain reservations.
Never initialize unknown usage to zero. Verify the provider dashboard first,
then update these private tables using the service role. Unverified configuration
blocks provider work. Check new pricing when changing models. At a new UTC month,
the ledger opens automatically only after an earlier verified baseline exists.

On September 20 TypeSafe billing showed $3.3322 since September 16 at $0.042 per
million input tokens, with free output. The initial September classification
ledger reserves $4, including a margin for delayed billing and unrelated account
usage. The provider had $1.66 of credit remaining and auto-recharge was off;
the application allowance does not replenish provider credit. Groq's Free plan
showed $0.89 of projected September usage for `openai/gpt-oss-120b`, with no
billable charges. Translation conservatively starts at $1 of equivalent cost,
using the verified on-demand rates of $0.15 input/$0.60 output per million tokens.
The Free plan is unchanged; accounting uses equivalent cost to retain a useful
safety ceiling. Rates: https://console.groq.com/docs/models.

Every attempt reserves spend before calling the provider. Unknown billing
outcomes keep the reservation. Never refund an uncertain attempt without provider
evidence. Quota/database failures deny new provider work. Cached translations and
original reporting remain readable. When classification is denied, ingestion
records failure and leaves pending items deferred. Never mark unreviewed stories
accepted. Investigate the ingestion workflow after 60 minutes without success.

The Operations workflow runs every 15 minutes and uploads a seven-day summary of
database health, provider accounting, ingestion, backup age and report counts.
The Supabase usage dashboard remains authoritative for backend traffic and
egress; the database snapshot cannot measure all infrastructure charges.
Review that dashboard monthly and after traffic spikes. Alerts at 80% of either
allowance are deduplicated; the issue closes when checks recover.

The September 20 dashboard snapshot for the September 3–October 3 billing cycle
showed 0.242/0.5 GB database usage, 0.309/5 GB egress, 63 Edge Function calls,
20,544 Realtime messages and 55 peak Realtime connections, with no overage
charges. The timestamped snapshot is in `ops_events.infrastructure_usage` and
the operations summary; it must not be mistaken for a live traffic meter.

## Private reports and retention

Review `visitor_reports` through the Supabase connection in Codex. Only the
maintainer/service role can read or update reports; use states `new`, `reviewed`,
and `closed`. Do not copy messages, email addresses or article references into
public GitHub issues. Notification issues contain aggregate counts only.

Abuse identifiers are daily keyed hashes and expire after 48 hours. Reports and
optional contact details expire after 90 days. Hourly cleanup can add up to one
hour. Encrypted archives can retain an expired report for seven additional days.
After restoration, run private retention before opening production access.

## Backups and restoration

The encrypted database workflow has its own concurrency group and runs daily
at 04:43 UTC. It backs up the public schema and persistent application data,
including reports, configuration and budget accounting. Archives use AES-256-GCM
with RSA-OAEP wrapped keys. Only the public key is supplied to backup jobs.
GitHub retains encrypted artifacts seven days. The job refuses an upload if
repository artifact storage plus the new archive exceeds 400 MiB; investigate
capacity rather than deleting the last good recovery copy. Account-wide storage
is a separate billing concern.

The Supabase CLI's temporary login-role setup currently fails for this project
with an ADMIN/CREATEROLE permission error. The backup job uses the documented
password fallback via the repository secret `SUPABASE_DB_PASSWORD`. Set the
existing database password there; never paste it into chat or commit it.

The owner recovery key is outside this repository in
`C:\Users\noahs\.ww3watch-recovery\private.pem`, with owner-only folder access.
Keep a separate offline owner-controlled copy. Never commit it, print it in
logs, or upload it with an archive. Loss of the key means loss of recovery.

Reader and translation caches, embeddings, rejected-item/verdict caches and
abuse buckets are excluded. Recent pipeline runs and trending history are kept
so freshness and historical highlights survive. Reader content rebuilds on demand; translations
rebuild under quotas and budgets. Normal ingestion regenerates embeddings for
recent unassigned articles; existing stories remain readable without cached
vectors. Similarity matching fills back in as new stories arrive. Restore retention schedules and Realtime
publication membership from the migration runbook before a production cutover.

To prove restoration, temporarily provide `BACKUP_RECOVERY_KEY` as an Actions
secret and dispatch `Isolated encrypted backup restore` with a successful backup
run ID. It downloads and decrypts only on an ephemeral runner, starts an empty
local Supabase instance, restores schema/data, checks foreign keys and private
access restrictions, and renders the restored feed. Only timestamps/counts are
uploaded as proof. Remove the temporary recovery secret after the drill. The
target is a 24-hour recovery point and basic service within two hours; a passing
crypto unit test alone does not establish either target.

Verified September 20, 2026: encrypted backup run `35521790915` restored in
isolated run `35522026497`. The drill loaded 22,804 articles, 223 sources and
8,485 stories, validated foreign keys and private-report access, and rendered
the restored feed in **92 seconds**. The archive was four minutes old. The
temporary GitHub recovery-key secret was removed after this successful drill.

For a real outage, select the newest successful encrypted archive, restore into
an isolated replacement first, run retention, recreate scheduled jobs and
Realtime membership using `scripts/ops/restore-services.sql`, and verify the feed before changing live
credentials. Never restore over the only production copy. A backup older than
30 hours or a failed backup job raises an issue; a successful job reports recovery.

Before loading a schema into a new Supabase database, clear that target's
`postgres` default privileges for tables, sequences and functions in `public`
for PUBLIC/anon/authenticated/service_role, as the restore workflow does. The
dump then applies the explicit production grants. Otherwise the target's broad
defaults can silently add grants absent from the source. The restore test checks
this boundary and must pass before a production cutover.

## Acceptance still requiring owner participation

The owner confirmed on September 20 that the site, reader and filters work on a
real phone, and that UptimeRobot emails arrived. Browser viewport checks also
passed at 320, 390 and 430 pixels. Preserve an independent copy of the recovery
key. No paid service upgrade is required.
