<script lang="ts">
  import { isClaim, isMajor, isOpinion, isUnverified, type ArticleSignals } from '$lib/signals'

  // Reader cues judged by Jev at ingest (src/lib/signals.ts). Same muted weight
  // as the affiliation / wire tags: they qualify a headline, never compete with it.
  let { article }: { article: Partial<ArticleSignals> } = $props()
  const s = $derived({
    severity: article.severity ?? null,
    claim: article.claim ?? null,
    unverified: article.unverified ?? null,
    opinion: article.opinion ?? null,
  })
  const tag = 'text-[9px] uppercase tracking-wider border rounded px-1 shrink-0'
</script>

{#if isMajor(s)}
  <span class="{tag} border-amber-700/60 text-amber-400/90" title="Reports a significant event (deadly attack, major offensive, state-level escalation). Judged from the headline by a classifier, not an editor.">major</span>
{/if}
{#if isOpinion(s)}
  <span class="{tag} border-gray-700/60 text-gray-400" title="Reads as opinion, analysis or an explainer rather than a news report">analysis</span>
{:else if isClaim(s)}
  <span class="{tag} border-gray-700/60 text-gray-400" title="Reports what someone said (a threat, claim or denial) rather than an event that happened">statement</span>
{/if}
{#if isUnverified(s)}
  <span class="{tag} border-yellow-800/60 text-yellow-500/80" title="The article itself presents its central fact as unconfirmed">unconfirmed</span>
{/if}
