// sw.js — MODELO do service worker. A cada build o vite.config.mjs preenche o nome do cache e a lista
// de arquivos abaixo e publica o resultado em /sw.js. Não é importado pelo app.
//
// Guarda o "shell" do app (HTML/JS/CSS do build) para abrir instantâneo mesmo sem internet. NUNCA
// intercepta chamadas de dados (Supabase, /api/*, Pluggy, Banco Central): essas vão sempre direto para a
// rede — o app já resolve "sem conexão" por conta própria (modo somente leitura com o último estado salvo).
const CACHE_NAME = "__CACHE_NAME__";
const SHELL_FILES = __SHELL_FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // um arquivo faltando não pode travar a instalação
      Promise.all(SHELL_FILES.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // só GET da mesma origem; nada de /api (dados e IA) nem de outros domínios
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // navegação (abrir/recarregar a página): rede primeiro, para pegar a versão nova; sem rede, o cache
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copia = res.clone(); caches.open(CACHE_NAME).then((c) => c.put("./index.html", copia)).catch(() => {}); }
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // arquivos do build têm hash no nome (nunca mudam): cache primeiro, atualizando em segundo plano
  event.respondWith(
    caches.match(req).then((cached) => {
      const rede = fetch(req)
        .then((res) => {
          if (res && res.ok) { const copia = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch(() => {}); }
          return res;
        })
        .catch(() => cached);
      return cached || rede;
    })
  );
});

// toque numa notificação (ex.: alerta de orçamento): traz o app para a frente, ou abre se estiver fechado
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of janelas) { if ("focus" in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow("./");
  })());
});
