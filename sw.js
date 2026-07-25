// sw.js — cache-first para o "shell" estático do Razão (HTML/JS/bibliotecas locais), pra abrir
// instantâneo mesmo sem internet. NUNCA intercepta chamadas de dados (Supabase, /api/gemini,
// pdf.js sob demanda): essas sempre vão direto pra rede, sem passar pelo cache — o app já resolve
// "sem conexão" por conta própria (modo somente leitura com o último estado salvo, ver index.html).
const CACHE_NAME = "razao-shell-v5";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.compiled.js",
  "./vendor/react.production.min.js",
  "./vendor/react-dom.production.min.js",
  "./vendor/supabase.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // um arquivo faltando (ex: app.compiled.js antes de rodar o build) não pode travar a instalação
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

  // só GET e só mesma origem entram no cache do shell. Qualquer coisa cross-origin (Supabase, Gemini,
  // qualquer CDN restante) ou que não seja GET (upsert, insert, POST do /api/gemini) passa direto —
  // essa é a parte "network-first para os dados": nunca cacheamos nem reproduzimos essas respostas.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      // cache-first: responde na hora com o que já tem, e atualiza em segundo plano pra próxima vez
      return cached || network;
    })
  );
});
