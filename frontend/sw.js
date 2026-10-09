// SCHOOLAR — Service Worker (app shell)
// But : rendre l'app installable et rapide à recharger sur mobile.
// Règle stricte : ne JAMAIS mettre en cache les appels API (/backend/... ou
// une origine différente) — un établissement scolaire a besoin de données
// toujours à jour (notes, présences, messages...). Seul le "coffrage" de
// l'application (HTML/CSS/JS/icônes) est mis en cache.

const CACHE_NAME = 'schoolar-shell-v1';

const SHELL_ASSETS = [
  './index.html',
  './env-config.js',
  './manifest.json',
  './css/style.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isApiRequest(url) {
  // Toute requête qui ne pointe pas vers un fichier statique connu du shell
  // (donc tout ce qui ressemble à un appel API backend, quel que soit son
  // origine ou son chemin) est exclue du cache.
  return url.pathname.includes('/backend/') || url.pathname.includes('/api/') || url.origin !== self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // ne jamais intercepter POST/PUT/DELETE (écritures)

  const url = new URL(req.url);
  if (isApiRequest(url)) return; // laisse passer tel quel, jamais de cache

  // Stratégie "réseau d'abord, repli sur le cache" pour le shell : garantit
  // qu'on charge toujours la dernière version tant qu'il y a du réseau, et
  // qu'on reste utilisable en cas de coupure.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
