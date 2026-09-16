// Service worker for Merits of Math.
//
// Strategy:
//   - Same-origin app files (html/css/js/icons): NETWORK-FIRST, falling back to the cache only
//     when the network fails, so a deploy reaches a returning visitor on their next load. A
//     cache-first strategy would run the OLD code on the first load after every deploy, which
//     after a safety fix means the old renderer replaying a stored conversation. There is
//     deliberately no timeout: one would pair a fresh page with stale scripts on a slow
//     connection, and the chat needs the network for every message anyway.
//   - Cross-origin CDN libraries (all pinned to exact, immutable versions): CACHE-FIRST. The
//     worker fetches each one itself in CORS mode and caches it only if the response is a
//     verified success. Opaque responses are never cached: their status cannot be read, so a
//     failed download could otherwise be kept forever.
//   - The AI proxy (/api/) is never intercepted; those calls always hit the network.
//
// Bump CACHE only to purge everything, for example when files are deleted.

const CACHE = 'merits-v6';

// './index.html' is deliberately absent: Cloudflare Pages answers /index.html with a 308
// redirect to /, and './' already covers the page.
const APP_SHELL = [
    './',
    './chat.css',
    './manifest.webmanifest',
    './icons/icon.svg',
    './js/chat.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            // {cache:'reload'} so install always pulls fresh from the network, never the browser's
            // HTTP cache. allSettled so one bad asset can't block install.
            .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Only handle GET. POSTs (the tutor calls) always hit the network.
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        // Never intercept the AI proxy: its responses must stay live.
        if (url.pathname.startsWith('/api/')) return;
        event.respondWith(networkFirst(req));
    } else {
        event.respondWith(cacheFirstVerified(req));
    }
});

// Network when reachable (refreshing the cache on success), cache only when it is not.
function networkFirst(req) {
    return fetch(req)
        .then((res) => {
            if (res && res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || Response.error()));
}

// Cached copy if there is one. Otherwise fetch in CORS mode and cache only a readable success.
// A CORS response may answer the page's own no-cors <script> request. If the CORS fetch
// fails or is not ok, the page's request is passed through unchanged and nothing is cached.
function cacheFirstVerified(req) {
    return caches.match(req.url).then((cached) => {
        if (cached) return cached;
        return fetch(req.url, { mode: 'cors', credentials: 'omit' })
            .then((res) => {
                if (!res.ok) return fetch(req);
                const copy = res.clone();
                caches.open(CACHE).then((cache) => cache.put(req.url, copy));
                return res;
            })
            .catch(() => fetch(req));
    });
}
