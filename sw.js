// Service worker for Merits of Math.
//
// Strategy:
//   - Same-origin app files (html/css/js/icons): STALE-WHILE-REVALIDATE. Serve the cached
//     copy instantly (fast + offline), and fetch a fresh copy in the background so the NEXT
//     load is up to date. This means code changes propagate on their own — no need to bump
//     the cache version on every deploy.
//   - Cross-origin CDN libraries (MathJax, MathLive, mathjs, marked, fonts): CACHE-FIRST,
//     since they're versioned/immutable — once cached they never need refetching.
//   - The AI proxy (/api/) is never intercepted; those calls always hit the network.
//
// Only bump CACHE for a hard reset (e.g. to purge everything). Routine updates no longer
// require it.

const CACHE = 'merits-v4';

const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './manifest.webmanifest',
    './icons/icon.svg',
    './js/i18n.js',
    './js/db.js',
    './js/rag.js',
    './js/progression.js',
    './js/dashboard.js',
    './js/battleSystem.js',
    './js/aiTutor.js',
    './js/uiHelpers.js',
    './js/app.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            // Precache with {cache:'reload'} so install always pulls fresh from the network,
            // never the browser's HTTP cache — otherwise a deploy can be precached stale.
            // allSettled so one bad asset can't block install.
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

    // Only handle GET. POSTs (the AI tutor calls) always hit the network.
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Never intercept the AI proxy — responses must stay live.
    if (url.pathname.startsWith('/api/')) return;

    const sameOrigin = url.origin === self.location.origin;

    if (sameOrigin) {
        // Stale-while-revalidate: return cache now, refresh cache in the background.
        event.respondWith(
            caches.open(CACHE).then((cache) =>
                cache.match(req).then((cached) => {
                    const network = fetch(req).then((res) => {
                        if (res && res.ok) cache.put(req, res.clone());
                        return res;
                    }).catch(() => cached);
                    return cached || network;
                })
            )
        );
    } else {
        // Cross-origin CDN assets: cache-first (immutable), cache on first fetch.
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((res) => {
                    if (res && (res.ok || res.type === 'opaque')) {
                        const clone = res.clone();
                        caches.open(CACHE).then((cache) => cache.put(req, clone));
                    }
                    return res;
                }).catch(() => cached);
            })
        );
    }
});
