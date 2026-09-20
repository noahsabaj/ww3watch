<script lang="ts">
  import { onMount } from 'svelte'
  import { base } from '$app/paths'
  import { supabase } from '$lib/supabase'
  import { ACTORS, type Actor } from '$lib/signals'
  import { buildActorSeries, type ActorDailyRow, type ActorSeries } from '$lib/trends'

  const DAYS = 30
  let series = $state<ActorSeries[]>([])
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  let showTable = $state(false)
  // Hover readout: one line under the hovered tile (a tooltip that cannot clip
  // on a phone). Keyed by actor so only that tile shows it.
  let hover = $state<{ actor: Actor; i: number } | null>(null)

  onMount(async () => {
    const { data, error } = await supabase.rpc('actor_daily', { p_days: DAYS })
    if (error) {
      console.error('[trends] actor_daily failed:', error)
      status = 'error'
      return
    }
    series = buildActorSeries((data ?? []) as ActorDailyRow[], DAYS, Date.now())
    status = 'ready'
  })

  // Validated on this surface (#111113) with the dataviz palette checker: both
  // inside the lightness band, CVD ΔE 22. Identity is never colour alone — the
  // legend names both, and the readout spells the numbers out.
  const ALL = '#4f78b5'
  const MAJOR = '#d97706'
  const W = 240
  const H = 44
  const GAP = 2
  const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
</script>



<div class="min-h-screen bg-[#0a0a0b] text-gray-300">
  <main class="max-w-5xl mx-auto px-4 py-8">
    <a href="{base}/" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">← Back to the feed</a>
    <h1 class="text-2xl font-bold text-white mt-3 mb-2">Trends</h1>
    <p class="text-sm text-gray-400 leading-relaxed max-w-2xl mb-2">
      Stories per day involving each party over the last {DAYS} days, and how many of them were judged a
      <span class="text-gray-200">major event</span> — a deadly attack, a major offensive, state-level escalation.
      Stories, not articles: twelve outlets covering one strike count once.
    </p>
    <p class="text-xs text-gray-600 leading-relaxed max-w-2xl mb-5">
      Who is involved and what is major are a classifier's reading of each headline, not an editor's. Each tile has its
      own vertical scale (its peak is printed on it), so compare shapes across tiles, not bar heights. Days are UTC.
    </p>

    <div class="flex items-center gap-4 mb-5 text-xs text-gray-400">
      <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:{ALL}"></span>All stories</span>
      <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:{MAJOR}"></span>Major events</span>
      <button onclick={() => (showTable = !showTable)} aria-pressed={showTable} class="ml-auto text-gray-500 hover:text-gray-200 border border-gray-800 hover:border-gray-600 rounded px-2 py-1 transition-colors">
        {showTable ? 'Show charts' : 'Show as table'}
      </button>
    </div>

    {#if status === 'loading'}
      <p class="text-sm text-gray-600">Loading…</p>
    {:else if status === 'error'}
      <p class="text-sm text-amber-400">Couldn't load the trend data. Try again in a minute.</p>
    {:else if series.length === 0}
      <p class="text-sm text-gray-600">No annotated stories yet.</p>
    {:else if showTable}
      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead class="text-gray-500 uppercase tracking-wider text-[10px]">
            <tr><th class="py-2 pr-4 font-medium">Party</th><th class="py-2 pr-4 font-medium text-right">Stories, 7d</th><th class="py-2 pr-4 font-medium text-right">Major, 7d</th><th class="py-2 pr-4 font-medium text-right">Major, prior 7d</th><th class="py-2 font-medium text-right">Stories, {DAYS}d</th></tr>
          </thead>
          <tbody>
            {#each series as s (s.actor)}
              <tr class="border-t border-gray-900">
                <td class="py-1.5 pr-4 text-gray-200">{ACTORS[s.actor].label}</td>
                <td class="py-1.5 pr-4 text-right tabular-nums">{s.stories7}</td>
                <td class="py-1.5 pr-4 text-right tabular-nums">{s.major7}</td>
                <td class="py-1.5 pr-4 text-right tabular-nums text-gray-500">{s.majorPrev7}</td>
                <td class="py-1.5 text-right tabular-nums text-gray-500">{s.storiesTotal}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {#each series as s (s.actor)}
          {@const bw = (W - GAP * (s.days.length - 1)) / s.days.length}
          {@const h = hover?.actor === s.actor ? s.days[hover.i] : null}
          <section class="bg-[#111113] border border-gray-900 rounded-lg p-3" aria-label="{ACTORS[s.actor].label}: {s.major7} major events in the last 7 days, {s.majorPrev7} in the 7 before">
            <div class="flex items-baseline justify-between gap-2">
              <h2 class="text-sm font-medium text-gray-200">{ACTORS[s.actor].label}</h2>
              <span class="text-[10px] text-gray-600">peak {s.peak}/day</span>
            </div>
            <div class="flex items-baseline gap-2 mt-0.5 mb-2">
              <span class="text-xl font-semibold text-white tabular-nums">{s.major7}</span>
              <span class="text-[11px] text-gray-500">major this week · {s.majorPrev7} the week before</span>
            </div>
            <svg viewBox="0 0 {W} {H}" class="w-full h-11 block" role="img" aria-hidden="true" onmouseleave={() => (hover = null)}>
              <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="#1f2937" stroke-width="1" />
              {#each s.days as d, i (d.day)}
                {@const x = i * (bw + GAP)}
                {@const hs = s.peak ? (d.stories / s.peak) * (H - 2) : 0}
                {@const hm = s.peak ? (d.major / s.peak) * (H - 2) : 0}
                {#if hs > 0}<rect {x} y={H - 1 - hs} width={bw} height={hs} rx="1.5" fill={ALL} opacity={hover && hover.actor === s.actor && hover.i !== i ? 0.45 : 0.9} />{/if}
                {#if hm > 0}<rect {x} y={H - 1 - hm} width={bw} height={hm} rx="1.5" fill={MAJOR} opacity={hover && hover.actor === s.actor && hover.i !== i ? 0.5 : 1} />{/if}
                <!-- Hit target: the whole column, far bigger than the mark. -->
                <rect {x} y="0" width={bw + GAP} height={H} fill="transparent" role="presentation"
                  onmouseenter={() => (hover = { actor: s.actor, i })} ontouchstart={() => (hover = { actor: s.actor, i })} />
              {/each}
            </svg>
            <p class="text-[11px] h-4 mt-1 text-gray-500 tabular-nums" aria-live="off">
              {#if h}<span class="text-gray-300">{dayLabel(h.day)}</span> · {h.stories} {h.stories === 1 ? 'story' : 'stories'} · {h.major} major{:else}{dayLabel(s.days[0].day)} – {dayLabel(s.days[s.days.length - 1].day)}{/if}
            </p>
          </section>
        {/each}
      </div>
    {/if}
  </main>
</div>
