/* Proxy serverless para a API do Pluggy (Open Finance) — as credenciais ficam SÓ no servidor.

   Configure na Vercel (Settings > Environment Variables) e faça um novo deploy depois:
     PLUGGY_CLIENT_ID      — Client ID da sua aplicação em dashboard.pluggy.ai
     PLUGGY_CLIENT_SECRET  — Client Secret da mesma aplicação
     PLUGGY_ALLOWED_USERS  — (opcional, recomendado) e-mails ou ids de usuário autorizados,
                             separados por vírgula. Sem isso, qualquer pessoa logada no app
                             consegue abrir uma conexão nova usando a sua cota do Pluggy.

   O navegador NUNCA vê o Client Secret nem a API Key: ele só recebe um Connect Token de 30 minutos
   (que serve apenas para abrir a tela de conexão do banco) e os dados já prontos de contas e
   lançamentos. Toda chamada exige o token de login do Supabase — sem login, nada passa daqui. */

const PLUGGY = "https://api.pluggy.ai";

// o navegador escolhe uma AÇÃO de uma lista fechada, nunca um caminho: nada vindo do cliente é
// concatenado cru na URL da API do Pluggy (mesmo cuidado do ALLOWED_MODELS em api/gemini.js).
const ACTIONS = new Set(["status", "connect_token", "item", "accounts", "transactions", "delete_item"]);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// já são públicos (estão no index.html, servido a qualquer visitante). Ficam aqui só para conferir o
// token de login de quem chama — não são segredo e não dão acesso a nada sozinhos.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xgdigegpxnoybklmyeyq.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnZGlnZWdweG5veWJrbG15ZXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjA4MTQsImV4cCI6MjEwMDEzNjgxNH0.o9JxnQi-lj_BC_Ja6KZ9dxUyQUBO5ay6nIml5xqim6U";

/* ---- API Key do Pluggy ----
   Vale 2 horas. Guardamos em memória do processo por 1h45 para não pedir uma nova a cada clique;
   se a função "esfriar" e o processo morrer, a próxima chamada simplesmente autentica de novo. */
let chaveEmCache = null; // { apiKey, expiraEm }

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
  const r = await fetch(url.toString(), { method, headers: { "X-API-KEY": apiKey } });
  if (r.status === 204) return {};
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.message || "O Pluggy recusou a consulta.");
    e.status = r.status === 404 ? 404 : 502;
    throw e;
  }
  return d;
}

/* ---- quem está chamando ----
   Dados bancários não podem ficar atrás de um endpoint aberto. Exigimos o token de login do
   Supabase e o conferimos com o próprio Supabase antes de tocar no Pluggy. */
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const corpo = req.body || {};
  const { action } = corpo;
  if (!ACTIONS.has(action)) {
    res.status(400).json({ error: "Ação desconhecida." });
    return;
  }

  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;

  // "status" é a única ação sem login: serve só para a tela saber se vale a pena oferecer o botão
  // de conectar, e não revela nada além de "está configurado ou não".
  if (action === "status") {
    res.status(200).json({ configurado: Boolean(clientId && clientSecret) });
    return;
  }
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: "Open Finance ainda não configurado: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nas variáveis de ambiente da Vercel e faça um novo deploy." });
    return;
  }

  const acesso = await usuarioAutorizado(req);
  if (!acesso.ok) {
    res.status(401).json({ error: acesso.error });
    return;
  }

  try {
    const apiKey = await obterApiKey(clientId, clientSecret);

    if (action === "connect_token") {
      // com itemId, o token reabre uma conexão existente (trocar senha, refazer o MFA);
      // sem itemId, abre uma conexão nova.
      const { itemId } = corpo;
      if (itemId && !UUID.test(itemId)) { res.status(400).json({ error: "Conexão inválida." }); return; }
      const payload = { options: { clientUserId: acesso.user.id } };
      if (itemId) payload.itemId = itemId;
      const r = await fetch(`${PLUGGY}/connect_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.accessToken) {
        res.status(502).json({ error: d.message || "Não foi possível abrir a tela de conexão com o banco." });
        return;
      }
      res.status(200).json({ accessToken: d.accessToken });
      return;
    }

    if (action === "item" || action === "delete_item") {
      const { itemId } = corpo;
      if (!UUID.test(itemId || "")) { res.status(400).json({ error: "Conexão inválida." }); return; }
      const d = await chamarPluggy(apiKey, action === "item" ? "GET" : "DELETE", `/items/${itemId}`);
      res.status(200).json(d);
      return;
    }

    if (action === "accounts") {
      const { itemId } = corpo;
      if (!UUID.test(itemId || "")) { res.status(400).json({ error: "Conexão inválida." }); return; }
      const d = await chamarPluggy(apiKey, "GET", "/accounts", { itemId, pageSize: 200 });
      res.status(200).json({ results: d.results || [] });
      return;
    }

    if (action === "transactions") {
      const { accountId, from, to } = corpo;
      if (!UUID.test(accountId || "")) { res.status(400).json({ error: "Conta inválida." }); return; }
      if (from && !DATA_ISO.test(from)) { res.status(400).json({ error: "Data inicial inválida." }); return; }
      if (to && !DATA_ISO.test(to)) { res.status(400).json({ error: "Data final inválida." }); return; }
      const page = Math.min(200, Math.max(1, Math.round(Number(corpo.page) || 1)));
      const d = await chamarPluggy(apiKey, "GET", "/transactions", { accountId, from, to, page, pageSize: 500 });
      res.status(200).json({
        results: d.results || [],
        page: d.page || page,
        totalPages: d.totalPages || 1,
        total: d.total || (d.results || []).length,
      });
      return;
    }

    res.status(400).json({ error: "Ação desconhecida." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erro interno no Open Finance." });
  }
};
