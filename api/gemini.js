// Proxy serverless para a API do Gemini — mantém a chave só no servidor.
// Configure a variável de ambiente GEMINI_API_KEY no painel do projeto na Vercel
// (Settings > Environment Variables) e faça um novo deploy depois de definir.
const DEFAULT_MODEL = "gemini-2.5-flash";
// só estes modelos podem ser pedidos pelo navegador: o campo "model" vem do cliente e não pode virar
// um caminho arbitrário na URL da API do Google.
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
]);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY não configurada no servidor." });
    return;
  }

  const { prompt, inlineData, schema, model } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Campo 'prompt' é obrigatório." });
    return;
  }

  const parts = [{ text: prompt }];
  if (inlineData && inlineData.data) {
    parts.push({
      inline_data: {
        mime_type: inlineData.mimeType || "application/octet-stream",
        data: inlineData.data,
      },
    });
  }

  const body = { contents: [{ parts }] };
  if (schema) {
    body.generationConfig = { responseMimeType: "application/json", responseSchema: schema };
  }
  // extrato/fatura de um mês inteiro rende JSON longo: sem um teto alto a resposta é cortada no meio
  // e o JSON.parse do cliente falha. 65536 é o limite dos modelos 2.5.
  if (inlineData && inlineData.data) {
    body.generationConfig = { ...(body.generationConfig || {}), maxOutputTokens: 65536 };
  }

  const useModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: data?.error?.message || "Erro na IA." });
      return;
    }
    const candidate = data?.candidates?.[0];
    // resposta truncada por limite de tokens: o texto parcial não é JSON válido, então é melhor
    // devolver um erro explicando do que deixar o cliente quebrar num JSON.parse sem contexto.
    if (candidate?.finishReason === "MAX_TOKENS") {
      res.status(502).json({ error: "O documento é grande demais para uma leitura só. Tente enviar menos páginas por arquivo." });
      return;
    }
    const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text) {
      res.status(502).json({ error: "A IA não retornou conteúdo." });
      return;
    }
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erro interno no proxy da IA." });
  }
};
