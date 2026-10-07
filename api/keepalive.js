/* Mantém o projeto do Supabase acordado — o plano gratuito pausa o projeto depois de 7 dias sem
   atividade. Este endpoint grava um batimento no banco uma vez por dia, agendado pela Vercel (ver
   vercel.json na raiz do projeto), para o relógio de inatividade nunca completar os 7 dias. Um segundo
   agendador independente (.github/workflows/keepalive.yml) faz o mesmo, caso o cron da Vercel falhe.

   Não precisa de nenhuma variável de ambiente nova: usa a mesma URL e a mesma chave anônima que já
   estão no index.html (são públicas por natureza — o app inteiro roda com elas no navegador). */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xgdigegpxnoybklmyeyq.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnZGlnZWdweG5veWJrbG15ZXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjA4MTQsImV4cCI6MjEwMDEzNjgxNH0.o9JxnQi-lj_BC_Ja6KZ9dxUyQUBO5ay6nIml5xqim6U";

const { enviarResumos } = require("./_resumo-mensal");

module.exports = async (req, res) => {
  // quando CRON_SECRET está configurado na Vercel, ela assina a chamada agendada com esse cabeçalho.
  // Sem essa variável, o endpoint continua funcionando (é inofensivo: só lê, não muda nada) — a
  // checagem é só para fechar a porta a chamadas de fora, caso você queira configurá-la depois.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: "Não autorizado." });
      return;
    }
  }
  try {
    // uma GRAVAÇÃO real no banco (função keepalive_ping, ver supabase/migrations/…_keepalive.sql).
    // A leitura anônima em finance_data que ficava aqui volta vazia por causa do RLS e não impediu a
    // pausa; ela continua só como reserva, caso a função ainda não tenha sido criada no banco.
    const cab = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };
    let r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/keepalive_ping`, {
      method: "POST", headers: cab, body: JSON.stringify({ origem: "vercel-cron" }),
    });
    let via = "keepalive_ping";
    if (r.status === 404) {
      r = await fetch(`${SUPABASE_URL}/rest/v1/finance_data?select=user_id&limit=1`, { headers: cab });
      via = "leitura";
    }
    // dia 1 (UTC — o cron roda às 03h UTC, meia-noite em Brasília): aproveita a mesma chamada agendada
    // para mandar o resumo do mês que fechou, sem precisar de um segundo cron no vercel.json
    let resumo = null;
    if (new Date().getUTCDate() === 1) {
      try { resumo = await enviarResumos({ env: process.env }); }
      catch (e) { resumo = { ok: false, error: e.message || "Falha ao enviar os resumos." }; }
    }
    // falha do Supabase vira erro de verdade (502), e não um 200 com ok:false que ninguém vê: assim
    // aparece em Vercel → Logs / Cron Jobs como execução com falha
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, via, at: new Date().toISOString(), resumo });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Falha ao pingar o Supabase." });
  }
};
