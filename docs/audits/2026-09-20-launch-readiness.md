# WW3Watch launch-readiness audit

Audited September 20, 2026. Final domain check: 13:37 UTC.

WW3Watch has a useful working core. The next step is a focused reliability and usability pass, with clear explanations for readers and predictable costs for its operator.

## Scope and limits

- Inspected desktop and 390 × 844 / 320-pixel browser layouts, opened a live article, exercised Spanish translation and the original-language toggle, and checked the filter sheet and About page.
- The interface was served from the current production build locally, using the live backend. Public-domain access was unavailable during testing. This is not proof that the complete public website works.
- Reviewed ingestion, deployment, smoke checks, backups, retention, public endpoints, and selected database policies. Used aggregate production queries; did not retrieve visitors' IP addresses.
- No destructive tests, abuse traffic, load tests, real-device accessibility certification, or billing-account review. Security findings below distinguish code risks from observed incidents. No product changes were made during this audit.

## Five most important improvements

### 1. Finish the domain transition and verify every entry point — immediate

**Evidence:** The original GitHub Pages URL returns a permanent redirect to `http://ww3watch.org/`. Early in the audit the new domain returned NXDOMAIN. By 13:37 UTC Cloudflare's resolver returned GitHub's four A records, but the browser and system resolver still could not resolve the domain. GitHub Pages reported no certificate and HTTPS enforcement disabled.

**Impact:** Someone clicking the X post can encounter a failed page during propagation. DNS answering from one resolver does not establish a working HTTPS site.

**Action:** Complete certificate issuance and HTTPS enforcement, then verify the old address, the root domain, `www`, assets, reader links, and RSS links from public clients. If this remains prolonged, restore the old working address while preparing a staged cutover. That rollback requires restoring the original deployment base path as well as removing the custom-domain setting.

**Ownership:** I enabled the custom-domain redirect before public DNS and HTTPS were ready. That was premature and caused this transition gap.

**Done when:** Both the shared old URL and the new URL reach a fully loaded HTTPS page without warnings; HTTP redirects to HTTPS; article deep links work; an external check confirms the same result.

### 2. Fix phone layout and interaction sizes — before more promotion

**Evidence:** At viewport widths of 390 and 320 pixels the page's measured content width was 403 pixels. The GitHub header control extended beyond the 390-pixel screen. Trends/About controls were only 16 pixels high; the GitHub control was 18 pixels. In the reader, badges and time crowded the source metadata. The mobile filter sheet opened and dismissed with Escape, but lacked an obvious Close/Done control. Its implementation lacks a focus trap.

**Action:** Let the header wrap or use a compact menu; simplify reader metadata on small screens; give primary controls generous touch areas; add an explicit sheet close control, focus containment, and a proper search-field label. Keep badge meanings accessible by tap and keyboard instead of relying on hover titles.

**Done when:** No horizontal overflow at 320, 390, and 430 pixels; navigation and source attribution remain visible; the reader and filters work with touch and keyboard. Verify on at least one actual phone.

### 3. Bound translation abuse and spending — before traffic grows

**Evidence:** The public translation endpoint has per-IP limits, caching, text limits, and an article-URL allowlist. However, it accepts caller-supplied text and only verifies that the URL belongs to a known article. Changing the text changes the cache key. The rate limiter permits requests when its database check fails. The request-size check trusts Content-Length, which can be absent. No global daily translation budget was found.

**Impact:** A known article URL could be paired with unrelated input to generate uncached provider work. Per-IP controls alone do not establish a total spending ceiling. This is a code-reviewed risk, not a demonstrated attack or billing incident.

**Action:** Translate server-owned article content, or validate a server-issued reference to that content. Reject uncached paid work if its quota check fails while allowing safe cached responses. Enforce actual bytes read, concurrency, and a global request/token budget. Expose usage and provider failures to the operator; document what happens at the cap.

**Done when:** Unrelated input cannot trigger translation using a known URL; missing Content-Length cannot bypass the body ceiling; quota-service failure cannot start new paid work; the configured global ceiling demonstrably stops requests.

### 4. Make trust, privacy, and feedback visible — this week

**Evidence:** The About page explains the methodology well, but the first feed view does little to orient a new reader. Labels reflect automated classification, not independent fact-checking. The displayed catalog contained 223 sources while the database had 169 enabled sources (168 healthy). There was no obvious in-app correction/report/contact route; GitHub was the main outlet.

The About page says “no accounts, no tracking, no analytics.” Operational rate limiting nevertheless stores raw IP-address buckets. An aggregate query found 126 bucket rows, the oldest from June 15. The retention function does not clean that table. Security logging is distinct from advertising analytics, but the current explanation and retention are incomplete.

**Action:** Add a brief first-visit explanation and accessible badge definitions, distinguish catalogued from active sources, and add a straightforward report/correction channel that does not require a GitHub account. Publish a concise privacy explanation covering abuse logs, local preferences, third-party article images, and translation providers. Set and enforce short abuse-log retention; consider rotating keyed identifiers if raw IP retention is unnecessary.

**Done when:** A first-time reader can tell what the site does, what it cannot verify, what the labels mean, and how to report a problem. Privacy language matches the actual data flow and automated retention.

### 5. Prove recovery and get useful failure alerts — this week

**Evidence:** The weekly backup exports only six curated fields from the sources table. The latest backup workflow (September 14) was cancelled; September 7 succeeded. Migrations and a roster export exist, but no successful full restore drill was found. The production smoke workflow runs once daily and allows feed freshness up to nine hours. Ingestion was succeeding roughly every 15 minutes during the audit.

**Action:** Define what must survive an outage, back up that data outside the live database, and restore it into a disposable environment. Ensure backup jobs cannot be crowded out by ingestion jobs. Add external availability/TLS checks and stale-ingestion alerts with an owner and a brief recovery runbook. Check both reader rendering and feed freshness after deployment.

**Done when:** A restore has actually succeeded; backup age/failure is visible; an intentionally failed check reaches the operator; alerts distinguish a broken website from a stale feed. Suggested starting checks: availability every five minutes, ingestion warning after several missed runs.

## What already works

- Live feed and trends populated; the inspected view showed about 305 stories and three highlighted trends. A recent successful pipeline timestamp was 13:25 UTC.
- The reader loaded a real article; Spanish translation and switching back to the original worked. This verifies the flow, not linguistic accuracy.
- Original sources and wording remain accessible. Source affiliations, claim labels, and the About methodology provide a strong foundation for transparency.
- Mobile content is generally readable, and the filter sheet opens/dismisses and restores focus. The specific layout problems above are localized.
- Recent deployment and CI checks passed. Ingestion, source-health handling, caching, and retention are implemented.
- All 12 public-schema tables inspected had row-level security enabled. Reader fetching includes public-IP checks across redirects; rendered HTML is sanitized with DOMPurify; the app has a content-security policy. These are meaningful safeguards, not a blanket security certification.
- Private operational tables have no public RLS policies, intentionally denying public access. Supabase advisor notices about public GraphQL tables and the executable security-definer status function need intent review rather than automatic removal: the public tables serve the feed, and the inspected status function only returns a success timestamp.

Advisor references: [public GraphQL exposure](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed), [anonymous security-definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Operating costs

These are planning figures, not reconciled invoices.

| Item | Current evidence | Practical next step |
| --- | --- | --- |
| Domain | Purchase flow showed $7.98 first year and an estimated $11.84 renewal | Confirm renewal settings and keep account recovery current |
| GitHub Pages | Existing static hosting; documented soft bandwidth limit is 100 GB/month | Watch bandwidth and availability before changing hosts |
| Supabase | Repository documents Free; live database footprint was approximately 225 MB, including indexes | Check actual plan and dashboard usage, particularly egress, database size, realtime, and function calls |
| Jev classification | README estimate approximately $0.50/day, or $15 per 30 days; not verified against bills | Record daily usage and compare actual provider charges |
| Translation | Provider is configurable; actual plan and charges were not inspected | Establish a hard global budget and inspect provider usage |

Supabase's published Free allowances include 500 MB database size, 5 GB uncached plus 5 GB cached egress, and 500,000 Edge Function invocations. Free does not include automatic backups. Pro starts at $25/month and includes seven days of daily backups. The measured PostgreSQL footprint is indicative, not an exact billing-quota measurement. [Supabase pricing](https://supabase.com/pricing), [backup documentation](https://supabase.com/docs/guides/platform/backups).

Jev's published rate is $0.042 per million input tokens with free output tokens; the repository's daily estimate still needs actual usage verification. [TypeSafe model pricing](https://docs.typesafe.ai/models).

The starting budget implied by the repository is roughly $15/month for classification plus domain renewal and any translation charges, assuming the hosting/backend stay within their documented free plans. Moving Supabase to Pro would add at least $25/month. Do not treat either figure as a guaranteed total. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

The browser initially requests up to 500 feed rows and opens realtime subscriptions. Audience growth can increase backend traffic even with static hosting. No traffic-capacity ceiling was established in this audit.

## What can wait

- A major redesign, framework migration, or hosting rewrite.
- Native apps, accounts, comments, personalized feeds, and push notifications.
- Paid marketing, advertising infrastructure, and subscriptions before understanding repeat use and operating costs.
- Paid visitor analytics. Operational health and cost measurements are the immediate need; visitor analytics would require an explicit product/privacy decision.
- Additional AI features and more sources before source-health curation and existing explanations are solid.
- Smaller polish fixes: one feed headline displayed a literal HTML entity; translation warned that an unchanged short attribution paragraph was “too far” into the article, although the text was merely unchanged. Fix those alongside nearby UI work.

## Evidence pointers

- `src/routes/about/+page.svelte`: explanation, source count, privacy language.
- `src/lib/components/SignalBadges.svelte`: badge descriptions and hover titles.
- `src/lib/sanitize-html.ts`: rendering sanitization.
- `supabase/functions/translate/index.ts`: caller input, URL gate, cache key, quotas.
- `supabase/functions/_shared/ratelimit.ts`: failure behavior and request-size check.
- `supabase/functions/_shared/net.ts`: outbound reader-fetch safeguards.
- `.github/workflows/prod-smoke.yml`: daily public smoke check.
- `.github/workflows/backup.yml` and `scripts/backup-sources.ts`: roster-only backup and concurrency.
- Live read-only checks: table RLS flags; `check_rate_limit`, `run_retention`, and `pipeline_status` definitions; aggregate rate-limit age, source health, database footprint, pipeline freshness; GitHub workflow outcomes and Pages certificate state.
