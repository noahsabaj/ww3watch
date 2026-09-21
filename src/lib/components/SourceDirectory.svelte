<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { sourceAudit } from '$lib/data/source-audit'
  import { sourceCatalog } from '$lib/data/source-catalog'
  import { sourceHealth } from '$lib/source-health'
  import { clock } from '$lib/now.svelte'
  import { timeAgo } from '$lib/utils'
  import type { SourceRosterRow } from '../../routes/about/+page'

  let { sources, loadError = false }: { sources: SourceRosterRow[]; loadError?: boolean } = $props()
  let search = $state('')
  let selected = $state('')
  const publishers = new Map(sourceAudit.publishers.map(p => [p.id,p]))
  const reviews = new Map(sourceAudit.sources.map(s => [s.sourceId,s]))
  const live = $derived(new Map(sources.map(s => [s.id,s])))
  const entries = $derived.by(() => {
    const all = new Map(sourceCatalog.map(s => [s.id,s]))
    // The catalog preserves IDs for offline profiles; live curation owns the
    // current display name, language and region when the roster is available.
    for (const s of sources) all.set(s.id,{ ...all.get(s.id), ...s, url: all.get(s.id)?.url ?? '' })
    return [...all.values()].sort((a,b) => a.name.localeCompare(b.name))
  })
  const filtered = $derived(entries.filter(s => {
    const review = reviews.get(s.id), publisher = review && publishers.get(review.publisherId)
    return [s.name,s.region,s.lang,publisher?.name,publisher?.ownership].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  }))

  onMount(() => {
    let active = true
    async function openHash() {
      const id = window.location.hash.replace(/^#source-/,'')
      if (!entries.some(s => s.id === id)) return
      selected = id; search = ''
      await tick()
      if (!active) return
      const details = document.getElementById(`source-${id}`) as HTMLDetailsElement | null
      if (details) {
        details.open = true
        details.scrollIntoView({ block: 'start' })
        details.querySelector('summary')?.focus({ preventScroll: true })
      }
    }
    void openHash()
    window.addEventListener('hashchange',openHash)
    return () => { active = false; window.removeEventListener('hashchange',openHash) }
  })
</script>

<section id="sources" class="scroll-mt-24">
  <h2 class="text-xl font-bold text-white mb-3">Source directory</h2>
  <p class="text-sm text-gray-400 mb-3">{entries.length} catalogued feeds. {sourceAudit.sources.length} have review records; the remaining reviews are pending. Each record states its evidence limits. A feed is not necessarily a separate news organization. Editorial assessments and fetch status are separate.</p>
  <p class="text-sm text-gray-400 mb-4">Political viewpoint and state funding alone do not justify exclusion. Exclusion requires substantiated repeated fabrication, deceptive attribution or persistently unusable sourcing. Historical articles remain available.</p>
  <label for="source-search" class="block text-sm text-gray-300 mb-1">Search sources, regions or reviewed ownership</label>
  <input id="source-search" type="search" bind:value={search} class="w-full min-h-11 rounded border border-gray-700 bg-gray-900 px-3 text-gray-100 mb-2 focus-visible:outline-2 focus-visible:outline-blue-400" />
  <p role="status" class="text-xs text-gray-400 mb-4">{filtered.length} matching feeds</p>
  {#if loadError}<p role="status" class="text-sm text-amber-300 mb-3">Live fetch status is unavailable. Profiles remain readable.</p>{/if}
  {#if sources.length}
    <p class="text-xs text-gray-400 mb-4">{sources.filter(s => s.enabled).length} enabled · {sources.filter(s => sourceHealth(s,clock.now) === 'recently fetched').length} successfully fetched within 60 minutes</p>
  {/if}
  <div class="space-y-2">
    {#each filtered as s (s.id)}
      {@const review = reviews.get(s.id)}
      {@const publisher = review && publishers.get(review.publisherId)}
      {@const status = live.get(s.id)}
      <details id="source-{s.id}" open={selected === s.id} class="scroll-mt-24 rounded border border-gray-800">
        <summary class="min-h-11 cursor-pointer p-3 text-sm text-gray-200 focus-visible:outline-2 focus-visible:outline-blue-400 break-words">
          <span class="font-medium">{s.name}</span>
          <span class="text-gray-400"> · {s.region} · {s.lang}</span>
        </summary>
        <div class="px-3 pb-4 text-sm text-gray-300 space-y-3 break-words">
          <p><strong>Fetch status:</strong> {status ? sourceHealth(status,clock.now) : 'unknown'}.
            {#if status?.last_ok_at} Last success {timeAgo(status.last_ok_at,clock.now)}.{/if}
            {#if status && status.consecutive_failures > 0} {status.consecutive_failures} consecutive misses.{/if}
          </p>
          {#if status && !status.enabled}<p>{review?.disabledReason ?? 'This feed is disabled. A documented curation reason is not yet available; this status alone is not an editorial judgment.'}</p>{/if}
          {#if review && publisher}
            <p><strong>Editorial decision:</strong> {review.decision}. Reviewed {review.reviewedAt}.</p>
            {#if review.rationale !== publisher.sourcing}<p>{review.rationale}</p>{/if}
            <dl class="space-y-2">
              <div><dt class="font-medium text-gray-100">Publisher / ownership</dt><dd>{publisher.name}. {publisher.ownership}</dd></div>
              <div><dt class="font-medium text-gray-100">Funding</dt><dd>{publisher.funding}</dd></div>
              <div><dt class="font-medium text-gray-100">Editorial purpose and coverage</dt><dd>{publisher.purpose} Coverage: {publisher.coverage}.</dd></div>
              <div><dt class="font-medium text-gray-100">Sourcing</dt><dd>{publisher.sourcing}</dd></div>
              <div><dt class="font-medium text-gray-100">Corrections</dt><dd>{publisher.corrections}</dd></div>
            </dl>
            {#each publisher.limitations as limitation}<p class="text-gray-400">{limitation}</p>{/each}
            <h3 class="font-medium text-gray-100">Publisher evidence</h3>
            <ul class="list-disc pl-5">
              {#each publisher.evidence as e}<li><a class="inline-flex items-center min-h-11 text-blue-400 underline break-all" href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a> <span class="text-gray-400">accessed {e.accessedAt}</span></li>{/each}
            </ul>
            <details>
              <summary class="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-blue-400">Article sample ({review.samples.length})</summary>
              {#if review.sampleLimitations}<p class="text-gray-400 mb-3">{review.sampleLimitations}</p>{/if}
              <ol class="list-decimal pl-5 space-y-3">
                {#each review.samples as a}<li><a class="inline-flex items-center min-h-11 text-blue-400 underline" href={a.url} target="_blank" rel="noopener noreferrer" dir="auto">{a.title}</a><p>{a.observation}</p><p class="text-xs text-gray-400">{a.access} · reviewed {a.reviewedAt}{a.publishedAt ? ` · published ${a.publishedAt.slice(0,10)}` : ''}</p></li>{/each}
              </ol>
            </details>
          {:else}
            <p><strong>Editorial review: pending.</strong> Ownership, funding, sourcing and corrections have not yet been documented in this audit. This is neither approval nor a negative finding.</p>
          {/if}
        </div>
      </details>
    {/each}
  </div>
</section>
