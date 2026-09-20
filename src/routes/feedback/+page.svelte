<script lang="ts">
  import { base } from '$app/paths'
  import { page } from '$app/state'
  import { supabase } from '$lib/supabase'
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
<main class="max-w-xl mx-auto px-4 py-8 space-y-6">
  <a href="{base}/" class="text-blue-400 inline-flex min-h-11 items-center">← WW3Watch</a>
  <h1 class="text-2xl font-bold">Feedback &amp; corrections</h1>
  <p class="text-gray-300">Report a problem, request a correction or suggest a source. Your report goes privately to the maintainer. No account required.</p>
  {#if sent}<p role="status" class="text-green-300">Thank you. Your report has been saved for review.</p>
  {:else}
    <form onsubmit={submit} class="space-y-4">
      <label class="block">Category<select bind:value={category} class="block w-full mt-1 bg-gray-900 border border-gray-600 rounded p-3"><option value="problem">Problem with the site</option><option value="correction">Correction or disputed label</option><option value="source">Source suggestion</option><option value="privacy">Privacy request</option></select></label>
      <label class="block">What should we know?<textarea required minlength="10" maxlength="4000" rows="6" bind:value={message} class="block w-full mt-1 bg-gray-900 border border-gray-600 rounded p-3"></textarea></label>
      <label class="block">Email for a reply (optional)<input type="email" maxlength="254" bind:value={email} class="block w-full mt-1 bg-gray-900 border border-gray-600 rounded p-3" /></label>
      <div class="hidden" aria-hidden="true"><label>Website<input tabindex="-1" autocomplete="off" bind:value={website} /></label></div>
      <p class="text-sm text-gray-400">Do not include passwords or sensitive information. <a href="{base}/privacy" class="text-blue-400 underline">Privacy details</a></p>
      <button disabled={sending} class="min-h-11 px-4 rounded bg-blue-700 disabled:opacity-50">{sending ? 'Sending…' : 'Send private report'}</button>
      {#if error}<p role="alert" class="text-amber-300">{error} <a href="https://github.com/noahsabaj/ww3watch/issues/new/choose" class="underline">GitHub issues</a></p>{/if}
    </form>
  {/if}
</main>
