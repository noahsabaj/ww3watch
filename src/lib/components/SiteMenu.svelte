<script lang="ts">
  import { base } from '$app/paths'
  import { page } from '$app/state'
  import Sheet from '$lib/components/Sheet.svelte'

  // The site menu: one icon in every header, the same sheet everywhere.
  let open = $state(false)

  const items: { href: string; title: string; note: string; external?: boolean }[] = [
    { href: `${base}/`, title: 'Latest reporting', note: 'Every story, every side' },
    { href: `${base}/trends`, title: 'Trends', note: 'How each party’s coverage moved over 30 days' },
    { href: `${base}/about`, title: 'About & methodology', note: 'How stories are gathered, grouped and labelled' },
    { href: `${base}/feedback`, title: 'Feedback & corrections', note: 'Report a problem or suggest a source' },
    { href: `${base}/privacy`, title: 'Privacy', note: 'No accounts, no trackers' },
    { href: 'https://github.com/noahsabaj/ww3watch', title: 'Source code', note: 'Open source under AGPL-3.0', external: true },
  ]

  const current = (href: string) => page.url.pathname.replace(/\/$/, '') === href.replace(/\/$/, '')
</script>

<button type="button" class="icon-btn" aria-label="Menu" aria-haspopup="dialog" aria-expanded={open} onclick={() => (open = true)}>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8h16M4 16h16" /></svg>
</button>

<Sheet bind:open title="Menu">
  <nav aria-label="Site navigation" class="-mx-2 pt-1">
    {#each items as item (item.href)}
      <a
        href={item.href}
        target={item.external ? '_blank' : undefined}
        rel={item.external ? 'noopener noreferrer' : undefined}
        aria-current={current(item.href) ? 'page' : undefined}
        onclick={() => (open = false)}
        class="group flex items-baseline justify-between gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-white/[0.04]"
      >
        <span>
          <span class="block font-serif text-[19px] text-fg group-aria-[current=page]:text-accent">{item.title}{item.external ? ' ↗' : ''}</span>
          <span class="mt-0.5 block text-[13px] text-fg-3">{item.note}</span>
        </span>
      </a>
    {/each}
  </nav>
</Sheet>
