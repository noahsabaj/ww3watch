// The alarm switch (#1): off until the reader turns it on. On, the browser
// holds a push subscription and the pipeline (src/lib/server/pipeline/alerts.ts)
// sends to it only when a world-changing event is confirmed. The subscription
// is the only record; nothing about the reader is stored.
import { browser } from '$app/environment'
import { supabase } from './supabase'
import { VAPID_PUBLIC_KEY } from './vapid'

/**
 * - `unavailable`: this browser cannot receive pushes (the switch is not shown)
 * - `install`: an iPhone or iPad in Safari: only the Home Screen app can
 * - `blocked`: the reader said no to notifications in the browser's own prompt
 */
export type AlertsState = 'unavailable' | 'install' | 'blocked' | 'off' | 'on'

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

class Alerts {
  state = $state<AlertsState>('unavailable')
  busy = $state(false)
  failed = $state(false)

  async load(): Promise<void> {
    if (!browser) return
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      this.state = ios && !standalone ? 'install' : 'unavailable'
      return
    }
    if (Notification.permission === 'denied') {
      this.state = 'blocked'
      return
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      this.state = sub ? 'on' : 'off'
    } catch {
      this.state = 'off'
    }
  }

  async toggle(): Promise<void> {
    if (this.busy || (this.state !== 'on' && this.state !== 'off')) return
    this.busy = true
    this.failed = false
    try {
      const reg = await navigator.serviceWorker.ready
      if (this.state === 'on') {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await supabase.rpc('unsubscribe_alerts', { p_endpoint: sub.endpoint })
          await sub.unsubscribe()
        }
        this.state = 'off'
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        this.state = permission === 'denied' ? 'blocked' : 'off'
        return
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) })
      const keys = sub.toJSON().keys ?? {}
      const { error } = await supabase.rpc('subscribe_alerts', { p_endpoint: sub.endpoint, p_p256dh: keys.p256dh ?? '', p_auth: keys.auth ?? '' })
      if (error) {
        await sub.unsubscribe()
        throw new Error(error.message)
      }
      this.state = 'on'
    } catch {
      this.failed = true
    } finally {
      this.busy = false
    }
  }
}

export const alerts = new Alerts()
