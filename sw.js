// Service worker for Merits of Math.
//
// Strategy: cache-first for everything except the AI proxy. On the first successful
// load the app shell AND the CDN libraries (MathJax, MathLive, mathjs, marked, fonts)
// are cached, so the app works offline on subsequent visits — the key win for students
// on slow / unstable connections. The /api/ AI calls always go to the network (and are
// POSTs, which are never cached).
//
// Bump CACHE when you ship changes so old assets are cleared.

const CACHE = 'merits-v2';

const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './manifest.webmanifest',
    './icons/icon.svg',
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
            // Ignore individual failures so one bad asset can't block install.
            .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
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

    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                // Cache successful same-origin responses and opaque cross-origin CDN assets.
                if (res && (res.ok || res.type === 'opaque')) {
                    const clone = res.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, clone));
                }
                return res;
            }).catch(() => cached);
        })
    );
});
