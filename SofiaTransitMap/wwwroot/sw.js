const SHELL_CACHE = 'sofia-transit-shell-v9';
const RUNTIME_CACHE = 'sofia-transit-runtime-v1';
const SHELL_FILES = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/app.css',
    '/js/app.js',
    '/js/api.js',
    '/js/autocomplete.js',
    '/js/canvas-layer.js',
    '/js/i18n.js',
    '/js/map.js',
    '/js/theme.js',
    '/js/route-track.js',
    '/js/util.js',
    '/js/views/alerts.js',
    '/js/views/home.js',
    '/js/views/lines.js',
    '/js/views/planner.js',
    '/js/views/stats.js',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg',
];
const CACHEABLE_HOSTS = new Set([
    'unpkg.com',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
]);
const CORE_EXTERNAL_FILES = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
];

self.addEventListener('install', event => {
    event.waitUntil(Promise.all([
        caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES.map(url => new Request(url, { cache: 'no-cache' })))),
        cacheCoreExternalFiles(),
    ]));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key.startsWith('sofia-transit-') && ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
                .map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin === self.location.origin) {
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/openapi/') || url.pathname.startsWith('/tiles/')) return;
        // Always revalidate app files so a deploy is picked up on the next load, never a stale HTTP-cache copy.
        event.respondWith(networkFirst(request, SHELL_CACHE, 'no-cache'));
    } else if (CACHEABLE_HOSTS.has(url.hostname)) {
        event.respondWith(networkFirst(request, RUNTIME_CACHE));
    }
});

async function networkFirst(request, cacheName, cacheMode) {
    let response;
    try {
        // A navigate-mode Request can't be re-initialised, so refetch it by URL.
        response = !cacheMode ? await fetch(request)
            : request.mode === 'navigate' ? await fetch(request.url, { cache: cacheMode, credentials: 'same-origin' })
            : await fetch(request, { cache: cacheMode });
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw error;
    }

    if (response.ok || response.type === 'opaque') {
        try {
            const cache = await caches.open(cacheName);
            await cache.put(request, response.clone());
        } catch (error) {
            console.warn('Could not cache PWA resource', request.url, error);
        }
    }
    return response;
}

async function cacheCoreExternalFiles() {
    const cache = await caches.open(RUNTIME_CACHE);
    const results = await Promise.allSettled(CORE_EXTERNAL_FILES.map(async url => {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await cache.put(url, response);
    }));
    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            console.warn('Could not pre-cache PWA dependency', CORE_EXTERNAL_FILES[index], result.reason);
        }
    });
}
