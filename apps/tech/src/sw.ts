/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string }> }

/**
 * App-shell service worker (ARCHITECTURE section 4): precaches the build, falls back to
 * index.html for navigations, caches photo thumbnails CacheFirst (30 days / 200 entries, only
 * 200 or opaque answers). API responses are never cached here - Dexie is the offline store.
 */
const manifest = self.__WB_MANIFEST
precacheAndRoute(manifest)
cleanupOutdatedCaches()

const indexUrl = manifest
  .map((e) => (typeof e === 'string' ? e : e.url))
  .find((u) => /(^|\/)index\.html$/.test(u))
if (indexUrl) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL(indexUrl), {
      denylist: [/\/api\//, /\/print\//, /\/files\//, /\/p\//],
    }),
  )
}

const cacheableThumb = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    response.status === 200 || response.status === 0 ? response : null,
  // Signed URLs rotate `exp`/`sig` every 15 min; the picture behind them does not.
  cacheKeyWillBeUsed: async ({ request }: { request: Request }) => {
    const u = new URL(request.url)
    u.searchParams.delete('exp')
    u.searchParams.delete('sig')
    return u.href
  },
}

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.includes('/files/') &&
    url.searchParams.get('v') === 'thumb',
  new CacheFirst({
    cacheName: 'avroleva-thumbs',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      cacheableThumb,
    ],
  }),
)

// Background Sync (Android Chrome): the page does the actual work, the SW only wakes it up.
interface SyncEventLike extends ExtendableEvent {
  tag: string
}
self.addEventListener('sync', (event) => {
  const e = event as SyncEventLike
  if (e.tag !== 'outbox') return
  e.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
      for (const c of clients) c.postMessage({ type: 'drain' })
    }),
  )
})

// registerType 'prompt': the page asks us to take over once the outbox is empty.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING')
    void self.skipWaiting()
})
clientsClaim()
