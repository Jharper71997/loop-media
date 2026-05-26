// Loop Media TV display service worker.
// Caches creative media (and Supabase storage objects) cache-first so the loop
// keeps playing if the venue's WiFi drops. App code itself is always fetched
// fresh when online.

const CACHE = 'lm-media-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

function isMedia(url) {
  return (
    /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v)(\?|$)/i.test(url.pathname) ||
    url.pathname.includes('/storage/v1/object/')
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (!isMedia(url)) return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      if (cached) return cached
      try {
        const res = await fetch(req)
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
        return res
      } catch (err) {
        return cached || Response.error()
      }
    })
  )
})
