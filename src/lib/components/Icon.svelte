<script lang="ts" module>
  // Every icon in the app, one stroke style (24px grid, round caps, drawn in
  // currentColor). Shapes follow Lucide (ISC licence). Never use emoji or
  // Unicode arrows as icons: iOS renders several of them (↗ ↩ ▶) as colour
  // emoji, and e2e/signal.spec.ts fails the build if one reaches the page.
  const PATHS = {
    'arrow-left': ['m12 19-7-7 7-7', 'M19 12H5'],
    'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
    'arrow-up': ['m5 12 7-7 7 7', 'M12 19V5'],
    external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    close: ['M18 6 6 18', 'm6 6 12 12'],
    share: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'm16 6-4-4-4 4', 'M12 2v13'],
    link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    check: ['M20 6 9 17l-5-5'],
    translate: ['m5 8 6 6', 'm4 14 6-6 2-3', 'M2 5h12', 'M7 2h1', 'm22 22-5-10-5 10', 'M14 18h6'],
    flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
    filters: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M10 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
    menu: ['M4 8h16', 'M4 16h16'],
    refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  } as const

  export type IconName = keyof typeof PATHS
</script>

<script lang="ts">
  let { name, size = 16, stroke = 1.8, class: cls = '' }: { name: IconName; size?: number; stroke?: number; class?: string } = $props()
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  class="shrink-0 {cls}"
>
  {#each PATHS[name] as d, i (i)}<path {d} />{/each}
</svg>
