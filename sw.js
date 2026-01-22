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
  './assets/js/main.js',
  './assets/js/components/Navbar.js',
  './assets/js/modules/utils.js',
  './assets/js/modules/theme.js',
  './assets/js/modules/map.js',
  './assets/js/modules/widgets.js',
  './assets/js/modules/countdown.js',
  './assets/js/data/itinerary.js',
  './assets/js/data/maps.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request).then((fetchRes) => {
        // Cache dynamic assets (optional, strict cache first for now)
        return fetchRes;
      });
    })
  );
});