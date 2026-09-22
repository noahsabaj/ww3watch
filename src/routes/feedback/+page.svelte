<script lang="ts">
  import { base } from '$app/paths'
  import { page } from '$app/state'
  import { supabase } from '$lib/supabase'
  import PageShell from '$lib/components/PageShell.svelte'
  let category = $state('problem'), message = $state(''), email = $state(''), website = $state('')
  let sending = $state(false), sent = $state(false), error = $state('')
  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (sending) return
    sending = true; error = ''
    try {
      const result = await supabase.functions.invoke('feedback', { body: { category, message, email, website, articleId: page.url.searchParams.get('article') } })
      if (result.error) throw result.error
      sent = true; message = ''; email = ''
    } catch {
      error = 'Your report was not saved. Please try again later. You can also report a problem through GitHub.'
    } finally { sending = false }
  }
</script>
<PageShell title="Feedback & corrections" lede="Report a problem, request a correction or suggest a source. Your report goes privately to the maintainer. No account required.">
  {#if sent}
    <p role="status" class="rounded-2xl border border-line bg-panel p-5 text-fg">Thank you. Your report has been saved for review.</p>
  {:else}
    <form onsubmit={submit} class="max-w-xl space-y-6">
      <label class="block">
        <span class="label mb-2 block">Category</span>
        <select bind:value={category} class="field">
          <option value="problem">Problem with the site</option>
          <option value="correction">Correction or disputed label</option>
          <option value="source">Source suggestion</option>
          <option value="privacy">Privacy request</option>
        </select>
      </label>
      <label class="block">
        <span class="label mb-2 block">What should we know?</span>
        <textarea required minlength="10" maxlength="4000" rows="6" bind:value={message} class="field leading-relaxed"></textarea>
      </label>
      <label class="block">
        <span class="label mb-2 block">Email for a reply (optional)</span>
        <input type="email" maxlength="254" bind:value={email} class="field" />
      </label>
      <div class="hidden" aria-hidden="true"><label>Website<input tabindex="-1" autocomplete="off" bind:value={website} /></label></div>
      <p class="text-sm text-fg-3">Do not include passwords or sensitive information. <a href="{base}/privacy" class="link">Privacy details</a></p>
      <button disabled={sending} class="btn">{sending ? 'Sending…' : 'Send private report'}</button>
      {#if error}<p role="alert" class="text-sm text-amber-300">{error} <a href="https://github.com/noahsabaj/ww3watch/issues/new/choose" class="link">GitHub issues</a></p>{/if}
    </form>
  {/if}
</PageShell>
