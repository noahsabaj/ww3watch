// What every surface that opens over the page (the menu sheet, the phone
// reader, the Theaters page) does for keyboard and screen-reader users, in one
// place:
//   - focus moves in on open: to the element marked data-autofocus, else the
//     surface itself (give it tabindex="-1");
//   - Escape closes it; Tab and Shift+Tab stay inside it;
//   - on close, focus returns to whatever opened it, if that is still there.
// Only the topmost open surface answers keys, so one Escape closes one layer.
//
// Use as an attachment on the surface's root, rendered only while open:
//   <div role="dialog" aria-modal="true" tabindex="-1" {@attach modal({ onclose })}>
// Opening and closing are mount and unmount, so swapping what is inside (the
// reader moving to another outlet's article) never moves focus.
import type { Attachment } from 'svelte/attachments'
import { untrack } from 'svelte'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const open: HTMLElement[] = []

export interface ModalOptions {
  onclose: () => void
  /** Keep Tab inside. False for a surface that sits in the page, like the desk's reader pane. */
  trap?: boolean
  /** Stop the page behind from scrolling while open. */
  lockScroll?: boolean
}

export function modal(opts: ModalOptions): Attachment<HTMLElement> {
  return (el) => untrack(() => {
    const { trap = true, lockScroll = false } = opts
    const returnTo = document.activeElement
    const overflow = document.body.style.overflow
    open.push(el)
    if (lockScroll) document.body.style.overflow = 'hidden'
    queueMicrotask(() => (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus())

    function onKeydown(e: KeyboardEvent) {
      if (open.at(-1) !== el || e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        opts.onclose()
        return
      }
      if (!trap || e.key !== 'Tab') return
      const controls = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((c) => c.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      const active = document.activeElement
      const outside = active === el || !el.contains(active)
      if (!first || !last) { e.preventDefault(); el.focus(); return }
      if (e.shiftKey && (active === first || outside)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (active === last || outside)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeydown)

    return () => {
      document.removeEventListener('keydown', onKeydown)
      open.splice(open.indexOf(el), 1)
      if (lockScroll) document.body.style.overflow = overflow
      // Realtime churn can unmount the button that opened it; only return to a live one.
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus()
    }
  })
}
