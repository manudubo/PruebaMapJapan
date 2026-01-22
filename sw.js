const CACHE_NAME = 'japan-trip-v1';
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
  './styles.css',
  './manifest.json',
  './assets/js/main.js',
  './assets/js/components/Navbar.js',
  './assets/js/modules/utils.js',
  './assets/js/modules/theme.js',
  './assets/js/modules/map.js',
  './assets/js/modules/widgets.js',
  './assets/js/modules/countdown.js',
  './assets/js/modules/config.js',
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
  // Estrategia: Cache First, Network Fallback SOLO para nuestros archivos
  // Las APIs externas (Noticias/Clima) van directo a la red sin pasar por cache
  
  const url = new URL(e.request.url);
  
  // Si es una llamada a una API externa (AllOrigins, OpenMeteo, etc), NO la interceptamos
  if (url.origin !== location.origin && !ASSETS.includes(e.request.url)) {
    return; // Dejar que el navegador maneje la red normalmente
  }

  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});