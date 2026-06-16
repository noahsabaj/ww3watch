<script lang="ts">
  import { AFFILIATION_LABELS, AFFILIATION_TITLES } from '$lib/utils'

  let { affiliation }: { affiliation: string | null | undefined } = $props()

  // Muted, color-hinted tag (same weight as the 'wire' badge): state = red,
  // public = sky, exile = violet. Independent/untagged sources render nothing.
  const cls: Record<string, string> = {
    state: 'border-red-800/60 text-red-400/90',
    public: 'border-sky-800/60 text-sky-400/90',
    exile: 'border-violet-800/60 text-violet-400/90',
  }
</script>

{#if affiliation && AFFILIATION_LABELS[affiliation]}
  <span
    class="text-[9px] uppercase tracking-wider border rounded px-1 shrink-0 {cls[affiliation] ?? 'border-gray-700/60 text-gray-500'}"
    title={AFFILIATION_TITLES[affiliation]}
  >{AFFILIATION_LABELS[affiliation]}</span>
{/if}
