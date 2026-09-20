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
  let explanation = $state('')
</script>

{#if isMajor(s)}
  <button type="button" class="{tag} border-amber-700/60 text-amber-400/90" onclick={() => explanation = explanation === 'Reports a significant event (deadly attack, major offensive, state-level escalation). Judged from the headline by a classifier, not an editor.' ? '' : 'Reports a significant event (deadly attack, major offensive, state-level escalation). Judged from the headline by a classifier, not an editor.'} aria-expanded={explanation === 'Reports a significant event (deadly attack, major offensive, state-level escalation). Judged from the headline by a classifier, not an editor.'}>major</button>
{/if}
{#if isOpinion(s)}
  <button type="button" class="{tag} border-gray-700/60 text-gray-400" onclick={() => explanation = explanation === 'Reads as opinion, analysis or an explainer rather than a news report' ? '' : 'Reads as opinion, analysis or an explainer rather than a news report'} aria-expanded={explanation === 'Reads as opinion, analysis or an explainer rather than a news report'}>analysis</button>
{:else if isClaim(s)}
  <button type="button" class="{tag} border-gray-700/60 text-gray-400" onclick={() => explanation = explanation === 'Reports what someone said (a threat, claim or denial) rather than an event that happened' ? '' : 'Reports what someone said (a threat, claim or denial) rather than an event that happened'} aria-expanded={explanation === 'Reports what someone said (a threat, claim or denial) rather than an event that happened'}>statement</button>
{/if}
{#if isUnverified(s)}
  <button type="button" class="{tag} border-yellow-800/60 text-yellow-500/80" onclick={() => explanation = explanation === 'The article itself presents its central fact as unconfirmed' ? '' : 'The article itself presents its central fact as unconfirmed'} aria-expanded={explanation === 'The article itself presents its central fact as unconfirmed'}>unconfirmed</button>
{/if}

{#if explanation}<span role="status" class="basis-full text-xs normal-case tracking-normal text-gray-300 p-2 border border-gray-700 rounded">{explanation}</span>{/if}
