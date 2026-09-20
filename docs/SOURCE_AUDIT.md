# Source review

Editorial review and fetch health are separate. A working RSS endpoint does
not establish credibility, and a blocked endpoint does not establish dishonesty.

Review every catalogued feed, including disabled entries. Publisher profiles
group ownership and language editions; feed reviews preserve the individual
source IDs. These groupings describe organizations, not additional independent
confirmation. This pass does not change ranking or historical article access.

For each publisher, record ownership, disclosed funding, purpose, sourcing,
corrections, coverage, limitations, dated primary evidence and review date.
For each feed, examine five recent conflict reports (latest available for
infrequent publishers). Record URLs, short original observations and whether
full text or only a publisher excerpt was accessible. Do not publish copied
article bodies. Missing samples and blocked evidence remain explicit limitations.

Decisions are retain, retain with limitations, exclude, or unresolved. Exclusion
requires substantiated repeated fabrication, deceptive attribution, or
persistently unusable sourcing. Viewpoint, state funding, and isolated corrected
mistakes alone are not grounds for exclusion. Expand research before a negative
finding; disputed allegations are not facts. Unknown ownership or an undiscovered
corrections policy must not be reported as proof that either does not exist.

Keep unclear existing sources unchanged pending evidence. Editorial exclusions
stop future ingestion, preserve history and shared links, and receive a dated
explanation. Operationally disabled feeds stay disabled until repaired and
successfully probed twice at least 15 minutes apart through the production path.

The manual Source audit probes workflow fetches feeds using the ingestion parser
and configured proxy, without writing source health, ingesting articles, or
calling paid providers. Its seven-day artifact contains endpoint outcomes and
sample article links, never secrets or full article bodies.

Source health writes use record_source_health with the original source URL and
updated_at. Results from stale snapshots are ignored. Curation must update
updated_at; ingestion cannot change name, URL, region, language, or affiliation,
or re-enable a disabled source. Deploy the additive RPC migration before its
caller. Roll back the caller only before curation resumes; older callers use
unguarded upserts and cannot safely coexist with roster changes.

Acceptance requires a review record for every live catalog entry, explicit
evidence limitations, verified changed feeds, public profiles, passing CI and
three successful ingestion cycles after the final roster changes. An empty
record or generated template is not a completed editorial review.
