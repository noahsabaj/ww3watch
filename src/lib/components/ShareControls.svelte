<script lang="ts">
  import { onMount } from 'svelte'
  import type { Article } from '$lib/types'
  import type { Cluster } from '$lib/cluster'
  import { shareTarget } from '$lib/share'

  let { article, cluster = null }: { article: Article; cluster?: Cluster | null } = $props()
  const target = $derived(shareTarget(article, cluster))
  let nativeShare = $state(false)
  let message = $state('')
  let manualCopy = $state(false)
  let busy = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0

  onMount(() => { nativeShare = typeof navigator.share === 'function' })

  $effect(() => {
    // Switching sources in one story must reset feedback too, even if the URL stays the same.
    void article.id
    void target.url
    generation++
    message = ''
    manualCopy = false
    busy = false
    return () => { generation++; clearTimeout(timer) }
  })

  async function copy() {
    const current = generation
    busy = true
    clearTimeout(timer)
    message = ''
    try {
      await navigator.clipboard.writeText(target.url)
      if (current !== generation) return
      manualCopy = false
      message = 'Link copied'
      timer = setTimeout(() => { message = '' }, 2500)
    } catch {
      if (current !== generation) return
      manualCopy = true
      message = 'Could not copy automatically. Select the link below and copy it.'
    } finally {
      if (current === generation) busy = false
    }
  }

  async function share() {
    const current = generation
    busy = true
    clearTimeout(timer)
    message = ''
    manualCopy = false
    try {
      await navigator.share({ title: target.title, url: target.url })
    } catch (error) {
      if (current !== generation) return
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        message = 'Sharing is unavailable. Copy the link instead.'
        manualCopy = true
      }
    } finally {
      if (current === generation) busy = false
    }
  }
</script>

<div class="flex flex-wrap items-center gap-x-3 min-w-0 max-w-full text-xs" data-share-controls>
  <button type="button" onclick={copy} disabled={busy}
    class="min-h-11 min-w-11 text-fg-2 hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded">
    Copy {target.kind} link
  </button>
  {#if nativeShare}
    <button type="button" onclick={share} disabled={busy}
      class="min-h-11 min-w-11 text-fg-2 hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded">Share</button>
  {/if}
  <span role="status" aria-live="polite" aria-atomic="true" class="text-fg-2">{message}</span>
  {#if manualCopy}
    <label class="w-full min-w-0 text-fg-2 pb-2">
      Link to {target.kind}
      <input type="text" readonly value={target.url} onclick={(event) => event.currentTarget.select()}
        onfocus={(event) => event.currentTarget.select()}
        class="field mt-1 min-w-0 text-sm" />
    </label>
  {/if}
</div>
