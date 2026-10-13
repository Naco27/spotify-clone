const CACHE_NAME = 'soundwave-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/css/player.css',
  '/css/components.css',
  '/js/app.js',
  '/js/player.js',
  '/js/data.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
