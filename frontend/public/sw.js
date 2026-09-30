// __BUILD_VERSION__ is replaced at build time by the swVersion Vite plugin
// (hash of the emitted bundle), so every deploy rotates the cache.
const CACHE_NAME = 'japan-trip-__BUILD_VERSION__';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './tokyo.html',
  './nagoya.html',
  './takayama.html',
  './kyoto.html',
  './osaka.html',
  './naoshima.html',
  './hakone.html',
  './tokyo2.html',
  './manifest.json'
];

// Hashed JS/CSS chunks emitted by the build (stamped by the swVersion Vite plugin).
// Without them the precached HTML renders unstyled and script-less when opened offline
// before its assets were ever fetched.
const BUILD_ASSETS = [] /* __BUILD_ASSETS__ */;

const NETWORK_ONLY_DOMAINS = [
  'api.allorigins.win',
  'corsproxy.io',
  'api.open-meteo.com'
];

function isNetworkOnly(url) {
  return NETWORK_ONLY_DOMAINS.some(domain => url.includes(domain));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([...PRECACHE_ASSETS, ...BUILD_ASSETS]).catch(err => {
        console.warn('Cache error:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || isNetworkOnly(request.url)) return;

  // HTML / navigations: network-first so a redeploy is picked up on the next
  // load; fall back to cache (then the index page) when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Everything else (hashed, immutable assets): cache-first.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
