/* Cache do site para abrir rápido e funcionar sem internet.
   Ao mudar arquivos, troque a VERSAO (e o ?v= do CSS/JS no index.html). */
var VERSAO = 'chapa62-v5';
var BASE = ['./', 'styles/style.css?v=5', 'scripts/app.js?v=5', 'manifest.webmanifest',
  'data/config.json', 'data/cardapio.json',
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

// Só guarda respostas que deram certo e são do próprio site (nunca páginas de erro)
function guardar(chave, resp) {
  if (!resp || !resp.ok || resp.type !== 'basic') return;
  var copia = resp.clone();
  caches.open(VERSAO).then(function (c) { c.put(chave, copia); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Página: rede primeiro; guarda uma cópia só (sem ?mesa=, ?t=...), para o cache não crescer
  // Admin: nunca usa cache (sempre a versão atual, nada de pedidos guardados no aparelho)
  if (url.pathname.endsWith('/admin.html') || url.pathname.endsWith('/admin.js') || url.pathname.endsWith('/admin.css')) return;
  if (req.mode === 'navigate') {
    var chave = new URL('./', self.registration.scope).href;
    e.respondWith(fetch(req).then(function (r) { guardar(chave, r); return r; })
      .catch(function () { return caches.match(chave); }));
    return;
  }
  // Cardápio e config: rede primeiro (preços sempre atualizados), cache se estiver sem internet
  if (url.pathname.indexOf('/data/') > -1) {
    e.respondWith(fetch(req).then(function (r) { guardar(req, r); return r; })
      .catch(function () { return caches.match(req, { ignoreSearch: true }); }));
    return;
  }
  // Resto (CSS, JS, fontes, fotos): cache primeiro
  e.respondWith(caches.match(req).then(function (r) {
    return r || fetch(req).then(function (resp) { guardar(req, resp); return resp; });
  }));
});
