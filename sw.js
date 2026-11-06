/* Cache do site para abrir rápido e funcionar sem internet.
   Ao mudar arquivos, troque a VERSAO. */
var VERSAO = 'chapa62-v2';
var BASE = ['./', 'index.html', 'styles/style.css?v=2', 'scripts/app.js?v=2', 'manifest.webmanifest',
  'assets/fonts/bricolage-800.woff2', 'assets/fonts/bricolage-500.woff2', 'assets/fonts/mono-400.woff2', 'assets/fonts/mono-700.woff2',
  'assets/fotos/hero.jpg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(BASE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Cardápio, config e páginas: tenta a rede primeiro (preços sempre atualizados)
  if (url.pathname.indexOf('/data/') > -1 || req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (r) {
      var copia = r.clone(); caches.open(VERSAO).then(function (c) { c.put(req, copia); }); return r;
    }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); }));
    return;
  }
  // Resto: cache primeiro
  e.respondWith(caches.match(req).then(function (r) {
    return r || fetch(req).then(function (resp) {
      var copia = resp.clone(); caches.open(VERSAO).then(function (c) { c.put(req, copia); }); return resp;
    });
  }));
});
