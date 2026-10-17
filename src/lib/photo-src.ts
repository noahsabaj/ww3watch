// Newsroom photographs resized on the way to the browser. Publishers serve
// originals up to 3 MB (a 2400 px JPEG, a PNG screenshot), and the first
// story's photo is what a phone paints last (Lighthouse mobile LCP, 2026-10-17).
// wsrv.nl (images.weserv.nl: open source, free, on Cloudflare) fetches the
// original server-side, so the publisher sees no visitor and no referrer, and
// returns WebP at the width the screen needs. StoryPhotoImg falls back to the
// original when it fails, and to the colour field when that fails too.
//
// Only absolute http(s) URLs go through it: a relative one is ours (the e2e
// fixtures) and is served as is.

const RESIZER = 'https://wsrv.nl/'

/** The widths offered, smallest first: a 64 px thumbnail at 3x up to a desk pane at 2x. */
export const PHOTO_WIDTHS = [240, 480, 800, 1200] as const

export function resizable(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** `we`: never enlarge, so a small original stays small and the surface's
 *  minimum-width check still sees its real size. */
export function resizedUrl(url: string, width: number): string {
  return `${RESIZER}?url=${encodeURIComponent(url)}&w=${width}&output=webp&q=72&we`
}

/** The resized copy for a photo drawn `drawnPx` CSS pixels wide at this pixel
 *  ratio, on a surface that rejects photos narrower than minWidth. One src, no
 *  srcset: with width descriptors the browser reports naturalWidth in CSS
 *  pixels, which would turn the surface's minimum-width check into a check of
 *  the screen. Never below minWidth, or a well-sized original would be judged
 *  by a smaller copy. Relative URLs come back as they are. */
export function photoSrc(url: string, minWidth: number, drawnPx: number, dpr = 1): string {
  if (!resizable(url)) return url
  const need = Math.max(minWidth, Math.ceil(drawnPx * dpr))
  return resizedUrl(url, PHOTO_WIDTHS.find((w) => w >= need) ?? PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1])
}
