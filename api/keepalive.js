/* Mantém o projeto do Supabase acordado — o plano gratuito pausa o projeto depois de 7 dias sem
   nenhuma chamada à API. Este endpoint faz uma consulta mínima de verdade (não só um "health check")
   uma vez por dia, agendado pela Vercel (ver vercel.json na raiz do projeto), para o relógio de
   inatividade nunca completar os 7 dias.

   Não precisa de nenhuma variável de ambiente nova: usa a mesma URL e a mesma chave anônima que já
   estão no index.html (são públicas por natureza — o app inteiro roda com elas no navegador). */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xgdigegpxnoybklmyeyq.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnZGlnZWdweG5veWJrbG15ZXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjA4MTQsImV4cCI6MjEwMDEzNjgxNH0.o9JxnQi-lj_BC_Ja6KZ9dxUyQUBO5ay6nIml5xqim6U";

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
    // uma leitura real de 1 linha na tabela — é isso que o Supabase registra como atividade do
    // projeto (diferente de um simples "health check", que às vezes nem toca o banco)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/finance_data?select=user_id&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    res.status(200).json({ ok: r.ok, status: r.status, at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Falha ao pingar o Supabase." });
  }
};
