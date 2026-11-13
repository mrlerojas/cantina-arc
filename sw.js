// Service worker: caché del shell para uso sin conexión (a bordo sin señal).
const CACHE = 'navlog-20261113-0608';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/store.js', 'js/domain.js', 'js/ui.js', 'js/config.js', 'js/cloud.js', 'js/xlsx.js', 'js/treinta.js',
  'js/views/login.js', 'js/views/dashboard.js', 'js/views/cantina.js',
  'js/views/common.js', 'js/views/coal.js', 'js/views/admin.js', 'js/views/licencias.js', 'js/views/importar.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Red primero (para recibir actualizaciones), caché si no hay conexión.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (!res.ok) return res;
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => {
      if (r) return r;
      // Sin conexión y sin copia guardada: solo la navegación recibe la página principal.
      // Un archivo que falta (script, estilo, imagen) debe fallar como error de red, no como HTML.
      return e.request.mode === 'navigate' ? caches.match('index.html') : Response.error();
    }))
  );
});
