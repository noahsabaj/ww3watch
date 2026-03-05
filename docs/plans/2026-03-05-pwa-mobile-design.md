# PWA + Mobile Design

**Date:** 2026-03-05
**Status:** Approved

## Overview

Add PWA installability and a mobile-optimised UX to WW3Watch. Users can add the app to their home screen, load cached articles offline, and use a touch-friendly filter sheet instead of the desktop sticky filter bar.

## Approach

`@vite-pwa/sveltekit` — the SvelteKit-specific PWA plugin. It auto-discovers `.svelte-kit/output`, pre-configures Workbox glob patterns for SvelteKit's client/prerendered output, and handles SSR virtual module registration. No manual service worker file required.

## Section 1: PWA Infrastructure

- Install `@vite-pwa/sveltekit` (devDep) and `@vite-pwa/assets-generator` (devDep, icon generation only)
- Add `SvelteKitPWA` plugin to `vite.config.ts` using `generateSW` strategy
- Manifest config inline in the plugin: name, short_name, theme_color, background_color, display, icons
- `+layout.svelte`: dynamically import `virtual:pwa-register` for SSR-safe SW registration
- `app.html`: add `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` meta tags

## Section 2: Icons

Run `@vite-pwa/assets-generator` once against `static/favicon.svg` (the radar icon) to produce:

- `static/pwa-192x192.png`
- `static/pwa-512x512.png`
- `static/apple-touch-icon-180x180.png`
- `static/favicon-32x32.png`

Manifest references the PNGs. SVG stays as the primary browser favicon. `apple-touch-icon` meta tag added to `app.html`.

## Section 3: Caching Strategy

| Resource | Strategy | Rationale |
|---|---|---|
| JS/CSS/SVG bundles | `CacheFirst` | Immutable hashed filenames; serve instantly |
| HTML page shell | `StaleWhileRevalidate` | Fast load + background update |
| Supabase REST calls | `NetworkFirst`, 3s timeout, cache fallback | Cached articles shown offline; live when online |
| `/api/reader` | `NetworkFirst`, no cache | Dynamic content, less critical offline |

Offline behaviour: page shell + last-loaded article list renders from cache. Supabase realtime subscription silently fails to connect — no crash, no new articles until reconnect.

## Section 4: Mobile UX

### FilterBar
- Add `hidden md:flex` — disappears entirely on mobile screens

### FAB (Floating Action Button)
- Fixed position: `bottom-20 right-4`
- Circular button with a filter/sliders icon
- Tapping opens the FilterSheet

### FilterSheet (new component)
- Slides up from bottom using `translate-y` CSS transition
- Contains the search input and all 14 region toggles (same state as FilterBar via bindable props)
- Backdrop tap or swipe-down gesture closes it
- Drag handle at top
- `pb-[env(safe-area-inset-bottom)]` for notch/home-indicator phones

### Safe Area Padding
- Header: `pt-[env(safe-area-inset-top)]`
- Page bottom: `pb-[env(safe-area-inset-bottom)]`

### Install Prompt
- Listen for `beforeinstallprompt` event (mobile Chrome/Android)
- Show slim banner below header: "Add WW3Watch to your home screen" + Install button
- Dismissible; dismissal stored in `localStorage` so banner does not reappear
- Mobile-only (`md:hidden`)

## Files Changed

| File | Change |
|---|---|
| `vite.config.ts` | Add `SvelteKitPWA` plugin |
| `svelte.config.js` | No change needed |
| `src/app.html` | Add PWA/mobile meta tags, apple-touch-icon |
| `src/routes/+layout.svelte` | Dynamic import `virtual:pwa-register` |
| `src/routes/+page.svelte` | Add FAB, wire FilterSheet, install prompt banner |
| `src/lib/components/FilterBar.svelte` | Add `hidden md:flex` |
| `src/lib/components/FilterSheet.svelte` | New component |
| `static/pwa-192x192.png` | Generated icon |
| `static/pwa-512x512.png` | Generated icon |
| `static/apple-touch-icon-180x180.png` | Generated icon |
| `static/favicon-32x32.png` | Generated icon |
