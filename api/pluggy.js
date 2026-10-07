/* Proxy serverless para a API do Pluggy (Open Finance) — as credenciais ficam SÓ no servidor.
   Ações avulsas (abrir a tela de conexão, consultar/remover uma conexão, listar contas e lançamentos).
   A sincronização completa de uma conexão, com novas tentativas e status por conta, fica em api/sync.js.
   Variáveis de ambiente e regras de acesso: ver api/_pluggy-core.js. */

const {
  PLUGGY, UUID, DATA_ISO, credenciais, configurado, obterApiKey, chamarPluggy, usuarioAutorizado, buscarLancamentos,
} = require("./_pluggy-core");

// o navegador escolhe uma AÇÃO de uma lista fechada, nunca um caminho: nada vindo do cliente é
// concatenado cru na URL da API do Pluggy (mesmo cuidado do ALLOWED_MODELS em api/gemini.js).
const ACTIONS = new Set(["status", "connect_token", "item", "accounts", "transactions", "delete_item"]);

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

  // "status" é a única ação sem login: serve só para a tela saber se vale a pena oferecer o botão
  // de conectar, e não revela nada além de "está configurado ou não".
  if (action === "status") {
    res.status(200).json({ configurado: configurado() });
    return;
  }
  if (!configurado()) {
    res.status(503).json({ error: "Open Finance ainda não configurado: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nas variáveis de ambiente da Vercel e faça um novo deploy." });
    return;
  }

  const acesso = await usuarioAutorizado(req);
  if (!acesso.ok) {
    res.status(401).json({ error: acesso.error });
    return;
  }

  try {
    const { clientId, clientSecret } = credenciais();
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
      const results = await buscarLancamentos(apiKey, { accountId, from, to });
      res.status(200).json({ results, total: results.length });
      return;
    }

    res.status(400).json({ error: "Ação desconhecida." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erro interno no Open Finance." });
  }
};
