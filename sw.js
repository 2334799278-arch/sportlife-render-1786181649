const CACHE_NAME = 'sportlife-v8';
const ASSETS_TO_CACHE = [
  '/home.html',
  '/training-plan.html',
  '/course-detail.html',
  '/community.html',
  '/social.html',
  '/chat.html',
  '/user-profile.html',
  '/leaderboard.html',
  '/challenges.html',
  '/stats.html',
  '/profile.html',
  '/settings.html',
  '/achievements.html',
  '/workout-tracker.html',
  '/login.html',
  '/register.html',
  '/theme-init.js',
  '/ngrok-fix.js',
  '/tab-prefetch.js',
  '/colors_and_type.css',
  '/manifest.json',
  '/assets/vendor/tailwind.js',
  '/assets/vendor/leaflet.js',
  '/assets/vendor/leaflet.css',
  '/assets/vendor/images/marker-icon.png',
  '/assets/vendor/images/marker-icon-2x.png',
  '/assets/vendor/images/marker-shadow.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.log('SW cache fail:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API: network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // HTML: always network first to get latest version
  if (url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // JS/CSS/vendor: network first, fallback to cache
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Everything else: cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request);
    })
  );
});