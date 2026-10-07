/* Núcleo compartilhado do Open Finance (Pluggy) no servidor — o "_" no nome impede a Vercel de expor
   este arquivo como função. Usado por api/pluggy.js (ações avulsas) e api/sync.js (sincronização).

   Variáveis de ambiente (Vercel → Settings → Environment Variables):
     PLUGGY_CLIENT_ID      — Client ID da sua aplicação em dashboard.pluggy.ai
     PLUGGY_CLIENT_SECRET  — Client Secret da mesma aplicação
     PLUGGY_ALLOWED_USERS  — (opcional, recomendado) e-mails ou ids de usuário autorizados, separados
                             por vírgula. Sem isso, qualquer pessoa logada no app consegue abrir uma
                             conexão nova usando a sua cota do Pluggy.

   O navegador NUNCA vê o Client Secret nem a API Key: só recebe Connect Tokens de 30 minutos e os
   dados já prontos de contas e lançamentos. Toda chamada exige o token de login do Supabase. */

const PLUGGY = "https://api.pluggy.ai";
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// já são públicos (estão no app servido a qualquer visitante). Servem só para conferir o token de login
// de quem chama — não são segredo e não dão acesso a nada sozinhos.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xgdigegpxnoybklmyeyq.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnZGlnZWdweG5veWJrbG15ZXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjA4MTQsImV4cCI6MjEwMDEzNjgxNH0.o9JxnQi-lj_BC_Ja6KZ9dxUyQUBO5ay6nIml5xqim6U";

const credenciais = () => ({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET });
const configurado = () => { const c = credenciais(); return Boolean(c.clientId && c.clientSecret); };

/* ---- API Key do Pluggy ----
   Vale 2 horas. Guardamos em memória do processo por 1h45 para não pedir uma nova a cada clique; se a
   função "esfriar" e o processo morrer, a próxima chamada simplesmente autentica de novo. */
let chaveEmCache = null; // { apiKey, expiraEm }
function limparChave() { chaveEmCache = null; }

async function obterApiKey(clientId, clientSecret) {
  if (chaveEmCache && chaveEmCache.expiraEm > Date.now()) return chaveEmCache.apiKey;
  const r = await fetch(`${PLUGGY}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.apiKey) {
    chaveEmCache = null;
    const e = new Error(d.message || "Não foi possível autenticar no Pluggy. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.");
    e.status = 502;
    throw e;
  }
  chaveEmCache = { apiKey: d.apiKey, expiraEm: Date.now() + 105 * 60 * 1000 };
  return d.apiKey;
}

async function chamarPluggy(apiKey, method, path, params) {
  const url = new URL(PLUGGY + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  let r;
  try { r = await fetch(url.toString(), { method, headers: { "X-API-KEY": apiKey } }); }
  catch (err) { const e = new Error("Sem resposta do Pluggy."); e.status = 503; e.transitorio = true; throw e; }
  if (r.status === 204) return {};
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.message || "O Pluggy recusou a consulta.");
    e.status = r.status === 404 ? 404 : 502;
    e.statusOriginal = r.status;
    // 5xx e 429 (limite de chamadas) costumam passar sozinhos; 4xx de dado errado, não
    e.transitorio = r.status >= 500 || r.status === 429;
    throw e;
  }
  return d;
}

/* nova tentativa com espera crescente para falhas passageiras (rede, 5xx, 429). Erro "de verdade"
   (conexão inexistente, dado inválido) volta na hora, sem insistir. */
async function comRetry(fn, { tentativas = 3, esperas = [700, 2000] } = {}) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try { return await fn(); }
    catch (err) {
      ultimo = err;
      if (!err.transitorio || i === tentativas - 1) throw err;
      await new Promise((ok) => setTimeout(ok, esperas[Math.min(i, esperas.length - 1)]));
    }
  }
  throw ultimo;
}

/* ---- quem está chamando ----
   Dados bancários não podem ficar atrás de um endpoint aberto: exigimos o token de login do Supabase e
   o conferimos com o próprio Supabase antes de tocar no Pluggy. */
async function usuarioAutorizado(req) {
  const cabecalho = req.headers.authorization || req.headers.Authorization || "";
  const token = /^Bearer (.+)$/i.test(cabecalho) ? cabecalho.replace(/^Bearer /i, "").trim() : "";
  if (!token) return { ok: false, error: "Entre com a sua conta para usar o Open Finance — sem login, o app não busca dados do seu banco." };

  let user;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { ok: false, error: "Sua sessão expirou. Entre de novo e tente outra vez." };
    user = await r.json();
  } catch (err) {
    return { ok: false, error: "Não foi possível confirmar o seu login agora. Tente de novo em instantes." };
  }
  if (!user || !user.id) return { ok: false, error: "Sua sessão expirou. Entre de novo e tente outra vez." };

  const permitidos = String(process.env.PLUGGY_ALLOWED_USERS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (permitidos.length) {
    const id = String(user.id).toLowerCase();
    const email = String(user.email || "").toLowerCase();
    if (!permitidos.includes(id) && !permitidos.includes(email)) {
      return { ok: false, error: "Esta conta não está autorizada a usar o Open Finance neste app." };
    }
  }
  return { ok: true, user };
}

/* GET /v2/transactions é paginado por cursor: cada resposta traz {results, next}, onde "next" é uma URL
   cujo parâmetro "after" vira o cursor da chamada seguinte, até "next" vir null. Quem chama recebe a
   lista inteira. Não aceita pageSize (a API recusa a chamada inteira se ele for enviado). */
async function buscarLancamentos(apiKey, { accountId, from, to }) {
  const results = [];
  let after = "";
  for (let volta = 0; volta < 20; volta++) { // teto de segurança: 20 × 500 = 10 mil lançamentos
    const d = await comRetry(() => chamarPluggy(apiKey, "GET", "/v2/transactions", { accountId, dateFrom: from, dateTo: to, after: after || undefined }));
    results.push(...(d.results || []));
    if (!d.next) break;
    try { after = new URL(d.next, "https://api.pluggy.ai").searchParams.get("after") || ""; }
    catch (e) { after = ""; }
    if (!after) break;
  }
  return results;
}

module.exports = {
  PLUGGY, UUID, DATA_ISO, credenciais, configurado, obterApiKey, limparChave, chamarPluggy, comRetry,
  usuarioAutorizado, buscarLancamentos,
};
