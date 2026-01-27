const CACHE_NAME = 'japan-trip-v2';
const ASSETS = [
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
  './assets/index.css', // Vite compila el CSS a este nombre o similar, el SW dinámico es mejor, pero esto cubre lo básico
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Ignorar APIs externas para evitar errores CORS
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});