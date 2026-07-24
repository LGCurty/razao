// Proxy serverless para a API do Gemini — mantém a chave só no servidor.
// Configure a variável de ambiente GEMINI_API_KEY no painel do projeto na Vercel
// (Settings > Environment Variables) e faça um novo deploy depois de definir.
const DEFAULT_MODEL = "gemini-2.5-flash";

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

  const useModel = model || DEFAULT_MODEL;

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
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ error: "A IA não retornou conteúdo." });
      return;
    }
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erro interno no proxy da IA." });
  }
};
