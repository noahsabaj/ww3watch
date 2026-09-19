<script lang="ts">
  import { ACTORS, TOPICS, type Actor, type SignalFilter, type Topic } from '$lib/signals'

  // Shared by the desktop dropdown (Header) and the mobile sheet (FilterSheet).
  let {
    filter = $bindable(),
    availableTopics,
    availableActors,
    size = 'sm',
  }: {
    filter: SignalFilter
    availableTopics: { key: Topic; count: number }[]
    availableActors: { key: Actor; count: number }[]
    size?: 'sm' | 'md'
  } = $props()

  const pad = $derived(size === 'md' ? 'py-1' : 'py-0.5')
  const chip = $derived(`text-xs px-2 ${pad} rounded font-medium transition-colors cursor-pointer border`)
  const on = 'bg-blue-600/20 text-blue-300 border-blue-500/50'
  const off = 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'

  function toggle(k: 'majorOnly' | 'hideOpinion' | 'hideClaims') {
    filter = { ...filter, [k]: !filter[k] }
  }
  function toggleTopic(key: Topic) {
    const next = new Set(filter.topics)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    filter = { ...filter, topics: next }
  }
  function toggleActor(key: Actor) {
    const next = new Set(filter.actors)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    filter = { ...filter, actors: next }
  }
</script>

<div class="mt-3 mb-2 text-[10px] text-gray-600 uppercase tracking-widest">Show</div>
<div class="flex flex-wrap gap-1.5">
  <button onclick={() => toggle('majorOnly')} aria-pressed={filter.majorOnly} class="{chip} {filter.majorOnly ? on : off}" title="Only significant events: deadly attacks, major offensives, state-level escalation">Major only</button>
  <button onclick={() => toggle('hideClaims')} aria-pressed={filter.hideClaims} class="{chip} {filter.hideClaims ? on : off}" title="Hide threats, claims and denials; keep things that happened">Hide statements</button>
  <button onclick={() => toggle('hideOpinion')} aria-pressed={filter.hideOpinion} class="{chip} {filter.hideOpinion ? on : off}" title="Hide opinion, analysis and explainers">Hide analysis</button>
</div>

{#if availableTopics.length > 0}
  <div class="mt-3 mb-2 text-[10px] text-gray-600 uppercase tracking-widest">Topic</div>
  <div class="flex flex-wrap gap-1.5">
    {#each availableTopics as { key, count } (key)}
      <button onclick={() => toggleTopic(key)} aria-pressed={filter.topics.has(key)} title="{count} {count === 1 ? 'article' : 'articles'}" class="{chip} {filter.topics.has(key) ? on : off}">{TOPICS[key].label}</button>
    {/each}
  </div>
{/if}

{#if availableActors.length > 0}
  <div class="mt-3 mb-2 text-[10px] text-gray-600 uppercase tracking-widest">Involving</div>
  <div class="flex flex-wrap gap-1.5">
    {#each availableActors as { key, count } (key)}
      <button onclick={() => toggleActor(key)} aria-pressed={filter.actors.has(key)} title="{count} {count === 1 ? 'article' : 'articles'}" class="{chip} {filter.actors.has(key) ? on : off}">{ACTORS[key].label}</button>
    {/each}
  </div>
{/if}
