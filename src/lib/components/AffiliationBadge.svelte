<script lang="ts">
  import { AFFILIATION_LABELS, AFFILIATION_TITLES } from '$lib/utils'

  let { affiliation }: { affiliation: string | null | undefined } = $props()

  // Same tag as wire / statement; state media alone keeps a colour hint, since
  // that is the distinction a reader most needs at a glance.
  const tone: Record<string, string> = {
    state: 'border-red-500/40 text-red-300/90',
  }
</script>

{#if affiliation && AFFILIATION_LABELS[affiliation]}
  <span
    class="tag {tone[affiliation] ?? ''}"
    title={AFFILIATION_TITLES[affiliation]}
  >{AFFILIATION_LABELS[affiliation]}</span>
{/if}
