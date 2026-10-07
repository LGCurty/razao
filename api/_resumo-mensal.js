/* Resumo do mês por e-mail — lógica compartilhada (o "_" no nome impede a Vercel de expor este arquivo
   como função). Quem dispara: o cron diário de api/keepalive.js, só no dia 1 de cada mês, e o endpoint
   api/monthly-summary.js (envio manual, protegido por CRON_SECRET).

   Variáveis de ambiente necessárias (Vercel → Settings → Environment Variables):
     SUPABASE_SERVICE_ROLE_KEY — chave de serviço do Supabase. Lê os dados de quem pediu o resumo e o e-mail
                                 da conta. Fica SÓ no servidor; nunca vai para o navegador.
     RESEND_API_KEY            — chave da Resend (resend.com), o serviço que entrega o e-mail.
     EMAIL_FROM                — remetente verificado na Resend, ex.: "Razão <resumo@seudominio.com.br>".
     APP_URL                   — (opcional) endereço do app, para o botão "Abrir o Razão" no e-mail.
   Sem as três primeiras, nada é enviado e o resto do app segue igual.

   Só recebe quem ligou "Receber por e-mail o resumo do mês" em Configurações › Preferências. As contas
   seguem as mesmas regras do app: só o realizado conta, e gasto no cartão pesa no mês da fatura. */

const SUPABASE_URL_PADRAO = "https://xgdigegpxnoybklmyeyq.supabase.co";
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// mesma regra de txEffectiveMonth no app: gasto em cartão com fechamento/vencimento cai no mês da fatura
function mesEfetivo(t, contas) {
  if (t.type === "gasto") {
    const acc = contas.find((a) => a.id === t.acctId);
    if (acc && acc.kind === "cartao" && acc.closingDay && acc.dueDay) {
      const d = new Date(t.date + "T00:00:00");
      let y = d.getFullYear(), m = d.getMonth();
      if (d.getDate() > acc.closingDay) m += 1;
      if (acc.dueDay <= acc.closingDay) m += 1;
      y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      return `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return String(t.date || "").slice(0, 7);
}

function resumoDoMes(data, mk) {
  const contas = data.accounts || [];
  let renda = 0, despesas = 0, investido = 0;
  const porCat = {};
  (data.transactions || []).forEach((t) => {
    if ((t.status || "realizado") === "previsto") return;
    if (mesEfetivo(t, contas) !== mk) return;
    if (t.type === "ganho") renda += t.cents || 0;
    else if (t.type === "gasto") { despesas += t.cents || 0; const c = t.category || "Outros"; porCat[c] = (porCat[c] || 0) + (t.cents || 0); }
    else if (t.type === "investimento") investido += t.cents || 0;
  });
  const excecoes = ((data.budgetExceptions || {})[mk]) || {};
  const limites = { ...(data.budgets || {}), ...excecoes };
  const estouradas = Object.entries(limites)
    .filter(([c, lim]) => lim > 0 && (porCat[c] || 0) > lim)
    .map(([c, lim]) => ({ cat: c, gasto: porCat[c] || 0, limite: lim }))
    .sort((a, b) => b.gasto / b.limite - a.gasto / a.limite);
  const topCats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, cents]) => ({ cat, cents }));
  return { renda, despesas, investido, resultado: renda - despesas, topCats, estouradas, vazio: renda === 0 && despesas === 0 && investido === 0 };
}

function htmlDoResumo(nomeMes, r, appUrl) {
  const linha = (rotulo, valor, cor) =>
    `<tr><td style="padding:6px 0;color:#5C6577">${esc(rotulo)}</td><td style="padding:6px 0;text-align:right;font-weight:600;color:${cor || "#0F1218"}">${esc(valor)}</td></tr>`;
  const cats = r.topCats.map((c) => linha(c.cat, brl(c.cents))).join("");
  const estouro = r.estouradas.length
    ? `<p style="margin:18px 0 6px;font-weight:600;color:#C2382F">Passaram do orçamento</p><table style="width:100%;border-collapse:collapse">${r.estouradas.map((e) => linha(e.cat, `${brl(e.gasto)} de ${brl(e.limite)}`, "#C2382F")).join("")}</table>`
    : `<p style="margin:18px 0 0;color:#12805F">Nenhuma categoria passou do orçamento.</p>`;
  const corpo = r.vazio
    ? `<p style="color:#5C6577">Nenhum movimento registrado em ${esc(nomeMes)}.</p>`
    : `<table style="width:100%;border-collapse:collapse">
        ${linha("Renda", brl(r.renda), "#12805F")}
        ${linha("Despesas", brl(r.despesas), "#C2382F")}
        ${linha("Resultado", brl(r.resultado), r.resultado >= 0 ? "#12805F" : "#C2382F")}
        ${r.investido ? linha("Investido", brl(r.investido), "#3B63C4") : ""}
      </table>
      ${cats ? `<p style="margin:18px 0 6px;font-weight:600">Onde mais foi o dinheiro</p><table style="width:100%;border-collapse:collapse">${cats}</table>` : ""}
      ${estouro}`;
  const botao = appUrl ? `<p style="margin:22px 0 0"><a href="${esc(appUrl)}" style="display:inline-block;background:#2E4152;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px">Abrir o Razão</a></p>` : "";
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0F1218">
    <p style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#5C6577;margin:0">Razão · resumo do mês</p>
    <h1 style="font-size:22px;margin:6px 0 16px">${esc(nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1))}</h1>
    ${corpo}${botao}
    <p style="font-size:11px;color:#98A0B3;margin-top:26px">Você recebe este e-mail porque ligou o resumo mensal em Configurações › Preferências. Desligue lá quando quiser.</p>
  </div>`;
}

/* mês de referência = o mês anterior a "agora" (o cron roda no dia 1) */
function mesAnterior(agora) {
  const d = agora || new Date();
  const ref = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return { mk: `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}`, nome: `${MESES[ref.getUTCMonth()]} de ${ref.getUTCFullYear()}` };
}

async function enviarResumos({ env, fetchImpl, agora } = {}) {
  const e = env || process.env;
  const f = fetchImpl || fetch;
  const faltando = ["SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "EMAIL_FROM"].filter((k) => !e[k]);
  if (faltando.length) return { ok: false, configurado: false, faltando };
  const url = e.SUPABASE_URL || SUPABASE_URL_PADRAO;
  const h = { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}` };
  const { mk, nome } = mesAnterior(agora);

  const r = await f(`${url}/rest/v1/finance_data?select=user_id,data`, { headers: h });
  if (!r.ok) throw new Error(`O Supabase respondeu ${r.status} ao listar os dados.`);
  const linhas = await r.json();
  const alvo = (linhas || []).filter((l) => l && l.data && l.data.settings && l.data.settings.emailSummary === true && UUID.test(String(l.user_id || "")));

  const resultado = { ok: true, configurado: true, mes: mk, pedidos: alvo.length, enviados: 0, semEmail: 0, erros: [] };
  for (const l of alvo) {
    try {
      const u = await f(`${url}/auth/v1/admin/users/${l.user_id}`, { headers: h });
      const user = u.ok ? await u.json() : null;
      const email = user && (user.email || (user.user && user.user.email));
      if (!email) { resultado.semEmail++; continue; }
      const html = htmlDoResumo(nome, resumoDoMes(l.data, mk), e.APP_URL);
      const envio = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: e.EMAIL_FROM, to: [email], subject: `Razão — seu resumo de ${nome}`, html }),
      });
      if (!envio.ok) { const t = await envio.text().catch(() => ""); throw new Error(`a Resend respondeu ${envio.status} ${t.slice(0, 120)}`); }
      resultado.enviados++;
    } catch (err) {
      // não expõe e-mail nem dados de ninguém na resposta: só o motivo genérico
      resultado.erros.push(String((err && err.message) || err));
    }
  }
  return resultado;
}

module.exports = { enviarResumos, resumoDoMes, htmlDoResumo, mesAnterior, mesEfetivo };
