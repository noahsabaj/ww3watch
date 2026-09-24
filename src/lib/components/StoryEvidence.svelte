<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import { evidenceFor } from '$lib/story-notes.svelte'
  import { EVIDENCE_SOURCE, evidenceLine } from '$lib/evidence-text'

  // What sensors saw where and when a story says something happened: a new
  // fire from NASA's satellites, a tremor on seismometers, an internet outage.
  // One quiet line each, linking to the reading itself.
  let { storyId, class: cls = '', compact = false }: { storyId: string | null; class?: string; compact?: boolean } = $props()
  const rows = $derived(evidenceFor(storyId))
</script>

{#if rows.length > 0}
  <ul data-story-evidence class="space-y-1.5 {cls}">
    {#each rows as e (e.kind)}
      {@const line = evidenceLine(e)}
      <li>
        <a
          href={line.href ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          title="Source: {EVIDENCE_SOURCE[e.kind]}"
          class="flex items-start gap-1.5 {compact ? 'text-xs' : 'text-sm'} leading-snug text-fg-2 hover:text-fg"
        >
          <Icon name={line.icon} size={compact ? 14 : 16} class="mt-px shrink-0 text-amber-300/80" />
          <span class={compact ? 'line-clamp-2' : ''}>{line.text}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
