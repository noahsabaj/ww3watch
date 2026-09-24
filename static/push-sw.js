// The alarm's half of the service worker (vite.config.ts imports it into the
// generated one): show the pushed alert, and open its story when tapped.
// Sent by src/lib/server/pipeline/alerts.ts as { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'WW3Watch', {
      body: data.body || '',
      tag: data.tag,
      icon: 'pwa-192x192.png',
      badge: 'pwa-64x64.png',
      data: { url: data.url || './' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('navigate' in w && 'focus' in w) return w.navigate(url).then((c) => (c ?? w).focus())
      }
      return self.clients.openWindow(url)
    }),
  )
})
