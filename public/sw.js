const CACHE_NAME = 'japan-trip-v3';

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

const EXTERNAL_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

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
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
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
  if (isNetworkOnly(event.request.url)) return;
  
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
