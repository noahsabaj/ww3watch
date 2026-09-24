<script lang="ts">
  import { isClaim, isOpinion, isUnverified, type ArticleSignals } from '$lib/signals'

  // Reader cues judged by Jev at ingest (src/lib/signals.ts). Same muted weight
  // as the affiliation / wire tags: they qualify a headline, never compete with it.
  let { article }: { article: Partial<ArticleSignals> } = $props()
  const s = $derived({
    claim: article.claim ?? null,
    unverified: article.unverified ?? null,
    opinion: article.opinion ?? null,
  })
  const tag = 'tag'
  let explanation = $state('')
</script>

{#if isOpinion(s)}
  <button type="button" class={tag} onclick={() => explanation = explanation === 'Reads as opinion, analysis or an explainer rather than a news report' ? '' : 'Reads as opinion, analysis or an explainer rather than a news report'} aria-expanded={explanation === 'Reads as opinion, analysis or an explainer rather than a news report'}>analysis</button>
{:else if isClaim(s)}
  <button type="button" class={tag} onclick={() => explanation = explanation === 'Reports what someone said (a threat, claim or denial) rather than an event that happened' ? '' : 'Reports what someone said (a threat, claim or denial) rather than an event that happened'} aria-expanded={explanation === 'Reports what someone said (a threat, claim or denial) rather than an event that happened'}>statement</button>
{/if}
{#if isUnverified(s)}
  <button type="button" class="{tag} border-yellow-400/30 text-yellow-200/80" onclick={() => explanation = explanation === 'The article itself presents its central fact as unconfirmed' ? '' : 'The article itself presents its central fact as unconfirmed'} aria-expanded={explanation === 'The article itself presents its central fact as unconfirmed'}>unconfirmed</button>
{/if}

{#if explanation}<span role="status" class="basis-full rounded-xl border border-line bg-panel p-3 text-xs normal-case tracking-normal text-fg-2">{explanation}</span>{/if}
