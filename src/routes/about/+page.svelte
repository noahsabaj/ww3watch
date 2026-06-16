<script lang="ts">
  import { base } from '$app/paths'
  import { REGION_COLORS } from '$lib/types'
  import { timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import RegionBadge from '$lib/components/RegionBadge.svelte'
  import type { SourceRegion } from '$lib/types'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  // Healthy = succeeded recently; failing = multiple consecutive misses
  // (pipeline runs every ~30–120 min, so >6 misses ≈ dead for half a day+).
  function healthClass(s: { last_ok_at: string | null; consecutive_failures: number; enabled: boolean }): string {
    if (!s.enabled) return 'bg-gray-700'
    if (s.consecutive_failures === 0 && s.last_ok_at) return 'bg-green-500'
    if (s.consecutive_failures > 6) return 'bg-red-500'
    return 'bg-amber-500'
  }

  const byRegion = $derived.by(() => {
    const map = new Map<string, typeof data.sources>()
    for (const s of data.sources) {
      const g = map.get(s.region)
      if (g) g.push(s)
      else map.set(s.region, [s])
    }
    return [...map.entries()]
  })
</script>

<svelte:head>
  <title>About — WW3Watch</title>
</svelte:head>

<div class="min-h-screen bg-[#0a0a0b]">
  <header class="sticky top-0 z-30 border-b border-gray-800 px-4 py-3 bg-[#0a0a0b]"
          style="padding-top: calc(0.75rem + env(safe-area-inset-top, 0px))">
    <div class="max-w-3xl mx-auto flex items-center gap-3">
      <a href="{base}/" class="text-white font-bold text-lg tracking-tight hover:text-blue-400 transition-colors">WW3Watch</a>
      <span class="text-gray-600 text-sm">/ about</span>
      <a href="{base}/" class="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors">← back to the feed</a>
    </div>
  </header>

  <main class="max-w-3xl mx-auto px-4 py-8 space-y-10 pb-24">
    <section>
      <h1 class="text-2xl font-bold text-white mb-3">What this is</h1>
      <p class="text-gray-300 leading-relaxed mb-3">
        WW3Watch is a real-time aggregator of conflict and geopolitical news from
        {data.sources.length} sources across every major region and perspective — US and European
        wires next to Iranian state media, Israeli papers next to Arab ones, Russian outlets next
        to OSINT researchers. It does not tell you what is true. It shows you who is saying what,
        side by side, as they say it.
      </p>
      <p class="text-gray-300 leading-relaxed">
        In conflict coverage, the wording <em>is</em> the data: whether an outlet writes
        "martyred", "killed", or "neutralized" tells you something no summary can preserve.
        So WW3Watch never summarizes, never paraphrases, never blends voices. Every headline
        appears exactly as its newsroom wrote it.
      </p>
    </section>

    <section>
      <h2 class="text-xl font-bold text-white mb-3">The rule the system is built on</h2>
      <p class="text-gray-300 leading-relaxed mb-3">
        <span class="text-white font-semibold">Machine intelligence routes stories; it never rewrites them.</span>
        Language models and embedding models decide <em>where</em> things go — whether an article is
        conflict-relevant, which story it belongs to, what is trending. They never touch what a
        journalist wrote. The single exception, translation — into whatever language you read in,
        set once — is opt-in, clearly labeled, and one click away from the original.
      </p>
      <ul class="text-gray-400 leading-relaxed space-y-2 list-disc pl-5">
        <li><span class="text-gray-300">Relevance</span> — a language model filters each new article for conflict/geopolitics relevance.</li>
        <li><span class="text-gray-300">Story grouping</span> — a multilingual embedding model maps every headline into a shared
          semantic space; articles within a tight similarity threshold and time window join the same
          story, which is how a Persian headline and a Norwegian one about the same strike end up grouped.
          Deterministic, no prompts involved.</li>
        <li><span class="text-gray-300">Trending</span> — a language model picks the most significant developing stories from the
          biggest clusters of the last few hours. It chooses among stories; it writes nothing.</li>
        <li><span class="text-gray-300">Wire detection</span> — articles whose text is near-identical to an earlier article in the
          same story are marked "wire", so "12 sources covered this" doesn't overstate independent
          confirmation when most are reprinting one agency's copy.</li>
      </ul>
    </section>

    <section>
      <h2 class="text-xl font-bold text-white mb-3">The current window, by region</h2>
      <p class="text-gray-500 text-sm leading-relaxed mb-3">
        Distribution of the {data.windowTotal} most recent articles (the feed's serving window).
        Volume varies with the news cycle and with which feeds are reachable — shown here so the
        skew is visible rather than implicit.
      </p>
      <div class="space-y-1.5">
        {#each data.regionCounts as [region, count]}
          <div class="flex items-center gap-2 text-xs">
            <span class="w-36 shrink-0 text-gray-400">{region}</span>
            <div class="flex-1 bg-gray-900 rounded h-3 overflow-hidden">
              <div class="h-full rounded {REGION_COLORS[region as SourceRegion]?.split(' ')[0] ?? 'bg-gray-600'}"
                   style="width: {Math.max(2, (count / data.windowTotal) * 100)}%"></div>
            </div>
            <span class="w-10 text-right text-gray-500">{count}</span>
          </div>
        {/each}
      </div>
    </section>

    <section>
      <h2 class="text-xl font-bold text-white mb-3">Every source, with its health</h2>
      <p class="text-gray-500 text-sm leading-relaxed mb-4">
        The full roster, live from the database the pipeline maintains. Green: fetched successfully
        on recent runs. Amber: failing recently (many news sites block datacenter IPs; a proxy
        rescues most). Red: failing for half a day or more. Gray: disabled.
      </p>
      {#each byRegion as [region, sources]}
        <details class="mb-2 group">
          <summary class="cursor-pointer list-none flex items-center gap-2 py-1.5 text-sm text-gray-300 hover:text-white transition-colors">
            <span class="inline-block transition-transform group-open:rotate-90">▸</span>
            <RegionBadge region={region as SourceRegion} />
            <span class="text-gray-500 text-xs">{sources.length} sources ·
              {sources.filter(s => s.consecutive_failures === 0 && s.last_ok_at).length} healthy</span>
          </summary>
          <div class="pl-6 pb-2 space-y-1">
            {#each sources as s}
              <div class="flex items-center gap-2 text-xs">
                <span class="w-2 h-2 rounded-full shrink-0 {healthClass(s)}"
                      title={s.last_ok_at ? `last ok ${timeAgo(s.last_ok_at, clock.now)}` : 'never fetched successfully'}></span>
                <span class="text-gray-300">{s.name}</span>
                <span class="text-gray-600">{s.lang}</span>
                {#if s.consecutive_failures > 0}
                  <span class="text-gray-600">· {s.consecutive_failures} consecutive misses</span>
                {/if}
              </div>
            {/each}
          </div>
        </details>
      {/each}
    </section>

    <section>
      <h2 class="text-xl font-bold text-white mb-3">Built in the open</h2>
      <p class="text-gray-300 leading-relaxed">
        The entire system — pipeline, clustering, this page — is
        <a href="https://github.com/noahsabaj/ww3watch" target="_blank" rel="noopener noreferrer"
           class="text-blue-400 hover:text-blue-300 underline">open source under AGPL-3.0</a>:
        anyone running a modified version as a service must publish their changes, so every
        derivative of this site stays as auditable as this one. Reader content is cached to survive
        link rot; no accounts, no tracking, no analytics.
      </p>
    </section>
  </main>
</div>
