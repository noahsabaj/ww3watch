<script lang="ts">
  import { onMount } from 'svelte'
  import { base } from '$app/paths'
  import { supabase } from '$lib/supabase'
  import { REGION_COLORS } from '$lib/types'
  import { timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import RegionBadge from '$lib/components/RegionBadge.svelte'
  import type { SourceRegion } from '$lib/types'
  import type { SourceRosterRow } from './+page'
  import SourceDirectory from '$lib/components/SourceDirectory.svelte'
  import PageShell from '$lib/components/PageShell.svelte'

  type Highlight = {
    article_id: string
    story_id: string | null
    title: string
    source_name: string
    source_region: string
    loggedAt: string
  }

  // Live data, fetched client-side so the prerendered prose never freezes it.
  let sources = $state<SourceRosterRow[]>([])
  let sourceLoadError = $state(false)
  let windowTotal = $state(0)
  let regionCounts = $state<[string, number][]>([])
  let highlights = $state<Highlight[]>([])

  onMount(async () => {
    const [sourcesResult, windowResult, logResult] = await Promise.all([
      supabase
        .from('sources')
        .select('id, name, region, lang, enabled, last_ok_at, consecutive_failures')
        .order('region')
        .order('name'),
      supabase
        .from('articles')
        .select('source_region')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(500),
      supabase
        .from('trending_log')
        .select('logged_at, picks')
        .order('logged_at', { ascending: false })
        .limit(50),
    ])

    sourceLoadError = !!sourcesResult.error
    sources = (sourcesResult.data ?? []) as SourceRosterRow[]
    const counts = new Map<string, number>()
    for (const row of windowResult.data ?? []) {
      counts.set(row.source_region, (counts.get(row.source_region) ?? 0) + 1)
    }
    windowTotal = windowResult.data?.length ?? 0
    regionCounts = [...counts.entries()].sort((a, b) => b[1] - a[1])

    // Flatten per-run picks newest-first, keeping each distinct story once
    // (trending re-picks the same stories across consecutive runs).
    type LogPick = { article_id: string; story_id: string | null; title: string; source_name: string; source_region: string }
    const seen = new Set<string>()
    const flat: Highlight[] = []
    for (const row of (logResult.data ?? []) as { logged_at: string; picks: LogPick[] }[]) {
      for (const p of row.picks ?? []) {
        const key = p.story_id ?? p.article_id
        if (!key || seen.has(key)) continue
        seen.add(key)
        flat.push({ ...p, story_id: p.story_id ?? null, loggedAt: row.logged_at })
        if (flat.length >= 20) break
      }
      if (flat.length >= 20) break
    }
    highlights = flat
  })

</script>



<PageShell title="How WW3Watch works" lede="Who is saying what, side by side, as they say it.">
  <div class="space-y-14">
    <section>
      {#if sources.length}<p class="label mb-3">{sources.filter(s => s.enabled).length} active sources · {sources.length} catalogued</p>{/if}
      <h2 class="mb-4 font-serif text-2xl text-fg">What this is</h2>
      <p class="page-prose mb-4">
        WW3Watch is a real-time aggregator of conflict and geopolitical news from
        a catalog of {sources.length || '200+'} sources across every major region and perspective — US and European
        wires next to Iranian state media, Israeli papers next to Arab ones, Russian outlets next
        to OSINT researchers. It does not tell you what is true. It shows you who is saying what,
        side by side, as they say it.
      </p>
      <p class="page-prose">
        In conflict coverage, the wording <em>is</em> the data: whether an outlet writes
        "martyred", "killed", or "neutralized" tells you something no summary can preserve.
        So WW3Watch never summarizes, never paraphrases, never blends voices. Every headline
        appears exactly as its newsroom wrote it.
      </p>
    </section>

    <section>
      <h2 class="mb-4 font-serif text-2xl text-fg">The rule the system is built on</h2>
      <p class="page-prose mb-4">
        <strong>Machine intelligence routes stories; it never rewrites them.</strong>
        Classifier and embedding models decide <em>where</em> things go — whether an article is
        conflict-relevant, which story it belongs to, what is trending, which tags it carries. Every
        one of those judgments comes from a model that <em>cannot</em> generate text at all: it scores, or it
        answers narrow typed questions with a probability. None of them touch what a
        journalist wrote. The single exception, translation — into whatever language you read in,
        set once — is the only place a text-generating model is used: opt-in, clearly labeled, and one
        click away from the original.
      </p>
      <ul class="page-prose list-disc space-y-3 pl-5 marker:text-fg-3">
        <li><strong>Relevance</strong> — two tiers, cheapest first: a small local classifier settles the
          obvious cases, and a decision model (TypeSafe's Jev) gives the rest a calibrated probability — its verdict
          is final. A random slice of the local classifier's confident verdicts is re-checked by the decision
          model, every run.</li>
        <li><strong>Story grouping</strong> — a multilingual embedding model maps every headline into a shared
          semantic space; articles within a tight similarity threshold and time window join the same
          story, which is how a Persian headline and a Norwegian one about the same strike end up grouped.
          Similarity means "same subject", not "same event" — so when a match is close but not certain, the
          decision model is asked one question: are these two headlines the same news story?</li>
        <li><strong>Trending</strong> — for each of the biggest stories of the last few hours the decision model
          judges three things: how consequential the event is, whether it is a new development, and whether it is
          only talk. Code weighs those against how many independent sources, regions and languages carry the
          story. The weights are in the source, not in a prompt.</li>
        <li><strong>Tags</strong> — "major", "statement", "analysis", "unconfirmed" and the parties
          involved are the same kind of judgment, made once per article from its headline and summary. They are a
          classifier's reading, not an editor's — they label stories and feed the Trends page; they hide nothing
          and change nothing you read.</li>
        <li><strong>Wire detection</strong> — articles whose text is near-identical to an earlier article in the
          same story are marked "wire", so "12 sources covered this" doesn't overstate independent
          confirmation when most are reprinting one agency's copy.</li>
      </ul>
    </section>

    <section>
      <h2 class="mb-4 font-serif text-2xl text-fg">The current window, by region</h2>
      <p class="text-fg-3 text-sm leading-relaxed mb-3">
        Distribution of the {windowTotal || 500} most recent articles (the feed's serving window).
        Volume varies with the news cycle and with which feeds are reachable — shown here so the
        skew is visible rather than implicit.
      </p>
      <div class="space-y-1.5">
        {#each regionCounts as [region, count]}
          <div class="flex items-center gap-2 text-xs">
            <span class="w-36 shrink-0 text-fg-2">{region}</span>
            <div class="h-2 flex-1 overflow-hidden rounded-full bg-raised">
              <div class="h-full rounded-full {REGION_COLORS[region as SourceRegion]?.split(' ')[0] ?? 'bg-gray-600'}"
                   style="width: {Math.max(2, (count / (windowTotal || 1)) * 100)}%"></div>
            </div>
            <span class="w-10 text-right text-fg-3">{count}</span>
          </div>
        {/each}
      </div>
    </section>

    <section>
      <h2 class="mb-4 font-serif text-2xl text-fg">Recently highlighted</h2>
      <p class="text-fg-3 text-sm leading-relaxed mb-3">
        The stories the curator surfaced to Trending over the past few days — distinct
        picks, most recent first. Trending itself only ever shows the current top three;
        this is the trail it leaves.
      </p>
      {#if highlights.length === 0}
        <p class="text-fg-3 text-sm">Loading recent highlights…</p>
      {:else}
        <div class="space-y-2">
          {#each highlights as h}
            <div class="flex items-center gap-2 text-xs">
              <RegionBadge region={h.source_region as SourceRegion} size="sm" />
              <a
                href="{base}/?{h.story_id ? `story=${h.story_id}` : `article=${h.article_id}`}"
                dir="auto"
                class="text-fg-2 hover:text-fg transition-colors line-clamp-1 flex-1 min-w-0"
              >{h.title}</a>
              <span class="text-fg-3 shrink-0">{h.source_name}</span>
              <span class="text-fg-3 shrink-0 whitespace-nowrap">trended {timeAgo(h.loggedAt, clock.now)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <SourceDirectory {sources} loadError={sourceLoadError} />

    <section>
      <h2 class="mb-4 font-serif text-2xl text-fg">Follow it elsewhere</h2>
      <p class="page-prose">
        Two RSS feeds, one item per story, opening in the reader here:
        <a href="https://qusjbpknlduuklnfciws.supabase.co/functions/v1/rss" class="link">everything</a>,
        and
        <a href="https://qusjbpknlduuklnfciws.supabase.co/functions/v1/rss?major=1" class="link">major events only</a>
        — the low-volume one to point a phone's notifications at. How each party's activity has moved
        over the last month is on <a href="{base}/trends" class="link">Trends</a>.
      </p>
    </section>

    <section>
      <h2 class="mb-4 font-serif text-2xl text-fg">Built in the open</h2>
      <p class="page-prose">
        The entire system — pipeline, clustering, this page — is
        <a href="https://github.com/noahsabaj/ww3watch" target="_blank" rel="noopener noreferrer"
           class="link">open source under AGPL-3.0</a>:
        anyone running a modified version as a service must publish their changes, so every
        derivative of this site stays as auditable as this one. Reader content is cached to survive
        link rot. No visitor accounts or advertising analytics. Abuse-prevention records protect the service; see our <a href="{base}/privacy" class="link">privacy details</a>.
      </p>
    </section>
  </div>
</PageShell>
