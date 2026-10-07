/* Envio manual do resumo mensal por e-mail (o automático roda pelo cron diário de api/keepalive.js,
   no dia 1). Para testar depois de configurar as variáveis (ver api/_resumo-mensal.js):
     curl -H "Authorization: Bearer <CRON_SECRET>" https://<seu-app>.vercel.app/api/monthly-summary
   Sem CRON_SECRET configurado, este endpoint fica fechado — dispararia e-mails para todos que pediram. */
const { enviarResumos } = require("./_resumo-mensal");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") { res.status(405).json({ error: "Método não permitido." }); return; }
  const segredo = process.env.CRON_SECRET;
  if (!segredo || (req.headers.authorization || "") !== `Bearer ${segredo}`) {
    res.status(401).json({ error: "Não autorizado." });
    return;
  }
  try {
    const r = await enviarResumos({ env: process.env });
    res.status(r.configurado === false ? 503 : 200).json(r);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Falha ao enviar os resumos." });
  }
};
