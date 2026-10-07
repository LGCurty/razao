/* POST /api/sync — sincroniza UMA conexão do Open Finance (Pluggy) de uma vez, no servidor.

   Corpo: { itemId, from?: "AAAA-MM-DD", to?: "AAAA-MM-DD" }
   Resposta (HTTP 200 sempre que o pedido em si é válido — o resultado da sincronização vai em "status"):
     status      "success"    todas as contas vieram completas
                 "partial"    algumas contas falharam (ver "erros"); as outras vieram normalmente
                 "error"      nada veio (banco fora do ar, conexão sem contas, conexão inexistente…)
                 "reconectar" o banco exige ação da pessoa (senha trocada, consentimento vencido, MFA)
     itemStatus  status da conexão no Pluggy (UPDATED, LOGIN_ERROR, OUTDATED…)
     aviso       texto para a tela quando a conexão está de pé mas não 100% (ex.: banco ainda atualizando)
     error       texto do problema quando status é "error" ou "reconectar"
     item        { id, connectorName, connectorImage, lastUpdatedAt }
     contas      contas devolvidas pelo banco (com saldo)
     transacoes  { [accountId]: lançamentos } — só das contas que deram certo
     erros       [{ accountId, nome, error }] — contas que falharam mesmo depois das novas tentativas

   Cada chamada ao Pluggy ganha até 3 tentativas com espera crescente quando a falha é passageira (rede,
   5xx, limite de chamadas); erro "de verdade" volta na hora. Credenciais e acesso: ver api/_pluggy-core.js. */

const {
  UUID, DATA_ISO, credenciais, configurado, obterApiKey, limparChave, chamarPluggy, comRetry, usuarioAutorizado, buscarLancamentos,
} = require("./_pluggy-core");

// estados da conexão que só se resolvem com a pessoa reabrindo o Pluggy Connect
const PEDE_RECONEXAO = {
  LOGIN_ERROR: "O banco recusou o acesso (senha trocada ou consentimento vencido). Reconecte.",
  WAITING_USER_INPUT: "O banco está pedindo uma confirmação sua. Reconecte para responder.",
  OUTDATED: "A última atualização falhou. Tente de novo ou reconecte.",
};
const AVISOS = {
  UPDATING: "O banco ainda está enviando os dados. Tente atualizar de novo em um minuto.",
  ERROR: "O banco devolveu um erro na última atualização. Tente de novo mais tarde.",
};

/* status final a partir de quantas contas deram certo: a função é pura para poder ser testada sozinha */
function statusFinal(totalContas, contasComErro) {
  if (totalContas === 0 || contasComErro >= totalContas) return "error";
  return contasComErro > 0 ? "partial" : "success";
}

async function sincronizarConexao(apiKey, { itemId, from, to }) {
  let item;
  try {
    item = await comRetry(() => chamarPluggy(apiKey, "GET", `/items/${itemId}`));
  } catch (err) {
    if (err.status === 404) {
      return { status: "reconectar", itemStatus: "NOT_FOUND", error: "Esta conexão não existe mais no Pluggy. Remova e conecte o banco de novo." };
    }
    return { status: "error", itemStatus: "", error: err.message || "Não foi possível consultar a conexão." };
  }

  const itemStatus = String(item.status || "").toUpperCase();
  const base = {
    itemStatus,
    item: {
      id: item.id || itemId,
      connectorName: item.connector?.name || "",
      connectorImage: item.connector?.imageUrl || "",
      lastUpdatedAt: item.lastUpdatedAt || "",
    },
  };
  if (PEDE_RECONEXAO[itemStatus]) return { ...base, status: "reconectar", error: PEDE_RECONEXAO[itemStatus] };

  let contas;
  try {
    const d = await comRetry(() => chamarPluggy(apiKey, "GET", "/accounts", { itemId, pageSize: 200 }));
    contas = d.results || [];
  } catch (err) {
    return { ...base, status: "error", error: err.message || "Não foi possível listar as contas." };
  }
  if (contas.length === 0) return { ...base, status: "error", error: "O banco não devolveu nenhuma conta nesta conexão." };

  // uma conta por vez: o Pluggy limita chamadas simultâneas, e a falha de uma não derruba as outras
  const transacoes = {};
  const erros = [];
  for (const c of contas) {
    try {
      transacoes[c.id] = await buscarLancamentos(apiKey, { accountId: c.id, from, to });
    } catch (err) {
      erros.push({ accountId: c.id, nome: c.name || c.marketingName || "Conta", error: err.message || "Falha ao buscar lançamentos." });
    }
  }

  const status = statusFinal(contas.length, erros.length);
  return {
    ...base,
    status,
    aviso: AVISOS[itemStatus] || "",
    error: status === "error" ? (erros[0]?.error || "Não foi possível buscar os lançamentos.") : "",
    contas,
    transacoes,
    erros,
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Método não permitido." }); return; }
  if (!configurado()) {
    res.status(503).json({ error: "Open Finance ainda não configurado: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nas variáveis de ambiente da Vercel e faça um novo deploy." });
    return;
  }

  const { itemId, from, to } = req.body || {};
  if (!UUID.test(itemId || "")) { res.status(400).json({ error: "Conexão inválida." }); return; }
  if (from && !DATA_ISO.test(from)) { res.status(400).json({ error: "Data inicial inválida." }); return; }
  if (to && !DATA_ISO.test(to)) { res.status(400).json({ error: "Data final inválida." }); return; }

  const acesso = await usuarioAutorizado(req);
  if (!acesso.ok) { res.status(401).json({ error: acesso.error }); return; }

  try {
    const { clientId, clientSecret } = credenciais();
    let apiKey = await obterApiKey(clientId, clientSecret);
    let r = await sincronizarConexao(apiKey, { itemId, from, to });
    // API Key em cache pode ter sido revogada antes de expirar: autentica de novo uma vez e repete
    if (r.status === "error" && /unauthori[sz]ed|api.?key/i.test(r.error || "")) {
      limparChave();
      apiKey = await obterApiKey(clientId, clientSecret);
      r = await sincronizarConexao(apiKey, { itemId, from, to });
    }
    res.status(200).json(r);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erro interno no Open Finance." });
  }
};

module.exports.statusFinal = statusFinal;
module.exports.sincronizarConexao = sincronizarConexao;
