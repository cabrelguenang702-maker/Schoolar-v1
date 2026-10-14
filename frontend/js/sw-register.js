// Enregistrement du Service Worker (PWA) — fichier externe pour permettre une CSP stricte.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* silencieux */ });
  });
}
