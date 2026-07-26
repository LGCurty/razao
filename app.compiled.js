/* Gerado automaticamente por build.js — não edite este arquivo à mão.
   Para atualizar, edite o JSX dentro de index.html e rode: node build.js
   Versão 1.2.5 · compilado em 2026-07-26T04:17:54.344Z */
const {
  useState,
  useEffect,
  useMemo,
  useRef,
  useId
} = React;

/* =======================================================================
   CONFIGURAÇÃO DO BANCO DE DADOS (Supabase)
   Preencha os dois valores abaixo com os dados do seu projeto Supabase.
   (Project Settings > API > "Project URL" e "anon public key".)
   Enquanto não preencher, o app roda em MODO LOCAL (só neste aparelho).
   ======================================================================= */
/* =======================================================================
   VERSÃO — os dois valores abaixo são reescritos automaticamente pelo
   build.js a cada "node build.js"; não precisa (nem adianta) editar à mão.
   O mesmo número vai para o nome do cache do service worker, então todo
   build novo invalida o anterior e quem está com o site aberto recebe o
   aviso de atualização.
   ======================================================================= */
const APP_VERSION = "1.2.5";
const APP_BUILD = "2026-07-26";
const SUPABASE_URL = "https://xgdigegpxnoybklmyeyq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnZGlnZWdweG5veWJrbG15ZXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjA4MTQsImV4cCI6MjEwMDEzNjgxNH0.o9JxnQi-lj_BC_Ja6KZ9dxUyQUBO5ay6nIml5xqim6U";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("SEU-PROJETO") && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes("SUA-CHAVE");
const sb = configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* pdf.js é pesado (~1,4 MB com o worker) e só serve pra importação do banco — carregado sob demanda,
   só na primeira vez que a pessoa realmente tenta ler um PDF, não no carregamento do app inteiro. */
let pdfJsLoadPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsLoadPromise) return pdfJsLoadPromise;
  pdfJsLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    s.onerror = () => {
      pdfJsLoadPromise = null;
      reject(new Error("Não foi possível carregar o leitor de PDF. Verifique sua conexão e tente de novo."));
    };
    document.head.appendChild(s);
  });
  return pdfJsLoadPromise;
}

/* =======================================================================
   IA (Google Gemini) — usada em vários pontos do app: leitura de PDF/foto
   de extrato e recibo, categorização automática, resumo mensal, detecção
   de assinaturas e o assistente de perguntas.
   As chamadas passam por /api/gemini (função serverless da Vercel), que
   guarda a chave no servidor via variável de ambiente GEMINI_API_KEY —
   ela nunca fica exposta neste arquivo nem chega ao navegador de quem
   visita o site. Configure a env var no painel do projeto na Vercel
   (Settings > Environment Variables) e faça um novo deploy.
   Rodando localmente via file:// (sem o endpoint /api disponível), os
   recursos de IA falham de forma controlada e, quando possível, caem
   para uma alternativa sem IA (ex: leitura de PDF por regex).
   ======================================================================= */
const fileToBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

/* chama o proxy /api/gemini; devolve o texto cru da resposta (JSON.parse se usar schema) */
async function callGemini({
  prompt,
  inlineData,
  schema,
  model
}) {
  let res;
  try {
    res = await fetch("/api/gemini", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        inlineData,
        schema,
        model
      })
    });
  } catch (networkErr) {
    throw new Error("Não foi possível falar com a IA (sem conexão com o servidor).");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro na IA (${res.status}).`);
  if (!data.text) throw new Error("A IA não retornou dados.");
  return data.text;
}

/* modelos disponíveis no proxy /api/gemini. "rapido" é o padrão (cota grátis generosa);
   "cuidadoso" usa o modelo maior, que erra menos em fatura/extrato com layout esquisito,
   em troca de uma cota grátis bem menor e de alguns segundos a mais por documento. */
const AI_MODELS = {
  rapido: {
    id: "gemini-2.5-flash",
    label: "Rápido",
    hint: "Gemini 2.5 Flash — cota grátis alta, alguns segundos por documento."
  },
  cuidadoso: {
    id: "gemini-2.5-pro",
    label: "Cuidadoso",
    hint: "Gemini 2.5 Pro — lê com mais atenção faturas confusas; cota grátis menor e mais lento."
  }
};
const aiModelId = key => (AI_MODELS[key] || AI_MODELS.rapido).id;

/* naturezas que a IA pode atribuir a uma linha do documento. Ficam separadas do "type" do app porque
   pagamento de fatura e transferência entre bancos viram o MESMO type ("transferencia") no final, só que
   com contas de origem/destino diferentes — a distinção importa para montar o par certo. */
const AI_NATUREZAS = ["gasto", "ganho", "investimento", "pagamento_fatura", "transferencia_saida", "transferencia_entrada", "estorno", "ignorar"];

/* descreve as contas cadastradas para a IA: é o que permite casar o documento com o banco certo
   ("fatura do Nubank" → o cartão Nubank) e apontar a contraparte de transferências e pagamentos. */
function accountsForPrompt(accounts) {
  return accounts.map(a => {
    const o = {
      id: a.id,
      nome: a.name,
      tipo: a.kind === "cartao" ? "cartão de crédito" : "conta bancária"
    };
    if (a.kind === "cartao" && a.closingDay) o.diaFechamento = a.closingDay;
    if (a.kind === "cartao" && a.dueDay) o.diaVencimento = a.dueDay;
    return o;
  });
}

/* Lê um documento inteiro (extrato em PDF, fatura de cartão em PDF ou foto de recibo) e devolve
   {documento, lancamentos} já classificados. É o coração do "open finance manual": a IA primeiro decide
   QUE documento é aquele e de QUAL conta cadastrada ele é, depois classifica linha por linha. */
async function analyzeDocumentWithAI({
  base64,
  mimeType,
  fileName,
  accounts,
  model
}) {
  const categoryList = Object.entries(CATS).map(([t, cats]) => `- ${t}: ${cats.map(c => c[0]).join(", ")}`).join("\n");
  const prompt = `Você é um analista financeiro brasileiro, meticuloso, que lê documentos bancários em PDF ou foto e transforma cada linha em um lançamento estruturado. Leia o documento INTEIRO com atenção — todas as páginas — antes de responder. Nome do arquivo: "${fileName || "documento"}". Data de hoje: ${todayISO()}.

CONTAS JÁ CADASTRADAS PELO USUÁRIO (use exatamente estes ids):
${JSON.stringify(accountsForPrompt(accounts), null, 1)}

PASSO 1 — Identifique o documento (campo "documento"):
- tipo:
  · "extrato" = movimentação de uma CONTA bancária (saldo, PIX, TED, débitos, créditos, salário).
  · "fatura" = fatura de CARTÃO DE CRÉDITO (compras do período, parcelas, "total desta fatura", vencimento, limite).
  · "recibo" = cupom fiscal, nota ou comprovante de uma compra única.
  · "outro" = qualquer outra coisa.
  Sinais de fatura: existe "vencimento", "total desta fatura", "limite", "compras parceladas", "pagamento recebido". Sinais de extrato: existe "saldo anterior"/"saldo do dia"/"saldo final" e a coluna de saldo acumulado.
- banco: nome da instituição (ex: Nubank, Itaú, Bradesco, Inter, C6 Bank, BTG, Caixa, Banco do Brasil, Santander, Mercado Pago, PicPay, XP).
- contaId: o id da conta cadastrada que ESTE documento representa. Regras rígidas:
  · documento "fatura" só pode casar com uma conta de tipo "cartão de crédito";
  · documento "extrato" só pode casar com uma conta de tipo "conta bancária";
  · case pelo nome do banco/apelido; se nenhuma conta cadastrada servir, devolva "" (string vazia) — não invente id.
- periodoInicio / periodoFim: primeiro e último dia cobertos pelo documento, em AAAA-MM-DD.
- vencimento: só para fatura, a data de vencimento em AAAA-MM-DD (senão "").
- totalDocumento: para fatura, o "total desta fatura" em reais; para extrato, 0.
- confianca: 0 a 1, o quanto você tem certeza dessa identificação.
- observacao: uma frase curta em português explicando como você identificou o documento e a conta.

PASSO 2 — Extraia TODOS os lançamentos individuais, na ordem em que aparecem, sem pular nenhum e sem inventar nenhum. Para cada um:
- data: AAAA-MM-DD. Se a linha só tiver dia/mês, complete com o ano do período do documento (cuidado com a virada de ano em dezembro/janeiro).
- descricao: curta e limpa, sem códigos internos do banco, mas preservando o nome do estabelecimento ou da pessoa.
- valor: número POSITIVO em reais (ex: 150.5). O sinal nunca vai aqui — quem diz se entra ou sai é a "natureza".
- natureza, escolhida com muito critério:
  · "gasto" — despesa de verdade: compra, débito, tarifa, juros, IOF, anuidade, boleto pago, saque. Em uma FATURA, toda compra do período é "gasto".
  · "ganho" — entrada de verdade: salário, PIX/TED recebido de terceiros, rendimento, cashback creditado, restituição.
  · "investimento" — aplicação/aporte (CDB, tesouro, fundo, previdência, compra de ações, resgate NÃO conta aqui).
  · "pagamento_fatura" — pagamento da fatura do cartão de crédito. Em um EXTRATO aparece como "PAGAMENTO CARTAO", "PAGTO FATURA", "DEB AUT CARTAO", "PAGAMENTO DE FATURA". Em uma FATURA aparece como "PAGAMENTO RECEBIDO", "PAGAMENTO EFETUADO", "PGTO DEBITO AUTOMATICO" (normalmente na primeira linha, com sinal de crédito). ISSO NÃO É GASTO: é dinheiro saindo da conta e quitando o cartão. Nunca classifique como gasto.
  · "transferencia_saida" — dinheiro saindo desta conta para OUTRA CONTA DO PRÓPRIO USUÁRIO (transferência entre bancos, PIX para si mesmo, aplicação em conta do mesmo titular em outro banco, "transferência entre contas"). Só use quando a descrição indicar mesmo titular / conta própria / outro banco do usuário. PIX para terceiros é "gasto".
  · "transferencia_entrada" — o mesmo, mas entrando nesta conta vinda de outra conta do próprio usuário.
  · "estorno" — estorno, devolução, cancelamento de compra, crédito de ajuste.
  · "ignorar" — tudo que NÃO é um lançamento: saldo anterior, saldo do dia, saldo final, saldo disponível, limite, total da fatura, subtotais, totais por categoria, cabeçalho, rodapé, número de página, avisos, propaganda, "saldo em conta", "rendimento do dia" quando é só informativo do saldo.
- categoria: escolha EXATAMENTE uma das opções abaixo, compatível com a natureza (para "gasto" use a lista de gasto; "ganho" e "estorno" usam a lista de ganho; "investimento" usa a lista de investimento; para pagamento_fatura e transferências use "").
${categoryList}
- contraparteId: quando a natureza for "pagamento_fatura" ou uma transferência, o id da OUTRA conta cadastrada envolvida (ex: num extrato, o pagamento da fatura do cartão Nubank aponta para o id do cartão Nubank). Se não der para identificar, "".
- parcelaAtual / parcelaTotal: se a linha indicar parcelamento ("03/10", "PARC 3 DE 10"), preencha os dois números; senão 0.
- confianca: 0 a 1.

REGRAS FINAIS:
- Nunca some linhas nem crie um lançamento "total".
- Em uma fatura, a soma dos "gasto" deve bater aproximadamente com o total da fatura menos os pagamentos e estornos.
- Se o documento for um recibo, devolva um único lançamento de natureza "gasto".
- Se não conseguir ler nada, devolva a lista vazia em vez de inventar.`;
  const schema = {
    type: "OBJECT",
    properties: {
      documento: {
        type: "OBJECT",
        properties: {
          tipo: {
            type: "STRING",
            enum: ["extrato", "fatura", "recibo", "outro"]
          },
          banco: {
            type: "STRING"
          },
          contaId: {
            type: "STRING"
          },
          periodoInicio: {
            type: "STRING"
          },
          periodoFim: {
            type: "STRING"
          },
          vencimento: {
            type: "STRING"
          },
          totalDocumento: {
            type: "NUMBER"
          },
          confianca: {
            type: "NUMBER"
          },
          observacao: {
            type: "STRING"
          }
        },
        required: ["tipo", "banco", "contaId", "confianca"]
      },
      lancamentos: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            data: {
              type: "STRING"
            },
            descricao: {
              type: "STRING"
            },
            valor: {
              type: "NUMBER"
            },
            natureza: {
              type: "STRING",
              enum: AI_NATUREZAS
            },
            categoria: {
              type: "STRING"
            },
            contraparteId: {
              type: "STRING"
            },
            parcelaAtual: {
              type: "NUMBER"
            },
            parcelaTotal: {
              type: "NUMBER"
            },
            confianca: {
              type: "NUMBER"
            }
          },
          required: ["data", "descricao", "valor", "natureza"]
        }
      }
    },
    required: ["documento", "lancamentos"]
  };
  const text = await callGemini({
    prompt,
    inlineData: {
      mimeType: mimeType || "application/pdf",
      data: base64
    },
    schema,
    model
  });
  const parsed = JSON.parse(text);
  return {
    documento: parsed.documento || {},
    lancamentos: Array.isArray(parsed.lancamentos) ? parsed.lancamentos : []
  };
}

/* escolhe a conta que o documento representa: a que a IA apontou, se ela existir e for do tipo coerente
   (fatura↔cartão, extrato↔conta); senão a primeira conta cadastrada do tipo certo; senão "" (o usuário escolhe). */
function resolveDocAccount(documento, accounts) {
  const wanted = documento.tipo === "fatura" ? "cartao" : documento.tipo === "extrato" ? "conta" : null;
  const guessed = accounts.find(a => a.id === documento.contaId);
  if (guessed && (!wanted || guessed.kind === wanted)) return {
    id: guessed.id,
    auto: true
  };
  const fallback = wanted ? accounts.find(a => a.kind === wanted) : accounts[0];
  return {
    id: fallback ? fallback.id : "",
    auto: false
  };
}

/* converte a resposta da IA para as linhas da tela de revisão.
   Aqui é onde "pagamento de fatura" e "transferência entre bancos" viram um lançamento de transferência
   com origem e destino — o resto do app já sabe lidar com esse par (não entra em Entradas/Saídas, só move saldo). */
function mapAiDocument({
  documento,
  lancamentos
}, accounts, docId) {
  const docAcct = resolveDocAccount(documento || {}, accounts);
  const isCard = accounts.find(a => a.id === docAcct.id)?.kind === "cartao";
  const rows = [];
  (lancamentos || []).forEach(l => {
    const natureza = AI_NATUREZAS.includes(l.natureza) ? l.natureza : "gasto";
    if (natureza === "ignorar") return;
    const cents = Math.max(0, Math.round((Number(l.valor) || 0) * 100));
    if (cents <= 0) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(l.data || "") ? l.data : todayISO();
    const counterpart = accounts.find(a => a.id === l.contraparteId)?.id || "";
    let desc = String(l.descricao || "").trim();
    const pAt = Math.round(Number(l.parcelaAtual) || 0),
      pTot = Math.round(Number(l.parcelaTotal) || 0);
    if (pAt > 0 && pTot > 1 && !/\d\s*\/\s*\d/.test(desc)) desc += ` (${pAt}/${pTot})`;
    let type,
      category = "",
      acctId = docAcct.id,
      toAcctId = "";
    if (natureza === "pagamento_fatura") {
      type = "transferencia";
      // no extrato da conta, o dinheiro sai da conta e entra no cartão; na fatura, é o contrário
      if (isCard) {
        toAcctId = docAcct.id;
        acctId = counterpart || accounts.find(a => a.kind === "conta")?.id || "";
      } else {
        acctId = docAcct.id;
        toAcctId = counterpart || (accounts.filter(a => a.kind === "cartao").length === 1 ? accounts.find(a => a.kind === "cartao").id : "");
      }
      if (!desc) desc = "Pagamento de fatura";
    } else if (natureza === "transferencia_saida" || natureza === "transferencia_entrada") {
      type = "transferencia";
      if (natureza === "transferencia_saida") {
        acctId = docAcct.id;
        toAcctId = counterpart;
      } else {
        acctId = counterpart;
        toAcctId = docAcct.id;
      }
      if (!desc) desc = "Transferência entre contas";
    } else {
      type = natureza === "estorno" ? "ganho" : natureza;
      const validCats = CATS[type].map(c => c[0]);
      const wanted = String(l.categoria || "").trim().toLowerCase();
      const match = validCats.find(c => c.toLowerCase() === wanted);
      category = natureza === "estorno" ? match || "Reembolso" : match || validCats[validCats.length - 1];
      acctId = docAcct.id;
    }
    rows.push({
      id: uid(),
      docId,
      date,
      desc,
      cents,
      type,
      category,
      acctId,
      toAcctId,
      natureza,
      confidence: typeof l.confianca === "number" ? l.confianca : null,
      selected: true
    });
  });
  const meta = {
    tipo: ["extrato", "fatura", "recibo", "outro"].includes(documento?.tipo) ? documento.tipo : "outro",
    banco: String(documento?.banco || "").trim(),
    contaId: docAcct.id,
    contaAuto: docAcct.auto,
    periodoInicio: /^\d{4}-\d{2}-\d{2}$/.test(documento?.periodoInicio || "") ? documento.periodoInicio : "",
    periodoFim: /^\d{4}-\d{2}-\d{2}$/.test(documento?.periodoFim || "") ? documento.periodoFim : "",
    vencimento: /^\d{4}-\d{2}-\d{2}$/.test(documento?.vencimento || "") ? documento.vencimento : "",
    totalDocumento: Math.max(0, Math.round((Number(documento?.totalDocumento) || 0) * 100)),
    confianca: typeof documento?.confianca === "number" ? documento.confianca : null,
    observacao: String(documento?.observacao || "").trim(),
    fonte: "ia"
  };
  return {
    meta,
    rows
  };
}

/* leitura de fallback, sem IA: usa o pdf.js local + o parser por regex. Só reconhece gasto/ganho —
   é a rede de segurança para quando o /api/gemini não está disponível (offline, cota estourada, deploy sem chave). */
function localRowsFromText(text, docId, accounts) {
  const def = accounts[0]?.id || "";
  return parseExtratoText(text).map(it => ({
    ...it,
    docId,
    acctId: def,
    toAcctId: "",
    natureza: it.type,
    confidence: null,
    selected: true
  }));
}

/* memória de categorização: mapa descrição normalizada → categoria escolhida da última vez, alimentado a
   cada lançamento salvo. Consultada antes de chamar a IA — evita gasto de rede/latência quando a pessoa já
   categorizou essa mesma descrição (ou uma bem parecida) antes. */
function lookupCategoryMemory(memory, description) {
  const norm = (description || "").trim().toLowerCase();
  if (!norm || !memory) return null;
  if (memory[norm]) return memory[norm];
  // variação comum: a descrição atual tem algo a mais (data, número da loja) mas contém uma já conhecida
  const key = Object.keys(memory).filter(k => k.length >= 3).find(k => norm.includes(k));
  return key ? memory[key] : null;
}
/* sugere a categoria (dentro do type já escolhido) a partir da descrição digitada no formulário principal */
async function suggestCategoryWithAI(description, type) {
  const cats = CATS[type].map(c => c[0]);
  const prompt = `Descrição de um lançamento financeiro: "${description}". Tipo: ${TYPES[type].label}.
Qual das categorias abaixo melhor descreve esse lançamento? Responda com o nome exato de uma delas.
Opções: ${cats.join(", ")}`;
  const schema = {
    type: "OBJECT",
    properties: {
      category: {
        type: "STRING",
        enum: cats
      }
    },
    required: ["category"]
  };
  const text = await callGemini({
    prompt,
    schema
  });
  const parsed = JSON.parse(text);
  return cats.includes(parsed.category) ? parsed.category : null;
}

/* detecção puramente local (sem IA) de gastos recorrentes: agrupa por descrição, identifica cadência ~mensal
   e sinaliza candidatos que sumiram há muito tempo ou tiveram o valor mais recente muito fora do padrão */
function detectRecurringCandidates(txs, today) {
  const groups = {};
  txs.filter(t => t.type === "gasto").forEach(t => {
    const key = (t.description.trim() || t.category).toLowerCase();
    (groups[key] = groups[key] || {
      label: t.description.trim() || t.category,
      category: t.category,
      items: []
    }).items.push(t);
  });
  const candidates = [];
  Object.values(groups).forEach(g => {
    if (g.items.length < 2) return;
    const sorted = [...g.items].sort((a, b) => a.date < b.date ? -1 : 1);
    let monthlyGaps = 0;
    for (let i = 1; i < sorted.length; i++) {
      const days = (new Date(sorted[i].date + "T00:00:00") - new Date(sorted[i - 1].date + "T00:00:00")) / 86400000;
      if (days >= 24 && days <= 40) monthlyGaps++;
    }
    if (monthlyGaps < Math.max(1, sorted.length - 2)) return; // não parece ter cadência mensal consistente
    const last = sorted[sorted.length - 1];
    const daysSinceLast = Math.round((today - new Date(last.date + "T00:00:00")) / 86400000);
    const prevAvg = sorted.slice(0, -1).reduce((s, t) => s + t.cents, 0) / Math.max(1, sorted.length - 1);
    const anomalyPct = prevAvg > 0 ? Math.round((last.cents - prevAvg) / prevAvg * 100) : 0;
    if (daysSinceLast >= 45 || Math.abs(anomalyPct) >= 25) {
      candidates.push({
        descricao: g.label,
        categoria: g.category,
        ocorrencias: sorted.length,
        ultimoValor: (last.cents / 100).toFixed(2),
        valorMedioAnterior: (prevAvg / 100).toFixed(2),
        diasDesdeUltimaVez: daysSinceLast,
        variacaoPercentual: anomalyPct
      });
    }
  });
  return candidates;
}

/* extrai o texto de um PDF (extrato bancário), linha a linha, agrupando itens pela posição vertical */
async function extractPdfText(pdf) {
  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = {};
    content.items.forEach(item => {
      const y = Math.round(item.transform[5] / 2) * 2;
      (lines[y] = lines[y] || []).push(item);
    });
    Object.keys(lines).map(Number).sort((a, b) => b - a).forEach(y => {
      const row = lines[y].sort((a, b) => a.transform[4] - b.transform[4]);
      fullText += row.map(i => i.str).join(" ") + "\n";
    });
  }
  return fullText;
}

/* ---- helpers ---- */
const brl = c => (c / 100).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL"
});
const brlNum = c => (c / 100).toLocaleString("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
// preço em horas de trabalho (opcional, configurável em "Mais"): converte um valor pro tempo de trabalho
// que ele equivale, dado o valor da hora configurado. hourlyWageCents=0 (padrão) desliga o recurso inteiro.
const formatHours = (cents, hourlyWageCents) => {
  if (!hourlyWageCents) return null;
  const h = cents / hourlyWageCents;
  return h < 10 ? h.toFixed(1).replace(".", ",") + "h" : Math.round(h) + "h";
};
const abbrevBRL = cents => {
  const v = Math.abs(cents / 100);
  if (v >= 1000000) return (cents < 0 ? "-" : "") + (v / 1000000).toLocaleString("pt-BR", {
    maximumFractionDigits: 1
  }) + " mi";
  if (v >= 1000) return (cents < 0 ? "-" : "") + (v / 1000).toLocaleString("pt-BR", {
    maximumFractionDigits: 1
  }) + " mil";
  return (cents < 0 ? "-" : "") + v.toLocaleString("pt-BR", {
    maximumFractionDigits: 0
  });
};
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const monthKey = d => d.slice(0, 7);
// segunda-feira da semana que contém essa data ISO — usada como chave de "semana" pro recap automático
// (não é o número de semana ISO-8601 oficial, só um agrupamento estável de 7 em 7 dias, mais simples de calcular)
const weekStartISO = iso => {
  const d = new Date(iso + "T00:00:00");
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// tags de primeira classe: extraídas da descrição (#tag), únicas e em minúsculas — usada por chips na
// linha, filtro (Fase 4), visão "gasto por tag" e autocompletar no formulário
const extractTags = description => {
  const m = (description || "").match(/#(\w+)/g);
  return m ? [...new Set(m.map(s => s.slice(1).toLowerCase()))] : [];
};
const fmtDateBR = iso => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
// "julho de 2026" → "Julho de 2026". O CSS text-transform:capitalize maiusculiza TODA palavra e
// devolvia "Julho De 2026"/"Jun. De 26", que em português está errado — só a primeira letra sobe.
const capFirst = t => {
  const s = String(t || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// rótulo curto de mês para gráficos: "jun. de 26" → "jun 26"
const shortMonthLabel = d => d.toLocaleDateString("pt-BR", {
  month: "short",
  year: "2-digit"
}).replace(/\./g, "").replace(" de ", " ");
// soma n meses a uma data ISO, ajustando o dia se o mês de destino for mais curto (ex: 31/01 + 1 mês = 28 ou 29/02)
const addMonthsISO = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const dt = new Date(first.getFullYear(), first.getMonth(), Math.min(d, lastDay));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
// divide um total em n parcelas inteiras (centavos) sem perder nem sobrar 1 centavo no arredondamento
const splitCents = (total, n) => {
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({
    length: n
  }, (_, i) => base + (i < remainder ? 1 : 0));
};
// para gastos em cartão com dia de fechamento/vencimento configurados, devolve o mês da fatura em que o gasto pesa no fluxo de caixa
const txEffectiveMonth = (t, accounts) => {
  if (t.type === "gasto") {
    const acc = accounts.find(a => a.id === t.acctId);
    if (acc && acc.kind === "cartao" && acc.closingDay && acc.dueDay) {
      const d = new Date(t.date + "T00:00:00");
      let y = d.getFullYear(),
        m = d.getMonth();
      if (d.getDate() > acc.closingDay) m += 1;
      if (acc.dueDay <= acc.closingDay) m += 1;
      y += Math.floor(m / 12);
      m = (m % 12 + 12) % 12;
      return `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return monthKey(t.date);
};
// grau de independência financeira: média de proventos ÷ média de gastos totais, nos últimos 6 meses até "view".
// a média divide só pelos meses que realmente têm algum lançamento (não pelos 6 fixos), pra não subestimar
// o indicador logo no começo do uso do app, quando ainda não há 6 meses de histórico.
// recebe o índice único por mês (App) em vez de txs cru — evita re-varrer todo o histórico a cada chamada
const financialIndependence = (monthIndex, view) => {
  let provSum = 0,
    gastoSum = 0,
    monthsWithData = 0;
  for (let i = 0; i < 6; i++) {
    const d = new Date(view.getFullYear(), view.getMonth() - i, 1);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = monthIndex[mk];
    if (b && (b.entradas || b.saidas || b.investido)) {
      provSum += b.proventos;
      gastoSum += b.saidas;
      monthsWithData++;
    }
  }
  const n = monthsWithData || 1;
  const avgProv = provSum / n,
    avgGasto = gastoSum / n;
  const pct = avgGasto > 0 ? avgProv / avgGasto * 100 : avgProv > 0 ? 100 : 0;
  return {
    pct,
    avgProv,
    avgGasto,
    monthsWithData
  };
};
// fatura líquida de um cartão num período: gastos do período menos transferências recebidas por ele no
// mesmo período (pagamento da fatura) — nunca fica negativa; o excedente vira crédito restante.
// "items" já deve vir filtrado para o período certo (ex: flowTx do mês, que respeita txEffectiveMonth).
// previsto não entra: um gasto ou pagamento que ainda não aconteceu não compromete a fatura de verdade ainda.
const cardInvoiceNet = (items, acctId) => {
  const gasto = items.filter(t => t.type === "gasto" && t.acctId === acctId && isRealized(t)).reduce((s, t) => s + t.cents, 0);
  const paid = items.filter(t => t.type === "transferencia" && t.toAcctId === acctId && isRealized(t)).reduce((s, t) => s + t.cents, 0);
  return {
    gasto,
    paid,
    net: Math.max(0, gasto - paid),
    credit: Math.max(0, paid - gasto)
  };
};

/* =======================================================================
   ÍCONES — SVG desenhados à mão, estilo outline geométrico (1.5, currentColor).
   Substituem todo emoji da interface, inclusive nas categorias.
   ======================================================================= */
const ICONS = {
  panorama: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 10 L12 12 L10 14 L12 12 Z"
  })),
  calendario: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "5",
    width: "18",
    height: "16",
    rx: "2"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "10",
    x2: "21",
    y2: "10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "3",
    x2: "8",
    y2: "7"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "16",
    y1: "3",
    x2: "16",
    y2: "7"
  })),
  orcamento: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 12 L12 3 A9 9 0 0 1 19.5 16.5 Z"
  })),
  metas: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "8"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "4.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "1",
    fill: "currentColor",
    stroke: "none"
  })),
  investimentos: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 16 L9 10 L13 13 L20 5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15 5 H20 V10"
  })),
  extrato: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "5",
    y: "3",
    width: "14",
    height: "18",
    rx: "2"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "8",
    x2: "16",
    y2: "8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "12",
    x2: "16",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "16",
    x2: "13",
    y2: "16"
  })),
  assistente: /*#__PURE__*/React.createElement("path", {
    d: "M4 5 H20 V16 H9 L5 19 V16 H4 Z"
  }),
  contas: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 10 L12 4 L21 10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    y1: "10",
    x2: "4",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "10",
    x2: "8",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "10",
    x2: "12",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "16",
    y1: "10",
    x2: "16",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "20",
    y1: "10",
    x2: "20",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "19",
    x2: "21",
    y2: "19"
  })),
  mais: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "7",
    cy: "7",
    r: "1.4",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "17",
    cy: "7",
    r: "1.4",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "7",
    cy: "17",
    r: "1.4",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "17",
    cy: "17",
    r: "1.4",
    fill: "currentColor",
    stroke: "none"
  })),
  sol: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "4"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "2",
    x2: "12",
    y2: "4"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "20",
    x2: "12",
    y2: "22"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "2",
    y1: "12",
    x2: "4",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "20",
    y1: "12",
    x2: "22",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4.9",
    y1: "4.9",
    x2: "6.3",
    y2: "6.3"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "17.7",
    y1: "17.7",
    x2: "19.1",
    y2: "19.1"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4.9",
    y1: "19.1",
    x2: "6.3",
    y2: "17.7"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "17.7",
    y1: "6.3",
    x2: "19.1",
    y2: "4.9"
  })),
  lua: /*#__PURE__*/React.createElement("path", {
    d: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
  }),
  "seta-esquerda": /*#__PURE__*/React.createElement("path", {
    d: "M15 6 L9 12 L15 18"
  }),
  "seta-direita": /*#__PURE__*/React.createElement("path", {
    d: "M9 6 L15 12 L9 18"
  }),
  "chevron-baixo": /*#__PURE__*/React.createElement("path", {
    d: "M6 9 L12 15 L18 9"
  }),
  fechar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "6",
    y1: "6",
    x2: "18",
    y2: "18"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "18",
    y1: "6",
    x2: "6",
    y2: "18"
  })),
  editar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 20 L4 16.5 L15.5 5 A2 2 0 0 1 18.5 8 L7 19.5 Z"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "13.5",
    y1: "6.5",
    x2: "17",
    y2: "10"
  })),
  excluir: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 7 H20"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 7 V4.5 H15 V7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M6 7 L7 20 H17 L18 7"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "10",
    y1: "11",
    x2: "10",
    y2: "16"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "14",
    y1: "11",
    x2: "14",
    y2: "16"
  })),
  adicionar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "5",
    x2: "12",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "5",
    y1: "12",
    x2: "19",
    y2: "12"
  })),
  check: /*#__PURE__*/React.createElement("path", {
    d: "M5 12.5 L10 17.5 L19 7"
  }),
  alerta: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 3 L22 20 H2 Z"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "9",
    x2: "12",
    y2: "14"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "17",
    r: "0.8",
    fill: "currentColor",
    stroke: "none"
  })),
  baixar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "3",
    x2: "12",
    y2: "15"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 10 L12 15 L17 10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    y1: "20",
    x2: "20",
    y2: "20"
  })),
  enviar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "21",
    x2: "12",
    y2: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 14 L12 9 L17 14"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    y1: "4",
    x2: "20",
    y2: "4"
  })),
  camera: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 8 H8 L9.5 5.5 H14.5 L16 8 H20 V19 H4 Z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "13.5",
    r: "3.5"
  })),
  documento: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "3",
    width: "12",
    height: "18",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "8",
    x2: "15",
    y2: "8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "12",
    x2: "15",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "16",
    x2: "13",
    y2: "16"
  })),
  cartao: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "6",
    width: "18",
    height: "13",
    rx: "2"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "10.5",
    x2: "21",
    y2: "10.5"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "6",
    y1: "15",
    x2: "10",
    y2: "15"
  })),
  banco: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 10 L12 4 L21 10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    y1: "10",
    x2: "4",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "10",
    x2: "8",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "10",
    x2: "12",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "16",
    y1: "10",
    x2: "16",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "20",
    y1: "10",
    x2: "20",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "19",
    x2: "21",
    y2: "19"
  })),
  filtro: /*#__PURE__*/React.createElement("path", {
    d: "M4 5 H20 L14 12.5 V18 L10 20 V12.5 Z"
  }),
  buscar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "10",
    cy: "10",
    r: "6.5"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "15",
    y1: "15",
    x2: "20",
    y2: "20"
  })),
  config: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 3 V6 M12 18 V21 M3 12 H6 M18 12 H21 M5.6 5.6 L7.8 7.8 M16.2 16.2 L18.4 18.4 M18.4 5.6 L16.2 7.8 M7.8 16.2 L5.6 18.4"
  })),
  ajuda: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9.2 9.5 C9.2 7.8 10.5 6.7 12 6.7 C13.5 6.7 14.8 7.6 14.8 9.1 C14.8 10.9 12.9 11.2 12.3 12.3 C12.1 12.7 12 13.1 12 13.6"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "16.6",
    r: "0.9",
    fill: "currentColor",
    stroke: "none"
  })),
  sair: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M10 4 H5 V20 H10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "21",
    y1: "12",
    x2: "11",
    y2: "12"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M17 8 L21 12 L17 16"
  })),
  brilho: /*#__PURE__*/React.createElement("path", {
    d: "M12 3 L13.4 9.5 L20 11 L13.4 12.5 L12 19 L10.6 12.5 L4 11 L10.6 9.5 Z"
  }),
  transferencia: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 8 H17"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13.5 4.5 L17 8 L13.5 11.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 16 H7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10.5 12.5 L7 16 L10.5 19.5"
  })),
  olho: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M2 12 C5 6 9 4 12 4 C15 4 19 6 22 12 C19 18 15 20 12 20 C9 20 5 18 2 12 Z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  })),
  "olho-fechado": /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M2 12 C5 6 9 4 12 4 C15 4 19 6 22 12 C19 18 15 20 12 20 C9 20 5 18 2 12 Z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "3",
    x2: "21",
    y2: "21"
  })),
  escudo: /*#__PURE__*/React.createElement("path", {
    d: "M12 3 L20 6 V11 C20 16 16.5 19.5 12 21 C7.5 19.5 4 16 4 11 V6 Z"
  }),
  // categorias
  alimentacao: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "6",
    y1: "2",
    x2: "6",
    y2: "10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4.5",
    y1: "2",
    x2: "4.5",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "7.5",
    y1: "2",
    x2: "7.5",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "6",
    y1: "10",
    x2: "6",
    y2: "22"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M17 2 C15 4 15 8 17 10 V22"
  })),
  transporte: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 16 L5.5 10 H18.5 L20 16"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "16",
    width: "18",
    height: "4",
    rx: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "7.5",
    cy: "20",
    r: "1.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "16.5",
    cy: "20",
    r: "1.5"
  })),
  moradia: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 11 L12 4 L20 11"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M6 10 V20 H18 V10"
  })),
  "contas-cat": /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "3",
    width: "12",
    height: "18",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "8",
    x2: "15",
    y2: "8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "12",
    x2: "15",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "16",
    x2: "13",
    y2: "16"
  })),
  saude: /*#__PURE__*/React.createElement("path", {
    d: "M12 20 C4 14 3 9 6.5 6.5 C9 4.7 12 6 12 9 C12 6 15 4.7 17.5 6.5 C21 9 20 14 12 20 Z"
  }),
  lazer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10 8.5 L16 12 L10 15.5 Z"
  })),
  compras: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 8 H18 L17 20 H7 Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 8 V6 A3 3 0 0 1 15 6 V8"
  })),
  educacao: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 6 C10 4.5 6 4 4 4.5 V18 C6 17.5 10 18 12 19.5 C14 18 18 17.5 20 18 V4.5 C18 4 14 4.5 12 6 Z"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "6",
    x2: "12",
    y2: "19.5"
  })),
  assinaturas: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 12 A8 8 0 0 1 12 4 H17"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15 2 L17 4 L15 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 12 A8 8 0 0 1 12 20 H7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 18 L7 20 L9 22"
  })),
  pets: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "8",
    cy: "9",
    r: "1.6"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "7",
    r: "1.6"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "16",
    cy: "9",
    r: "1.6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 13 C6 13 5 15 6 17 C7 19 10 19.5 12 18 C14 19.5 17 19 18 17 C19 15 18 13 16 13 C14 13 13 14.5 12 14.5 C11 14.5 10 13 8 13 Z"
  })),
  outros: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "6",
    cy: "12",
    r: "1.5",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "1.5",
    fill: "currentColor",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "18",
    cy: "12",
    r: "1.5",
    fill: "currentColor",
    stroke: "none"
  })),
  salario: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "8",
    width: "18",
    height: "12",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 8 V6 A2 2 0 0 1 10 4 H14 A2 2 0 0 1 16 6 V8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "13",
    x2: "21",
    y2: "13"
  })),
  freelance: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "5",
    width: "16",
    height: "10",
    rx: "1"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2 19 L4 15 H20 L22 19 Z"
  })),
  presente: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "9",
    width: "16",
    height: "11",
    rx: "1"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    y1: "13",
    x2: "20",
    y2: "13"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "9",
    x2: "12",
    y2: "20"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9 C9 9 8 6 10 5 C12 4 12 7 12 9 Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9 C15 9 16 6 14 5 C12 4 12 7 12 9 Z"
  })),
  reembolso: /*#__PURE__*/React.createElement("path", {
    d: "M4 11 H15 A5 5 0 0 1 15 21 H13 M4 11 L7.5 8 M4 11 L7.5 14"
  }),
  rendimento: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 16 L9 10 L13 13 L20 5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15 5 H20 V10"
  })),
  proventos: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "9",
    r: "5.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "15",
    cy: "15",
    r: "5.5"
  })),
  acoes: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "5",
    y1: "20",
    x2: "5",
    y2: "13"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "10",
    y1: "20",
    x2: "10",
    y2: "8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "15",
    y1: "20",
    x2: "15",
    y2: "11"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "20",
    y1: "20",
    x2: "20",
    y2: "5"
  })),
  rendafixa: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 10 L12 4 L21 10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    y1: "10",
    x2: "4",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "10",
    x2: "8",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "10",
    x2: "12",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "16",
    y1: "10",
    x2: "16",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "20",
    y1: "10",
    x2: "20",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "19",
    x2: "21",
    y2: "19"
  })),
  fundos: /*#__PURE__*/React.createElement("path", {
    d: "M3 7 H9 L11 9 H21 V19 H3 Z"
  }),
  cripto: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "8",
    x2: "12",
    y2: "16"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9.5 10 H13 A1.5 1.5 0 0 1 13 13 H9.5 M9.5 13 H13.5"
  })),
  tesouro: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "6",
    y1: "3",
    x2: "6",
    y2: "21"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M6 4 H18 L15 8 L18 12 H6"
  })),
  previdencia: /*#__PURE__*/React.createElement("path", {
    d: "M12 3 L20 6 V11 C20 16 16.5 19.5 12 21 C7.5 19.5 4 16 4 11 V6 Z"
  })
};
function Icon({
  name,
  size = 20,
  className = "",
  ...rest
}) {
  const p = ICONS[name];
  if (!p) return null;
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "icon " + className,
    "aria-hidden": "true",
    ...rest
  }, p);
}
function BrandMark({
  size = 22
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--accent)",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "4",
    x2: "12",
    y2: "20"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "5",
    y1: "8",
    x2: "12",
    y2: "8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "15",
    x2: "20",
    y2: "15"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "5",
    cy: "11",
    r: "2.4",
    strokeWidth: "1.6"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "20",
    cy: "18",
    r: "2.4",
    strokeWidth: "1.6"
  }));
}
const SEED = {
  schemaVersion: 4,
  theme: "dark",
  transactions: [],
  accounts: [{
    id: "a1",
    name: "Conta principal",
    kind: "conta",
    color: "#3B63C4"
  }, {
    id: "c1",
    name: "Cartão de crédito",
    kind: "cartao",
    color: "#A57BE0"
  }],
  budgets: {},
  budgetExceptions: {},
  goals: [],
  holdings: [],
  categoryMemory: {},
  patrimonyHistory: {},
  recaps: {
    weekly: {},
    monthly: {}
  },
  settings: {
    hourlyWageCents: 0,
    aiModel: "rapido"
  }
};
const SCHEMA_VERSION = 4;
/* migrate() é idempotente: leva qualquer versão anterior (inclusive dados sem o campo schemaVersion,
   como um backup .json exportado antes desta mudança) até a atual. Nenhum campo existente é renomeado
   ou removido — só acrescentado, com um padrão seguro, só onde ainda não existir. Rodar duas vezes
   sobre o mesmo dado não muda nada (é seguro chamar tanto no carregamento quanto na importação). */
function migrate(data) {
  const d = {
    ...SEED,
    ...data
  };
  // 2.3 — previsto × realizado: lançamentos antigos, sem o campo, sempre foram tratados como já ocorridos
  d.transactions = (d.transactions || []).map(t => ({
    status: "realizado",
    ...t
  }));
  // 2.2 — saldo inicial por conta
  d.accounts = (d.accounts || []).map(a => ({
    openingBalance: 0,
    openingDate: "",
    ...a
  }));
  // 3.0 — memória de categorização, histórico de patrimônio e recaps automáticos (Fase 5)
  d.categoryMemory = d.categoryMemory || {};
  d.patrimonyHistory = d.patrimonyHistory || {};
  d.recaps = {
    weekly: {},
    monthly: {},
    ...(d.recaps || {})
  };
  // 3.0 — meta pode opcionalmente ser ligada a uma categoria real, contando lançamentos daquela categoria
  d.goals = (d.goals || []).map(g => ({
    linkedCategory: null,
    ...g
  }));
  // 4.0 — preço em horas de trabalho (opcional): 0 = recurso desligado, não aparece em lugar nenhum
  // 4.1 — escolha do motor de IA usada na leitura de documentos ("rapido" | "cuidadoso")
  d.settings = {
    hourlyWageCents: 0,
    aiModel: "rapido",
    ...(d.settings || {})
  };
  if (!AI_MODELS[d.settings.aiModel]) d.settings.aiModel = "rapido";
  d.schemaVersion = SCHEMA_VERSION;
  return d;
}

/* ---- persistência ----
   loadData nunca cai silenciosamente em SEED por falha: falha de rede ou JSON corrompido
   sempre lança, para o chamador (App) mostrar uma tela de erro em vez de sobrescrever dados reais. */
async function loadData(userId) {
  if (sb && userId) {
    const {
      data,
      error
    } = await sb.from("finance_data").select("data,updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (data && data.data) return {
      data: migrate(data.data),
      updatedAt: data.updated_at
    };
    const nowIso = new Date().toISOString();
    const {
      error: insErr
    } = await sb.from("finance_data").insert({
      user_id: userId,
      data: SEED,
      updated_at: nowIso
    });
    if (insErr) throw insErr;
    return {
      data: SEED,
      updatedAt: nowIso
    };
  }
  const raw = localStorage.getItem("razao");
  if (!raw) return {
    data: SEED,
    updatedAt: null
  };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error("Os dados salvos neste aparelho estão corrompidos e não puderam ser lidos: " + e.message);
  }
  return {
    data: migrate(parsed),
    updatedAt: null
  };
}
// compara dois timestamps pelo instante real (epoch), não pela string: o Postgres/PostgREST costuma
// devolver o mesmo instante num formato de texto diferente do que enviamos (ex: "+00:00" em vez de "Z"),
// então comparar string com "!==" gera falso conflito a cada gravação.
const sameInstant = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a),
    tb = Date.parse(b);
  return !isNaN(ta) && !isNaN(tb) && ta === tb;
};
/* saveData verifica conflito (updated_at mais novo no servidor do que o esperado) antes de gravar,
   a menos que force=true. Lança em qualquer falha real, para o chamador tratar/tentar de novo. */
async function saveData(userId, data, expectedUpdatedAt, force) {
  if (sb && userId) {
    if (expectedUpdatedAt && !force) {
      const {
        data: row,
        error: checkErr
      } = await sb.from("finance_data").select("updated_at").eq("user_id", userId).maybeSingle();
      if (checkErr) throw checkErr;
      if (row && row.updated_at && !sameInstant(row.updated_at, expectedUpdatedAt)) {
        return {
          conflict: true
        };
      }
    }
    const nowIso = new Date().toISOString();
    // pede de volta o updated_at tal como o Postgres o armazenou, para as próximas comparações
    // partirem do mesmo formato (evita o falso conflito descrito acima já na origem)
    const {
      data: saved,
      error
    } = await sb.from("finance_data").upsert({
      user_id: userId,
      data,
      updated_at: nowIso
    }).select("updated_at").maybeSingle();
    if (error) throw error;
    return {
      conflict: false,
      updatedAt: saved && saved.updated_at || nowIso
    };
  }
  localStorage.setItem("razao", JSON.stringify(data));
  return {
    conflict: false,
    updatedAt: null
  };
}
/* checagem leve, só do carimbo de tempo — usada ao voltar o foco na aba, sem baixar os dados inteiros */
async function fetchServerUpdatedAt(userId) {
  if (!sb || !userId) return null;
  const {
    data,
    error
  } = await sb.from("finance_data").select("updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? data.updated_at : null;
}

/* ---- referência ---- */
const TYPES = {
  gasto: {
    label: "Gasto",
    cls: "out",
    sign: -1
  },
  ganho: {
    label: "Ganho",
    cls: "in",
    sign: +1
  },
  investimento: {
    label: "Investimento",
    cls: "inv",
    sign: -1
  },
  transferencia: {
    label: "Transferência",
    cls: "trf",
    sign: 0
  } // não soma em Entradas/Saídas/Investido; afeta só o saldo por conta (lançamento em par)
};
// previsto × realizado: sem o campo (dado pré-migração) sempre foi tratado como já ocorrido.
// totais, históricos e gráficos usam só o realizado; a lista mostra os dois, o previsto atenuado.
const isRealized = t => (t.status || "realizado") !== "previsto";
const CATS = {
  gasto: [["Alimentação", "alimentacao"], ["Transporte", "transporte"], ["Moradia", "moradia"], ["Contas", "contas-cat"], ["Saúde", "saude"], ["Lazer", "lazer"], ["Compras", "compras"], ["Educação", "educacao"], ["Assinaturas", "assinaturas"], ["Pets", "pets"], ["Outros", "outros"]],
  ganho: [["Salário", "salario"], ["Freelance", "freelance"], ["Presente", "presente"], ["Reembolso", "reembolso"], ["Rendimento", "rendimento"], ["Proventos", "proventos"], ["Outros", "outros"]],
  investimento: [["Ações", "acoes"], ["Renda Fixa", "rendafixa"], ["Fundos", "fundos"], ["Cripto", "cripto"], ["Tesouro", "tesouro"], ["Previdência", "previdencia"], ["Outros", "outros"]]
};
const CAT_ICON = Object.fromEntries(Object.values(CATS).flat().map(([n, ic]) => [n, ic]));
const CLASSES = ["Renda Fixa", "Renda Variável", "Fundos", "Cripto", "Tesouro", "Previdência", "Outros"];
// paleta qualitativa (nunca usa o acento para valor semântico de entrada/saída/investimento — só para identidade de categoria)
const QUALITATIVE = ["#F76B3C", "#5A8DEE", "#2FB98A", "#E8B23C", "#A57BE0", "#E2564D", "#46B7C7", "#8C93A8"];
// cor fixa por categoria (não muda quando a lista é reordenada por valor)
const CAT_COLOR = Object.fromEntries([...new Set(Object.values(CATS).flat().map(c => c[0]))].map((n, i) => [n, QUALITATIVE[i % QUALITATIVE.length]]));
const CLASS_COLOR = Object.fromEntries(CLASSES.map((n, i) => [n, QUALITATIVE[i % QUALITATIVE.length]]));
const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const TAB_GROUPS = [{
  label: "Principal",
  items: [["geral", "Panorama", "panorama"], ["balanco", "Balanço", "calendario"], ["extrato", "Importar do banco", "extrato"]]
}, {
  label: "Planejamento",
  items: [["orcamento", "Orçamento", "orcamento"], ["metas", "Metas", "metas"], ["investimentos", "Investimentos", "investimentos"]]
}, {
  label: "Ferramentas",
  items: [["perguntar", "Assistente", "assistente"]]
}, {
  label: "Configurações",
  items: [["contas", "Contas", "contas"]]
}, {
  label: "Suporte",
  items: [["ajuda", "Ajuda", "ajuda"]]
}];
const MORE_TABS = TAB_GROUPS.flatMap(g => g.items).filter(([k]) => !["geral", "balanco", "orcamento"].includes(k));

/* hook simples de breakpoint: só usado onde o comportamento (não só o visual) muda entre mobile e desktop */
function useIsDesktop() {
  const [d, setD] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width:1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width:1024px)");
    const fn = () => setD(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return d;
}

/* ---- toasts (substitui alert()) ---- */
let toastListener = null;
function toast(message, tone = "default", opts) {
  toastListener && toastListener({
    id: uid(),
    message,
    tone,
    action: opts && opts.action,
    duration: opts && opts.duration || 4000
  });
}
function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    toastListener = t => {
      setItems(arr => [...arr, t]);
      setTimeout(() => setItems(arr => arr.filter(x => x.id !== t.id)), t.duration);
    };
    return () => {
      toastListener = null;
    };
  }, []);
  if (items.length === 0) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "toasthost"
  }, items.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    className: "toast " + t.tone
  }, /*#__PURE__*/React.createElement(Icon, {
    name: t.tone === "error" ? "alerta" : t.tone === "success" ? "check" : "brilho",
    size: 16
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, t.message), t.action && /*#__PURE__*/React.createElement("button", {
    className: "toastaction",
    onClick: () => {
      t.action.onClick();
      setItems(arr => arr.filter(x => x.id !== t.id));
    }
  }, t.action.label))));
}

/* ---- bottom sheet / modal genérico: forms, menus e diálogo de confirmação ---- */
function Sheet({
  open,
  onClose,
  title,
  children,
  returnFocusRef
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = e => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      ref.current?.querySelector("input,button,select,textarea")?.focus();
    }, 50);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      if (returnFocusRef && returnFocusRef.current) returnFocusRef.current.focus();
    };
  }, [open]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "sheetbackdrop",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet",
    ref: ref,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title || "Diálogo",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheethandle"
  }), title && /*#__PURE__*/React.createElement("div", {
    className: "sheettitle"
  }, title, /*#__PURE__*/React.createElement("button", {
    className: "sheetclose",
    "aria-label": "Fechar",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "fechar",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: "sheetbody"
  }, children)));
}

/* ---- ajuda contextual: qualquer componente pode pedir pra abrir o manual numa seção específica sem
   precisar receber setTab/estado de navegação por prop — mesmo padrão pub-sub do toast/confirm ---- */
let helpListener = null;
function openHelp(sectionId) {
  helpListener && helpListener(sectionId);
}
// mesmo padrão do openHelp: deixa qualquer cartão mandar a pessoa para a aba certa (ex: o estado
// vazio do Balanço oferecendo a importação do banco como caminho rápido). O segundo argumento
// (opcional) carrega um filtro pra aplicar assim que a aba de destino abrir — é o que permite
// clicar numa categoria/tag no Panorama e já chegar no Balanço com a lista filtrada.
let tabListener = null;
function goToTab(tab, filter) {
  tabListener && tabListener(tab, filter);
}

/* ---- diálogo de confirmação (substitui confirm()/exclusões silenciosas) ---- */
let confirmListener = null;
function askConfirm(opts) {
  confirmListener && confirmListener(opts);
}
function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    confirmListener = setState;
    return () => {
      confirmListener = null;
    };
  }, []);
  const close = () => setState(null);
  return /*#__PURE__*/React.createElement(Sheet, {
    open: !!state,
    onClose: close,
    title: state ? state.title : ""
  }, state && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: "var(--text-mut)",
      lineHeight: 1.5,
      marginBottom: 20
    }
  }, state.message), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: close
  }, "Cancelar"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn danger",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: () => {
      state.onConfirm();
      close();
    }
  }, state.confirmLabel || "Excluir"))));
}

// ids afetados por uma escolha de escopo numa série (recorrência/parcelamento): só este / este e os
// próximos (pelo índice na série) / todos. Sem seriesId, só o próprio item conta.
function seriesScopeIds(t, txs, choice) {
  if (!t.seriesId || choice === "only") return [t.id];
  if (choice === "future") return txs.filter(x => x.seriesId === t.seriesId && x.seriesIndex >= t.seriesIndex).map(x => x.id);
  if (choice === "all") return txs.filter(x => x.seriesId === t.seriesId).map(x => x.id);
  return [t.id];
}
let seriesScopeListener = null;
function askSeriesScope(opts) {
  seriesScopeListener && seriesScopeListener(opts);
} // opts: {tx, txs, action:"editar"|"excluir", onChoice(ids)}
function SeriesScopeHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    seriesScopeListener = setState;
    return () => {
      seriesScopeListener = null;
    };
  }, []);
  const close = () => setState(null);
  function choose(choice) {
    if (!state) return;
    state.onChoice(seriesScopeIds(state.tx, state.txs, choice), choice);
    close();
  }
  return /*#__PURE__*/React.createElement(Sheet, {
    open: !!state,
    onClose: close,
    title: state ? `${state.action === "excluir" ? "Excluir" : "Editar"} lançamento recorrente` : ""
  }, state && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: "var(--text-mut)",
      lineHeight: 1.5,
      marginBottom: 16
    }
  }, "Este lançamento faz parte de uma série (", state.tx.seriesIndex + 1, "/", state.tx.seriesTotal, "). O que você quer ", state.action, "?"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    style: {
      justifyContent: "center"
    },
    onClick: () => choose("only")
  }, "Só este"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    style: {
      justifyContent: "center"
    },
    onClick: () => choose("future")
  }, "Este e os próximos"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn danger",
    style: {
      justifyContent: "center"
    },
    onClick: () => choose("all")
  }, "Todos"))));
}

/* ---- skeletons / estado vazio ---- */
function Skeleton({
  w = "100%",
  h = 14,
  r = 8,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "skel",
    style: {
      width: w,
      height: h,
      borderRadius: r,
      ...style
    }
  });
}
function SkeletonScreen() {
  return /*#__PURE__*/React.createElement("div", {
    className: "rz dark"
  }, /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "topbar-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brandmark"
  }, /*#__PURE__*/React.createElement(BrandMark, null), /*#__PURE__*/React.createElement("div", {
    className: "brandtext"
  }, /*#__PURE__*/React.createElement(Skeleton, {
    w: 64,
    h: 16
  }))), /*#__PURE__*/React.createElement(Skeleton, {
    w: 140,
    h: 34,
    r: 999,
    style: {
      margin: "0 auto"
    }
  }), /*#__PURE__*/React.createElement(Skeleton, {
    w: 38,
    h: 38,
    r: 11
  }))), /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sidebar",
    style: {
      display: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "tabcontent"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement(Skeleton, {
    w: 120,
    h: 11
  }), /*#__PURE__*/React.createElement(Skeleton, {
    w: 220,
    h: 38,
    style: {
      margin: "10px 0 16px"
    }
  }), /*#__PURE__*/React.createElement(Skeleton, {
    w: "100%",
    h: 48,
    r: 12
  })), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement(Skeleton, {
    w: "50%",
    h: 13
  }), /*#__PURE__*/React.createElement(Skeleton, {
    w: "100%",
    h: 90,
    style: {
      marginTop: 14
    },
    r: 12
  })), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement(Skeleton, {
    w: "50%",
    h: 13
  }), /*#__PURE__*/React.createElement(Skeleton, {
    w: "100%",
    h: 90,
    style: {
      marginTop: 14
    },
    r: 12
  }))))));
}
function LoadErrorScreen({
  message,
  onRetry,
  onSignOut
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "rz dark"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap",
    style: {
      maxWidth: 460,
      paddingTop: 110,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "bigicon",
    style: {
      display: "flex",
      justifyContent: "center",
      marginBottom: 16,
      color: "var(--neg)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alerta",
    size: 40
  })), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "'Sora',sans-serif",
      fontSize: 20,
      marginBottom: 8
    }
  }, "Não foi possível carregar seus dados"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: "var(--text-mut)",
      fontSize: 14,
      marginBottom: 10,
      lineHeight: 1.5
    }
  }, "Isso costuma ser uma falha de conexão temporária. Seus dados salvos não foram apagados — tentar de novo deve resolver."), /*#__PURE__*/React.createElement("p", {
    className: "mono",
    style: {
      fontSize: 11,
      color: "var(--text-mut)",
      opacity: .7,
      marginBottom: 24,
      wordBreak: "break-word"
    }
  }, message), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    onClick: onRetry
  }, "Tentar de novo"), onSignOut && /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: onSignOut
  }, "Sair da conta"))));
}
function ConflictDialog({
  open,
  message,
  onReload,
  onKeep,
  onClose
}) {
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: onClose,
    title: "Dados alterados em outro dispositivo"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: "var(--text-mut)",
      lineHeight: 1.5,
      marginBottom: 20
    }
  }, message || "Seus dados foram alterados em outro dispositivo. Para não perder nada, escolha uma opção:"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    style: {
      justifyContent: "center"
    },
    onClick: onReload
  }, "Recarregar (descarta o que está na tela)"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn danger",
    style: {
      justifyContent: "center"
    },
    onClick: onKeep
  }, "Manter o desta tela (grava por cima)")));
}
function EmptyState({
  icon,
  title,
  text,
  action,
  secondary
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bigicon"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 40
  })), /*#__PURE__*/React.createElement("h4", null, title), /*#__PURE__*/React.createElement("p", null, text), (action || secondary) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      justifyContent: "center",
      flexWrap: "wrap",
      marginTop: 14
    }
  }, action && /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    onClick: action.onClick
  }, action.icon && /*#__PURE__*/React.createElement(Icon, {
    name: action.icon,
    size: 14
  }), action.label), secondary && /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: secondary.onClick
  }, secondary.label)));
}

/* ---- barra de progresso: excedente em hachura + marcador no ponto de 100% ---- */
function ProgressBar({
  spent,
  limit,
  status
}) {
  if (!(limit > 0)) return null;
  const color = status === "over" ? "var(--neg)" : status === "warn" ? "var(--warn)" : "var(--pos)";
  if (spent <= limit) {
    const pct = Math.min(100, spent / limit * 100);
    return /*#__PURE__*/React.createElement("div", {
      className: "bar"
    }, /*#__PURE__*/React.createElement("i", {
      style: {
        width: pct + "%",
        background: color
      }
    }));
  }
  const markerPct = limit / spent * 100;
  return /*#__PURE__*/React.createElement("div", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: markerPct + "%",
      background: "var(--pos)"
    }
  }), /*#__PURE__*/React.createElement("i", {
    className: "bar-excess",
    style: {
      left: markerPct + "%",
      width: 100 - markerPct + "%"
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "bar-marker",
    style: {
      left: markerPct + "%"
    }
  }));
}

/* ---- componentes de gráfico (SVG/CSS, sem dependências) ---- */
function Donut({
  data,
  size = 160,
  thickness = 22,
  onSelect,
  selected,
  centerLabel
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2,
    c = 2 * Math.PI * r,
    cx = size / 2;
  let acc = 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "donutwrap",
    style: {
      width: size,
      height: size
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`
  }, /*#__PURE__*/React.createElement("g", {
    transform: `rotate(-90 ${cx} ${cx})`
  }, data.map((d, i) => {
    const frac = d.value / total,
      dash = frac * c;
    const dim = selected && selected !== d.name;
    const el = /*#__PURE__*/React.createElement("circle", {
      key: i,
      cx: cx,
      cy: cx,
      r: r,
      fill: "none",
      stroke: d.color,
      strokeWidth: thickness,
      strokeLinecap: "round",
      strokeDasharray: `${Math.max(0, dash - 2)} ${c - dash + 2}`,
      strokeDashoffset: -acc * c,
      style: {
        opacity: dim ? .28 : 1,
        cursor: onSelect ? "pointer" : "default",
        transition: "opacity .15s"
      },
      onClick: onSelect ? () => onSelect(d.name) : undefined
    }, /*#__PURE__*/React.createElement("title", null, d.name, ": ", brl(d.value), " (", (frac * 100).toFixed(0), "%)"));
    acc += frac;
    return el;
  }))), /*#__PURE__*/React.createElement("div", {
    className: "donutcenter"
  }, /*#__PURE__*/React.createElement("b", {
    className: "num"
  }, brlNum(total)), /*#__PURE__*/React.createElement("span", null, centerLabel || "total")));
}
function BarGroups({
  data,
  onSelect,
  activeIndex
}) {
  const [mounted, setMounted] = useState(false);
  const [tip, setTip] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);
  const max = Math.max(...data.flatMap(g => g.bars.map(b => b.v)), 1);
  const gridFracs = [1, 0.5];
  return /*#__PURE__*/React.createElement("div", {
    className: "chartwrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bargroups"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chartgrid",
    style: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none"
    }
  }, gridFracs.map(f => /*#__PURE__*/React.createElement("div", {
    className: "gridline",
    key: f,
    style: {
      bottom: f * 100 + "%"
    }
  }, /*#__PURE__*/React.createElement("span", null, abbrevBRL(Math.round(max * f * 100)))))), data.map((g, i) => {
    const dim = activeIndex != null && activeIndex !== i;
    return /*#__PURE__*/React.createElement("div", {
      className: "grp" + (onSelect ? " grp-clickable" : "") + (activeIndex === i ? " grp-active" : ""),
      key: i,
      onClick: onSelect ? () => onSelect(i) : undefined
    }, /*#__PURE__*/React.createElement("div", {
      className: "bset"
    }, g.bars.map((b, j) => /*#__PURE__*/React.createElement("div", {
      key: j,
      className: "b",
      style: {
        height: mounted ? b.v / max * 100 + "%" : "0%",
        background: b.color,
        opacity: dim ? .35 : 1,
        transitionDelay: i * 30 + j * 15 + "ms"
      },
      onMouseEnter: e => setTip({
        x: e.clientX,
        y: e.clientY,
        name: g.name,
        value: b.v
      }),
      onMouseMove: e => setTip(t => t && {
        ...t,
        x: e.clientX,
        y: e.clientY
      }),
      onMouseLeave: () => setTip(null)
    }))), /*#__PURE__*/React.createElement("div", {
      className: "lbl"
    }, g.name));
  })), tip && /*#__PURE__*/React.createElement("div", {
    className: "charttip",
    style: {
      left: tip.x + 12,
      top: tip.y - 36
    }
  }, tip.name, ": ", brl(Math.round(tip.value * 100))));
}
function Legend({
  data,
  onSelect,
  selected
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return /*#__PURE__*/React.createElement("div", {
    className: "legend"
  }, data.map(d => {
    const dim = selected && selected !== d.name;
    const pct = (d.value / total * 100).toFixed(0);
    return /*#__PURE__*/React.createElement("div", {
      className: "li" + (onSelect ? " li-clickable" : ""),
      key: d.name,
      style: {
        opacity: dim ? .45 : 1
      },
      onClick: onSelect ? () => onSelect(d.name) : undefined
    }, /*#__PURE__*/React.createElement("i", {
      style: {
        background: d.color
      }
    }), /*#__PURE__*/React.createElement("span", null, d.name), /*#__PURE__*/React.createElement("span", {
      className: "lv"
    }, brl(d.value), " ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-mut)"
      }
    }, pct, "%")));
  }));
}

/* dados do "fluxo do mês": as entradas se dividindo em gastos por categoria, investimento e sobra — a
   mesma informação de "Gastos por categoria", só lida de ponta a ponta em vez de fatia isolada. Sobra
   negativa (gastou mais do que entrou) não vira nó do fluxo — largura de faixa não pode ser negativa —,
   fica de fora do desenho e é avisada à parte, pra a geometria nunca quebrar. */
function buildMonthFlow(totals, byCatChart) {
  if (!totals || totals.inc <= 0) return null;
  const CAP = 5; // categorias de sobra viram "Outros gastos" — mantém o desenho legível (Fase de design: teto de série)
  const nodes = byCatChart.slice(0, CAP).map(c => ({
    name: c.name,
    value: c.value,
    color: c.color
  }));
  const restValue = byCatChart.slice(CAP).reduce((s, c) => s + c.value, 0);
  if (restValue > 0) nodes.push({
    name: "Outros gastos",
    value: restValue,
    color: "var(--text-mut)"
  });
  if (totals.inv > 0) nodes.push({
    name: "Investido",
    value: totals.inv,
    color: "var(--inv)"
  });
  if (totals.saldo > 0) nodes.push({
    name: "Sobrou",
    value: totals.saldo,
    color: "var(--pos)"
  });
  const shown = nodes.reduce((s, n) => s + n.value, 0);
  if (shown <= 0) return null;
  return {
    inc: totals.inc,
    nodes,
    deficit: totals.saldo < 0 ? -totals.saldo : 0,
    shown
  };
}

/* diagrama de fluxo do mês: as entradas à esquerda, categorias de gasto + investido + sobra à direita,
   ligadas por faixas cuja espessura é proporcional ao valor. Clique numa faixa ou na legenda destaca
   (mesmo padrão de clique-pra-selecionar do Donut/Legend, sem filtrar nada — é só leitura). */
function MonthFlow({
  totals,
  byCatChart,
  monthLabel
}) {
  const [active, setActive] = useState(null);
  const flow = useMemo(() => buildMonthFlow(totals, byCatChart), [totals, byCatChart]);
  if (!flow) return null;
  const {
    inc,
    nodes,
    deficit,
    shown
  } = flow;
  const toggle = name => setActive(a => a === name ? null : name);
  const VB_W = 480,
    VB_H = 200,
    NODE_W = 10,
    GAP = 4,
    PAD = 6,
    LABEL_MIN_H = 15;
  const RIGHT_X = VB_W - 96;
  const usableH = VB_H - PAD * 2;
  const scale = usableH / Math.max(inc, shown);
  const leftH = inc * scale;
  // as faixas nascem de fatias contíguas do nó de entradas — como há uma única origem, elas nunca se
  // cruzam. Quando falta dinheiro (deficit>0) essas fatias ficam proporcionalmente mais estreitas que o
  // destino de verdade, e a faixa "abre" ao longo do caminho — o próprio desenho avisa que gastou mais
  // do que entrou, sem precisar de nó negativo.
  const leftSliceScale = leftH / shown;
  let cursorRight = PAD,
    cursorLeft = PAD;
  const laid = nodes.map(n => {
    const rh = Math.max(n.value * scale, 5);
    const ry0 = cursorRight,
      ry1 = ry0 + rh;
    cursorRight = ry1 + GAP;
    const lh = n.value * leftSliceScale;
    const ly0 = cursorLeft,
      ly1 = ly0 + lh;
    cursorLeft = ly1;
    return {
      ...n,
      ry0,
      ry1,
      ly0,
      ly1
    };
  });
  const midX = (NODE_W + RIGHT_X) / 2;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 14
    }
  }, brl(inc), " entraram em ", monthLabel, " — veja para onde foram."), /*#__PURE__*/React.createElement("svg", {
    width: "100%",
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    role: "img",
    style: {
      overflow: "visible",
      display: "block"
    },
    "aria-label": `Fluxo de ${brl(inc)} entre gastos, investimento e sobra em ${monthLabel}`
  }, /*#__PURE__*/React.createElement("rect", {
    x: 0,
    y: PAD,
    width: NODE_W,
    height: Math.max(leftH, 2),
    rx: 2,
    fill: "var(--pos)"
  }), laid.map(n => {
    const dim = active && active !== n.name;
    const path = `M ${NODE_W},${n.ly0} C ${midX},${n.ly0} ${midX},${n.ry0} ${RIGHT_X},${n.ry0} L ${RIGHT_X},${n.ry1} C ${midX},${n.ry1} ${midX},${n.ly1} ${NODE_W},${n.ly1} Z`;
    return /*#__PURE__*/React.createElement("g", {
      key: n.name,
      className: "flowribbon",
      style: {
        cursor: "pointer"
      },
      tabIndex: 0,
      role: "button",
      "aria-label": `${n.name}: ${brl(n.value)}, ${Math.round(n.value / shown * 100)}% das entradas`,
      onClick: () => toggle(n.name),
      onKeyDown: e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle(n.name);
        }
      }
    }, /*#__PURE__*/React.createElement("path", {
      d: path,
      fill: n.color,
      style: {
        opacity: dim ? .15 : .55,
        transition: "opacity .15s"
      }
    }), /*#__PURE__*/React.createElement("rect", {
      className: "flownode",
      x: RIGHT_X,
      y: n.ry0,
      width: NODE_W,
      height: n.ry1 - n.ry0,
      rx: 2,
      fill: n.color,
      style: {
        opacity: dim ? .28 : 1,
        transition: "opacity .15s"
      }
    }), n.ry1 - n.ry0 >= LABEL_MIN_H && /*#__PURE__*/React.createElement("text", {
      x: RIGHT_X + NODE_W + 8,
      y: (n.ry0 + n.ry1) / 2,
      dominantBaseline: "middle",
      fill: "var(--text-mut)",
      style: {
        fontSize: 10,
        fontFamily: "'IBM Plex Mono',monospace",
        opacity: dim ? .35 : 1
      }
    }, abbrevBRL(n.value)));
  })), /*#__PURE__*/React.createElement(Legend, {
    data: nodes,
    onSelect: toggle,
    selected: active
  }), deficit > 0 && /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      color: "var(--warn)"
    }
  }, "Gastou ", brl(deficit), " a mais do que entrou este mês — por isso \"Sobrou\" não aparece no fluxo."));
}

/* money input */
function Money({
  cents,
  onChange,
  placeholder = "0,00",
  small,
  onEnter,
  onFocus,
  autoFocus
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "amount" + (small ? " small" : "")
  }, /*#__PURE__*/React.createElement("span", {
    className: "cur"
  }, "R$"), /*#__PURE__*/React.createElement("input", {
    inputMode: "decimal",
    placeholder: placeholder,
    autoFocus: autoFocus,
    value: cents === 0 ? "" : brlNum(cents),
    onChange: e => onChange(parseInt(e.target.value.replace(/\D/g, "") || "0", 10)),
    onKeyDown: e => {
      if (e.key === "Enter" && onEnter) onEnter();
    },
    onFocus: onFocus
  }));
}

/* =========================== TELA DE LOGIN =========================== */
function Auth() {
  const [signup, setSignup] = useState(false);
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoverSent, setRecoverSent] = useState(false);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setErr("");
    setOk("");
    setBusy(true);
    try {
      if (signup) {
        const {
          error
        } = await sb.auth.signUp({
          email,
          password: pass,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname
          }
        });
        if (error) throw error;
        setOk("Conta criada. Se pedirem confirmação, verifique seu e-mail — o link te traz de volta aqui já conectado.");
        setSignup(false);
      } else {
        const {
          error
        } = await sb.auth.signInWithPassword({
          email,
          password: pass
        });
        if (error) throw error;
      }
    } catch (e) {
      setErr(e.message || "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  }
  async function sendRecovery() {
    setErr("");
    setBusy(true);
    try {
      const {
        error
      } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw error;
      setRecoverSent(true);
    } catch (e) {
      setErr(e.message || "Não foi possível enviar o link de redefinição.");
    } finally {
      setBusy(false);
    }
  }
  function backToLogin() {
    setRecoverMode(false);
    setRecoverSent(false);
    setErr("");
    setOk("");
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "rz dark"
  }, /*#__PURE__*/React.createElement("div", {
    className: "authshell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "authbrand"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mark"
  }, /*#__PURE__*/React.createElement(BrandMark, {
    size: 40
  })), /*#__PURE__*/React.createElement("h1", null, "Razão"), /*#__PURE__*/React.createElement("p", null, "Clareza total sobre para onde vai cada real."), /*#__PURE__*/React.createElement("ul", {
    className: "authbadges"
  }, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    name: "escudo",
    size: 16
  }), " Dados protegidos pelo Supabase"), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 16
  }), " Backup exportável a qualquer momento"), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    name: "cartao",
    size: 16
  }), " Funciona no computador e no celular"))), /*#__PURE__*/React.createElement("div", {
    className: "authform"
  }, recoverMode ? /*#__PURE__*/React.createElement("div", {
    className: "authformcard"
  }, /*#__PURE__*/React.createElement("h2", null, "Redefinir senha"), recoverSent ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "fieldok",
    style: {
      marginBottom: 16
    }
  }, "Enviamos um link de redefinição para ", email, ". Abra-o neste aparelho para definir uma nova senha."), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: backToLogin
  }, "Voltar para entrar")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: "var(--text-mut)",
      marginBottom: 14
    }
  }, "Informe seu e-mail — enviaremos um link para você criar uma nova senha."), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("input", {
    id: "recoveremail",
    className: "fld floating",
    type: "email",
    placeholder: " ",
    value: email,
    onChange: e => setEmail(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") sendRecovery();
    }
  }), /*#__PURE__*/React.createElement("label", {
    htmlFor: "recoveremail"
  }, "E-mail")), /*#__PURE__*/React.createElement("button", {
    className: "submit",
    onClick: sendRecovery,
    disabled: busy || !email
  }, busy ? "Enviando…" : "Enviar link de redefinição"), err && /*#__PURE__*/React.createElement("div", {
    className: "fielderr"
  }, err), /*#__PURE__*/React.createElement("div", {
    className: "authswitch"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: backToLogin
  }, "Voltar para entrar")))) : /*#__PURE__*/React.createElement("div", {
    className: "authformcard"
  }, /*#__PURE__*/React.createElement("h2", null, signup ? "Criar conta" : "Entrar"), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("input", {
    id: "authemail",
    className: "fld floating",
    type: "email",
    placeholder: " ",
    value: email,
    onChange: e => setEmail(e.target.value)
  }), /*#__PURE__*/React.createElement("label", {
    htmlFor: "authemail"
  }, "E-mail")), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("input", {
    id: "authpass",
    className: "fld floating",
    type: showPass ? "text" : "password",
    placeholder: " ",
    value: pass,
    onChange: e => setPass(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") go();
    }
  }), /*#__PURE__*/React.createElement("label", {
    htmlFor: "authpass"
  }, "Senha (mínimo 6 caracteres)"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "fieldicon",
    "aria-label": showPass ? "Ocultar senha" : "Mostrar senha",
    onClick: () => setShowPass(s => !s)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: showPass ? "olho-fechado" : "olho",
    size: 16
  }))), !signup && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right",
      marginBottom: 14,
      marginTop: -8
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: {
      border: "none",
      background: "none",
      color: "var(--text-mut)",
      cursor: "pointer",
      fontSize: 12,
      textDecoration: "underline"
    },
    onClick: () => {
      setRecoverMode(true);
      setErr("");
    }
  }, "Esqueci minha senha")), /*#__PURE__*/React.createElement("button", {
    className: "submit",
    onClick: go,
    disabled: busy || !email || pass.length < 6
  }, busy ? "Enviando…" : signup ? "Criar conta" : "Entrar"), err && /*#__PURE__*/React.createElement("div", {
    className: "fielderr"
  }, err), ok && /*#__PURE__*/React.createElement("div", {
    className: "fieldok"
  }, ok), /*#__PURE__*/React.createElement("div", {
    className: "authswitch"
  }, signup ? /*#__PURE__*/React.createElement(React.Fragment, null, "Já tem conta? ", /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setSignup(false);
      setErr("");
    }
  }, "Entrar")) : /*#__PURE__*/React.createElement(React.Fragment, null, "Novo por aqui? ", /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setSignup(true);
      setErr("");
    }
  }, "Criar conta")))))));
}
/* =========================== DEFINIR NOVA SENHA (link de recuperação) =========================== */
function RecoverySetPassword({
  onDone
}) {
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setErr("");
    setBusy(true);
    try {
      const {
        error
      } = await sb.auth.updateUser({
        password: pass
      });
      if (error) throw error;
      toast("Senha atualizada.", "success");
      onDone();
    } catch (e) {
      setErr(e.message || "Não foi possível atualizar a senha.");
    } finally {
      setBusy(false);
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "rz dark"
  }, /*#__PURE__*/React.createElement("div", {
    className: "authshell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "authbrand"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mark"
  }, /*#__PURE__*/React.createElement(BrandMark, {
    size: 40
  })), /*#__PURE__*/React.createElement("h1", null, "Razão"), /*#__PURE__*/React.createElement("p", null, "Vamos definir sua nova senha.")), /*#__PURE__*/React.createElement("div", {
    className: "authform"
  }, /*#__PURE__*/React.createElement("div", {
    className: "authformcard"
  }, /*#__PURE__*/React.createElement("h2", null, "Nova senha"), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("input", {
    id: "recoverpass",
    className: "fld floating",
    type: showPass ? "text" : "password",
    placeholder: " ",
    value: pass,
    onChange: e => setPass(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") save();
    }
  }), /*#__PURE__*/React.createElement("label", {
    htmlFor: "recoverpass"
  }, "Nova senha (mínimo 6 caracteres)"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "fieldicon",
    "aria-label": showPass ? "Ocultar senha" : "Mostrar senha",
    onClick: () => setShowPass(s => !s)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: showPass ? "olho-fechado" : "olho",
    size: 16
  }))), /*#__PURE__*/React.createElement("button", {
    className: "submit",
    onClick: save,
    disabled: busy || pass.length < 6
  }, busy ? "Salvando…" : "Salvar nova senha"), err && /*#__PURE__*/React.createElement("div", {
    className: "fielderr"
  }, err)))));
}

/* =========================== APP =========================== */
function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!sb); // sem supabase, pula auth
  const [recovery, setRecovery] = useState(false); // veio de um link de "esqueci minha senha"
  const [loadStatus, setLoadStatus] = useState("carregando"); // carregando|ok|erro
  const [loadError, setLoadError] = useState("");
  const [loadNonce, setLoadNonce] = useState(0); // incrementar força uma nova tentativa de carga
  const [data, setData] = useState(SEED);
  const {
    transactions: txs,
    accounts,
    budgets,
    budgetExceptions,
    goals,
    holdings,
    categoryMemory,
    patrimonyHistory,
    recaps,
    settings
  } = data;
  const theme = data.theme || "dark";
  const isDesktop = useIsDesktop();
  const loaded = loadStatus === "ok"; // compat: usado pelas abas como "dados prontos"

  const [view, setView] = useState(new Date());
  const [tab, setTab] = useState("balanco");
  const [helpTarget, setHelpTarget] = useState(null);
  // filtro pendente pra aplicar assim que a aba de destino abrir (ver goToTab) — ex: clicar numa
  // categoria no Panorama chega no Balanço já com aquela categoria filtrada na lista
  const [pendingFilter, setPendingFilter] = useState(null);
  useEffect(() => {
    helpListener = sectionId => {
      setHelpTarget(sectionId);
      setTab("ajuda");
    };
    return () => {
      helpListener = null;
    };
  }, []);
  useEffect(() => {
    tabListener = (t, filter) => {
      setTab(t);
      setMoreOpen(false);
      if (filter) setPendingFilter(filter);
    };
    return () => {
      tabListener = null;
    };
  }, []);
  // popover do mês e menu "⋯" são mutuamente exclusivos por construção (só um valor guardado);
  // setMonthPicker/setMenu abaixo são compatíveis com o uso anterior (booleano ou função de toggle)
  const [activePopover, setActivePopover] = useState(null); // "month" | "menu" | null
  const monthPicker = activePopover === "month";
  const menu = activePopover === "menu";
  function setMonthPicker(v) {
    setActivePopover(p => {
      const next = typeof v === "function" ? v(p === "month") : v;
      return next ? "month" : p === "month" ? null : p;
    });
  }
  function setMenu(v) {
    setActivePopover(p => {
      const next = typeof v === "function" ? v(p === "menu") : v;
      return next ? "menu" : p === "menu" ? null : p;
    });
  }
  const monthTriggerRef = useRef(null);
  const monthPopRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const menuPopRef = useRef(null);
  // fecha ao clicar fora, com Esc (devolvendo o foco ao botão que abriu), ou ao abrir o outro popover
  useEffect(() => {
    if (!activePopover) return;
    const popRef = activePopover === "month" ? monthPopRef : menuPopRef;
    const triggerRef = activePopover === "month" ? monthTriggerRef : menuTriggerRef;
    function onDocMouseDown(e) {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      setActivePopover(null);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") {
        setActivePopover(null);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activePopover]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // aviso de versão nova: quem chama é o registro do service worker (no fim do arquivo), assim que
  // termina de baixar um build mais recente. Nada recarrega sozinho — a decisão é de quem está usando,
  // pra não perder o que estiver sendo digitado no meio de um lançamento.
  const [novaVersao, setNovaVersao] = useState(false);
  useEffect(() => {
    window.__razaoNovaVersao = () => setNovaVersao(true);
    return () => {
      delete window.__razaoNovaVersao;
    };
  }, []);
  const [pickerYear, setPickerYear] = useState(view.getFullYear());
  const [scrolled, setScrolled] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle|saving|saved|erro
  const [conflict, setConflict] = useState(null); // {message} quando há dados mais novos no servidor

  // sheet do formulário de lançamento (mobile) — controlado aqui pra poder abrir a partir do FAB em qualquer aba
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetEditTx, setSheetEditTx] = useState(null);
  const [sheetPropagateIds, setSheetPropagateIds] = useState([]);
  const fabRef = useRef(null);
  function openAdd() {
    setSheetEditTx(null);
    setSheetPropagateIds([]);
    setSheetOpen(true);
  }
  function openEditMobile(t, propagateIds) {
    setSheetEditTx(t);
    setSheetPropagateIds(propagateIds || []);
    setSheetOpen(true);
  }
  const fileRef = useRef(null);
  const saveTimer = useRef(null);
  const retryTimer = useRef(null);
  const lastKnownUpdatedAtRef = useRef(null);
  const dirtyRef = useRef(false); // há alteração ainda não confirmada como salva (para o aviso de beforeunload)
  const [offlineReadOnly, setOfflineReadOnly] = useState(false); // sem conexão: abre com o último estado salvo, sem gravar nada

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#08090D" : "#F6F7F9");
  }, [theme]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, {
      passive: true
    });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // auth — inclui o evento PASSWORD_RECOVERY (usuário clicou no link de "esqueci minha senha")
  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({
      data
    }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const {
      data: sub
    } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // carregar — nunca cai em SEED por falha: erro vira tela dedicada (LoadErrorScreen), sem sobrescrever nada
  useEffect(() => {
    if (!authReady) return;
    if (sb && !session) {
      setLoadStatus("carregando");
      return;
    }
    const userId = session ? session.user.id : null;
    let cancelled = false;
    setLoadStatus("carregando");
    setLoadError("");
    setOfflineReadOnly(false);
    (async () => {
      try {
        const {
          data: loadedData,
          updatedAt
        } = await loadData(userId);
        if (cancelled) return;
        setData(loadedData);
        lastKnownUpdatedAtRef.current = updatedAt;
        dirtyRef.current = false;
        setLoadStatus("ok");
        // espelha um instantâneo somente-leitura no aparelho: se a rede cair numa próxima abertura,
        // é isso que permite abrir com o último estado conhecido em vez de uma tela de erro
        if (sb && userId) {
          try {
            localStorage.setItem("razao_offline_cache", JSON.stringify({
              data: loadedData,
              cachedAt: Date.now()
            }));
          } catch (_) {}
        }
      } catch (e) {
        console.error(e);
        if (cancelled) return;
        // falha de rede específica (não um erro do servidor/permissão): se houver um instantâneo salvo
        // de uma sessão anterior, abre com ele em modo somente leitura em vez de mostrar erro — sem
        // gravar nada, pra não arriscar sobrescrever o servidor com dados desatualizados.
        const looksOffline = !navigator.onLine || /fetch|network|Failed to fetch/i.test(e?.message || "");
        if (looksOffline && sb && userId) {
          try {
            const cached = JSON.parse(localStorage.getItem("razao_offline_cache") || "null");
            if (cached && cached.data) {
              setData(migrate(cached.data));
              lastKnownUpdatedAtRef.current = null;
              dirtyRef.current = false;
              setOfflineReadOnly(true);
              setLoadStatus("ok");
              return;
            }
          } catch (_) {}
        }
        setLoadError(e.message || "Falha desconhecida ao carregar os dados.");
        setLoadStatus("erro");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, session, loadNonce]);

  // ao voltar a conexão em modo somente leitura, tenta buscar os dados reais e sincronizar de verdade
  useEffect(() => {
    function onOnline() {
      if (!offlineReadOnly) return;
      const userId = session ? session.user.id : null;
      loadData(userId).then(({
        data: freshData,
        updatedAt
      }) => {
        setData(freshData);
        lastKnownUpdatedAtRef.current = updatedAt;
        dirtyRef.current = false;
        setOfflineReadOnly(false);
        toast("Conexão restabelecida — dados sincronizados.", "success");
      }).catch(() => {/* ainda sem sorte; continua em somente leitura até a próxima tentativa */});
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [offlineReadOnly, session]);

  // salvar (debounce) com detecção de conflito entre dispositivos e nova tentativa automática em caso de falha
  async function attemptSave(userId, dataToSave, retryDelay) {
    try {
      const result = await saveData(userId, dataToSave, lastKnownUpdatedAtRef.current);
      if (result.conflict) {
        setSaveState("idle");
        setConflict({
          message: "Seus dados foram alterados em outro dispositivo depois da última vez que este aparelho salvou."
        });
        return;
      }
      if (result.updatedAt !== undefined) lastKnownUpdatedAtRef.current = result.updatedAt;
      dirtyRef.current = false;
      setSaveState("saved");
      setTimeout(() => setSaveState(s => s === "saved" ? "idle" : s), 2000);
      // mantém o espelho offline sempre no que acabou de ser confirmado como salvo — não só no que
      // foi carregado na abertura — senão uma sessão longa cheia de edições ficaria com um espelho velho
      if (sb && userId) {
        try {
          localStorage.setItem("razao_offline_cache", JSON.stringify({
            data: dataToSave,
            cachedAt: Date.now()
          }));
        } catch (_) {}
      }
    } catch (err) {
      console.error(err);
      setSaveState("erro");
      const nextDelay = retryDelay >= 15000 ? 15000 : retryDelay === 5000 ? 15000 : retryDelay === 2000 ? 5000 : 2000;
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => attemptSave(userId, dataToSave, nextDelay), retryDelay || 2000);
    }
  }
  function retrySaveNow() {
    clearTimeout(retryTimer.current);
    attemptSave(session ? session.user.id : null, data, 2000);
  }
  useEffect(() => {
    if (loadStatus !== "ok" || offlineReadOnly) return; // somente leitura offline: nunca tenta gravar
    dirtyRef.current = true;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    clearTimeout(retryTimer.current);
    const userId = session ? session.user.id : null;
    saveTimer.current = setTimeout(() => attemptSave(userId, data, 2000), 600);
    return () => clearTimeout(saveTimer.current);
  }, [data, loadStatus, offlineReadOnly]);

  // avisa antes de fechar/recarregar a aba se ainda houver algo não confirmado como salvo
  useEffect(() => {
    function onBeforeUnload(e) {
      if (dirtyRef.current || saveState === "saving" || saveState === "erro") {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  // ao voltar o foco na aba, verifica (checagem leve, só o carimbo de tempo) se há versão mais nova salva alhures
  useEffect(() => {
    if (!sb) return;
    function onVisible() {
      if (document.visibilityState !== "visible" || !session || loadStatus !== "ok") return;
      fetchServerUpdatedAt(session.user.id).then(serverUpdatedAt => {
        if (serverUpdatedAt && lastKnownUpdatedAtRef.current && !sameInstant(serverUpdatedAt, lastKnownUpdatedAtRef.current)) {
          setConflict({
            message: "Há uma versão mais nova dos seus dados salva em outro dispositivo."
          });
        }
      }).catch(() => {});
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [session, loadStatus]);
  async function reloadFromServer() {
    const userId = session ? session.user.id : null;
    try {
      const {
        data: freshData,
        updatedAt
      } = await loadData(userId);
      setData(freshData);
      lastKnownUpdatedAtRef.current = updatedAt;
      dirtyRef.current = false;
      setConflict(null);
      toast("Dados recarregados.", "success");
    } catch (e) {
      toast("Não foi possível recarregar agora.", "error");
    }
  }
  async function keepThisScreen() {
    const userId = session ? session.user.id : null;
    try {
      const result = await saveData(userId, data, null, true); // force: ignora o conflito e grava por cima
      if (result.updatedAt !== undefined) lastKnownUpdatedAtRef.current = result.updatedAt;
      dirtyRef.current = false;
      setConflict(null);
      toast("Dados desta tela salvos por cima.", "success");
    } catch (e) {
      toast("Não foi possível salvar agora. Tente de novo.", "error");
    }
  }
  useEffect(() => {
    if (monthPicker) setPickerYear(view.getFullYear());
  }, [monthPicker]);
  // ponto único de mutação: bloquear aqui cobre todo formulário/botão do app de uma vez, sem precisar
  // desabilitar cada um individualmente enquanto estiver em modo somente leitura offline
  const update = patch => {
    if (offlineReadOnly) {
      toast("Sem conexão — modo somente leitura. Esta alteração não foi salva.", "error");
      return;
    }
    setData(d => ({
      ...d,
      ...(typeof patch === "function" ? patch(d) : patch)
    }));
  };
  const vKey = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, "0")}`;
  // índice único por mês (mês da fatura, respeitando txEffectiveMonth): uma única passada por todos os
  // lançamentos alimenta entradas/saídas/investido/proventos/categoria (só o realizado) de cada mês, mais
  // a lista bruta de itens daquele mês (previsto incluso, pra quem precisar mostrar tudo). Balanço, Panorama
  // e Investimentos leem daqui em O(1) por mês, em vez de re-varrer txs inteiro dentro de laços de 6/24 meses.
  const monthIndex = useMemo(() => {
    const idx = {};
    const bucket = mk => idx[mk] || (idx[mk] = {
      entradas: 0,
      saidas: 0,
      investido: 0,
      proventos: 0,
      porCategoria: {},
      itens: []
    });
    txs.forEach(t => {
      const b = bucket(txEffectiveMonth(t, accounts));
      b.itens.push(t);
      if (!isRealized(t)) return;
      if (t.type === "ganho") {
        b.entradas += t.cents;
        if (t.category === "Proventos") b.proventos += t.cents;
      } else if (t.type === "gasto") {
        b.saidas += t.cents;
        b.porCategoria[t.category] = (b.porCategoria[t.category] || 0) + t.cents;
      } else if (t.type === "investimento") {
        b.investido += t.cents;
      }
    });
    return idx;
  }, [txs, accounts]);
  const EMPTY_BUCKET = {
    entradas: 0,
    saidas: 0,
    investido: 0,
    proventos: 0,
    porCategoria: {},
    itens: []
  };
  const monthBucket = mk => monthIndex[mk] || EMPTY_BUCKET;
  const monthItens = monthBucket(vKey).itens; // itens brutos do mês exibido (inclui previsto) — usados por Contas/Investimentos

  // saldo do mês: o realizado é o que conta pra valer; o previsto (lançamentos futuros ainda não ocorridos)
  // aparece separado, nunca somado ao saldo principal — só entra de fato quando marcado como pago
  const totals = useMemo(() => {
    const b = monthBucket(vKey);
    let previstoInc = 0,
      previstoExp = 0,
      previstoInv = 0;
    b.itens.forEach(t => {
      if (isRealized(t)) return;
      if (t.type === "ganho") previstoInc += t.cents;else if (t.type === "gasto") previstoExp += t.cents;else if (t.type === "investimento") previstoInv += t.cents;
    });
    return {
      inc: b.entradas,
      exp: b.saidas,
      inv: b.investido,
      saldo: b.entradas - b.saidas - b.investido,
      previstoInc,
      previstoExp,
      previstoInv,
      previstoSaldo: previstoInc - previstoExp - previstoInv
    };
  }, [monthIndex, vKey]);
  const prevTotals = useMemo(() => {
    const d = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    const pk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = monthBucket(pk);
    return {
      saldo: b.entradas - b.saidas - b.investido
    };
  }, [monthIndex, view]);
  // a lista mostra tudo (inclusive previsto, atenuado) — só os totais/históricos/gráficos excluem o previsto
  const grouped = useMemo(() => {
    const g = {};
    [...monthBucket(vKey).itens].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)).forEach(t => {
      (g[t.date] = g[t.date] || []).push(t);
    });
    return g;
  }, [monthIndex, vKey]);
  // base única para o orçamento: gastos no mês da fatura (flow), não no mês-calendário — evita o total do topo
  // divergir da soma das categorias quando há cartão com fechamento/vencimento configurado. só o realizado
  // conta pro orçamento — um gasto previsto ainda não aconteceu, não deveria comprometer o limite ainda.
  const flowSpentByCat = useMemo(() => monthBucket(vKey).porCategoria, [monthIndex, vKey]);
  // mesma régua do resto do orçamento (mês da fatura, não da compra) — senão o mín/média/máx não é comparável ao valor exibido acima
  const catHistory = useMemo(() => {
    const pm = {};
    Object.entries(monthIndex).forEach(([mk, b]) => {
      Object.entries(b.porCategoria).forEach(([cat, cents]) => {
        (pm[cat] = pm[cat] || {})[mk] = cents;
      });
    });
    const o = {};
    for (const c in pm) {
      const v = Object.values(pm[c]);
      o[c] = {
        min: Math.min(...v),
        max: Math.max(...v),
        avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length)
      };
    }
    return o;
  }, [monthIndex]);
  // orçamento variável: usa a exceção do mês exibido quando existir, senão o padrão da categoria
  const budgetRows = useMemo(() => {
    const exceptionsThisMonth = budgetExceptions[vKey] || {};
    const cats = new Set([...Object.keys(budgets), ...Object.keys(flowSpentByCat), ...Object.keys(exceptionsThisMonth)]);
    return [...cats].map(c => {
      const isException = Object.prototype.hasOwnProperty.call(exceptionsThisMonth, c);
      const limit = isException ? exceptionsThisMonth[c] : budgets[c] || 0;
      const spent = flowSpentByCat[c] || 0,
        pct = limit > 0 ? spent / limit : 0;
      const status = limit === 0 ? "none" : pct >= 1 ? "over" : pct >= 0.8 ? "warn" : "ok";
      return {
        cat: c,
        limit,
        spent,
        pct,
        status,
        hist: catHistory[c],
        isException
      };
    }).sort((a, b) => b.spent - a.spent);
  }, [budgets, budgetExceptions, vKey, flowSpentByCat, catHistory]);
  const plannedTotal = useMemo(() => budgetRows.reduce((s, r) => s + r.limit, 0), [budgetRows]);
  const alerts = budgetRows.filter(r => r.status === "over" || r.status === "warn");
  const byCatChart = useMemo(() => Object.entries(flowSpentByCat).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
    name,
    value,
    color: CAT_COLOR[name] || "var(--text-mut)"
  })), [flowSpentByCat]);
  const acctName = id => accounts.find(a => a.id === id);
  const sparkline = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(view.getFullYear(), view.getMonth() - i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = monthBucket(mk);
      arr.push(b.entradas - b.saidas - b.investido);
    }
    return arr;
  }, [monthIndex, view]);
  function moveMonth(d) {
    setView(v => new Date(v.getFullYear(), v.getMonth() + d, 1));
  }
  function selectMonth(d) {
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setMonthPicker(false);
  }
  function goToday() {
    const t = new Date();
    selectMonth(t);
  }
  function exportData(silent) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `razao-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenu(false);
    if (!silent) toast("Backup exportado.", "success");
  }

  // importação: nunca troca os dados na hora — mostra um resumo (mesclar x substituir) antes de qualquer coisa
  const [importPreview, setImportPreview] = useState(null); // {incoming:{...contagens},current:{...contagens},raw}
  const [importMode, setImportMode] = useState("merge"); // merge|replace
  const [replaceConfirmText, setReplaceConfirmText] = useState("");
  function importData(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(r.result);
      } catch (err) {
        toast("Arquivo inválido.", "error");
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        toast("Arquivo inválido.", "error");
        return;
      }
      setImportPreview({
        raw: parsed,
        incoming: {
          transactions: (parsed.transactions || []).length,
          accounts: (parsed.accounts || []).length,
          goals: (parsed.goals || []).length,
          holdings: (parsed.holdings || []).length
        },
        current: {
          transactions: txs.length,
          accounts: accounts.length,
          goals: goals.length,
          holdings: holdings.length
        }
      });
      setImportMode("merge");
      setReplaceConfirmText("");
    };
    r.readAsText(f);
    setMenu(false);
    setMoreOpen(false);
    e.target.value = "";
  }
  function applyImport() {
    if (!importPreview) return;
    // migrate() primeiro: um backup exportado antes do modelo atual (sem schemaVersion, sem status,
    // sem saldo inicial) precisa entrar já no formato certo, tanto ao substituir quanto ao mesclar.
    const raw = migrate(importPreview.raw);
    if (importMode === "replace") {
      if (replaceConfirmText.trim().toLowerCase() !== "substituir") return;
      exportData(true); // backup automático do estado atual antes de qualquer substituição
      setData(raw);
      toast("Dados substituídos. Um backup do estado anterior foi baixado.", "success");
    } else {
      const mergeArr = (curr, inc) => {
        const ids = new Set(curr.map(x => x.id));
        return [...curr, ...inc.filter(x => x && x.id && !ids.has(x.id))];
      };
      setData(d => ({
        ...d,
        transactions: mergeArr(d.transactions, raw.transactions || []),
        accounts: mergeArr(d.accounts, raw.accounts || []),
        goals: mergeArr(d.goals, raw.goals || []),
        holdings: mergeArr(d.holdings, raw.holdings || []),
        budgets: {
          ...(raw.budgets || {}),
          ...d.budgets
        },
        budgetExceptions: {
          ...(raw.budgetExceptions || {}),
          ...d.budgetExceptions
        }
      }));
      toast("Dados mesclados.", "success");
    }
    setImportPreview(null);
  }
  function exportCSV() {
    const esc = v => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [["ID", "Data", "Tipo", "Categoria", "Descricao", "Conta", "ContaDestino", "Valor"]];
    txs.forEach(t => {
      const acc = acctName(t.acctId);
      const toAcc = t.toAcctId ? acctName(t.toAcctId) : null;
      rows.push([t.id, t.date, TYPES[t.type].label, t.category || "", t.description || "", acc ? acc.name : "", toAcc ? toAcc.name : "", (t.cents / 100).toFixed(2).replace(".", ",")]);
    });
    const csv = "﻿" + rows.map(r => r.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `razao-transacoes-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMenu(false);
    toast("CSV exportado.", "success");
  }
  async function signOut() {
    await sb.auth.signOut();
    setMenu(false);
  }

  // gates
  if (recovery) return /*#__PURE__*/React.createElement(RecoverySetPassword, {
    onDone: () => setRecovery(false)
  });
  if (sb && !authReady) return /*#__PURE__*/React.createElement(SkeletonScreen, null);
  if (sb && !session) return /*#__PURE__*/React.createElement(Auth, null);
  if (loadStatus === "carregando") return /*#__PURE__*/React.createElement(SkeletonScreen, null);
  if (loadStatus === "erro") return /*#__PURE__*/React.createElement(LoadErrorScreen, {
    message: loadError,
    onRetry: () => setLoadNonce(n => n + 1),
    onSignOut: sb ? signOut : null
  });
  const monthLabel = capFirst(view.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric"
  }));
  return /*#__PURE__*/React.createElement("div", {
    className: "rz " + theme
  }, /*#__PURE__*/React.createElement("div", {
    className: "topbar" + (scrolled ? " scrolled" : "")
  }, /*#__PURE__*/React.createElement("div", {
    className: "topbar-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brandmark"
  }, /*#__PURE__*/React.createElement(BrandMark, null), /*#__PURE__*/React.createElement("div", {
    className: "brandtext"
  }, /*#__PURE__*/React.createElement("b", null, "Razão"), /*#__PURE__*/React.createElement("span", null, "finanças pessoais"))), /*#__PURE__*/React.createElement("div", {
    className: "monthpill"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mbtn",
    "aria-label": "Mês anterior",
    onClick: () => moveMonth(-1)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "seta-esquerda",
    size: 16
  })), /*#__PURE__*/React.createElement("button", {
    className: "monthlabel",
    ref: monthTriggerRef,
    "aria-expanded": monthPicker,
    onClick: () => setMonthPicker(p => !p)
  }, monthLabel, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-baixo",
    size: 12
  })), /*#__PURE__*/React.createElement("button", {
    className: "mbtn",
    "aria-label": "Próximo mês",
    onClick: () => moveMonth(1)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "seta-direita",
    size: 16
  })), monthPicker && /*#__PURE__*/React.createElement("div", {
    className: "monthpop",
    ref: monthPopRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "mpyear"
  }, /*#__PURE__*/React.createElement("button", {
    className: "mbtn",
    "aria-label": "Ano anterior",
    onClick: () => setPickerYear(y => y - 1)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "seta-esquerda",
    size: 14
  })), /*#__PURE__*/React.createElement("b", null, pickerYear), /*#__PURE__*/React.createElement("button", {
    className: "mbtn",
    "aria-label": "Próximo ano",
    onClick: () => setPickerYear(y => y + 1)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "seta-direita",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    className: "mpgrid"
  }, MONTH_NAMES.map((name, i) => /*#__PURE__*/React.createElement("button", {
    key: name,
    className: "mpm" + (pickerYear === view.getFullYear() && i === view.getMonth() ? " on" : ""),
    onClick: () => selectMonth(new Date(pickerYear, i, 1))
  }, name))), /*#__PURE__*/React.createElement("button", {
    className: "mptoday",
    onClick: goToday
  }, "Ir para o mês atual"))), /*#__PURE__*/React.createElement("div", {
    className: "topr"
  }, saveState !== "idle" && /*#__PURE__*/React.createElement("span", {
    className: "saveind" + (saveState === "erro" ? " err" : "")
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("span", null, saveState === "saving" ? "Salvando…" : saveState === "saved" ? "Salvo" : "Falha ao salvar"), saveState === "erro" && /*#__PURE__*/React.createElement("button", {
    className: "saveretry",
    onClick: retrySaveNow
  }, "Tentar de novo")), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    "aria-label": "Alternar tema",
    onClick: () => update(d => ({
      theme: d.theme === "dark" ? "light" : "dark"
    }))
  }, /*#__PURE__*/React.createElement(Icon, {
    name: theme === "dark" ? "sol" : "lua",
    size: 17
  })), /*#__PURE__*/React.createElement("div", {
    className: "menu"
  }, /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    ref: menuTriggerRef,
    "aria-label": "Menu",
    "aria-expanded": menu,
    onClick: () => setMenu(m => !m)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "mais",
    size: 17
  })), menu && /*#__PURE__*/React.createElement("div", {
    className: "menupop",
    ref: menuPopRef
  }, session && /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, session.user.email), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setSettingsOpen(true);
      setMenu(false);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "config",
    size: 16
  }), " Configurações"), /*#__PURE__*/React.createElement("button", {
    onClick: () => exportData()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 16
  }), " Exportar backup (.json)"), /*#__PURE__*/React.createElement("button", {
    onClick: exportCSV
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 16
  }), " Exportar dados (.csv)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => fileRef.current?.click()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "enviar",
    size: 16
  }), " Importar backup"), sb && /*#__PURE__*/React.createElement("button", {
    onClick: signOut
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sair",
    size: 16
  }), " Sair da conta")), /*#__PURE__*/React.createElement("input", {
    ref: fileRef,
    type: "file",
    accept: "application/json",
    style: {
      display: "none"
    },
    onChange: importData
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "shell"
  }, /*#__PURE__*/React.createElement("nav", {
    className: "sidebar",
    "aria-label": "Navegação principal"
  }, TAB_GROUPS.map((g, gi) => /*#__PURE__*/React.createElement("div", {
    className: "navgroup",
    key: gi
  }, /*#__PURE__*/React.createElement("div", {
    className: "navgrouplabel"
  }, g.label), g.items.map(([k, l, ic]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: "navitem" + (tab === k ? " on" : ""),
    "data-tip": l,
    "aria-current": tab === k ? "page" : undefined,
    onClick: () => setTab(k)
  }, /*#__PURE__*/React.createElement("span", {
    className: "navic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 18
  })), /*#__PURE__*/React.createElement("span", {
    className: "navlbl"
  }, l))))), /*#__PURE__*/React.createElement("div", {
    className: "navfooter"
  }, /*#__PURE__*/React.createElement("span", {
    className: "navavatar"
  }, session ? session.user.email[0].toUpperCase() : /*#__PURE__*/React.createElement(Icon, {
    name: "contas",
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    className: "navlbl2"
  }, /*#__PURE__*/React.createElement("b", null, session ? session.user.email.split("@")[0] : "Modo local"), /*#__PURE__*/React.createElement("small", null, session ? "Conta conectada" : "Somente neste aparelho"), /*#__PURE__*/React.createElement("small", {
    className: "ver"
  }, "versão ", APP_VERSION)))), /*#__PURE__*/React.createElement("div", {
    className: "tabcontent"
  }, !sb && /*#__PURE__*/React.createElement("div", {
    className: "banner"
  }, "Modo local: os dados ficam só neste aparelho. Configure o Supabase no início do arquivo para ter login e sincronização entre dispositivos."), offlineReadOnly && /*#__PURE__*/React.createElement("div", {
    className: "banner err"
  }, "Sem conexão — mostrando a última versão salva. Alterações não serão gravadas até a conexão voltar."), novaVersao && /*#__PURE__*/React.createElement("div", {
    className: "banner upd"
  }, /*#__PURE__*/React.createElement("span", null, "Uma versão mais nova do Razão já foi baixada. Recarregue quando quiser para usá-la."), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => window.location.reload()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 14
  }), " Atualizar agora")), tab === "geral" && /*#__PURE__*/React.createElement(Geral, {
    txs,
    accounts,
    holdings,
    view,
    onSelectMonth: selectMonth,
    monthIndex,
    update,
    patrimonyHistory,
    recaps,
    aiModel: settings?.aiModel || "rapido"
  }), tab === "balanco" && /*#__PURE__*/React.createElement(Balanco, {
    grouped,
    monthLabel,
    totals,
    prevTotals,
    sparkline,
    plannedTotal,
    alerts,
    byCatChart,
    acctName,
    txs,
    view,
    accounts,
    onSelectMonth: selectMonth,
    update,
    isDesktop,
    onEditMobile: openEditMobile,
    monthIndex,
    categoryMemory,
    hourlyWageCents: settings?.hourlyWageCents || 0,
    budgetRows,
    aiModel: settings?.aiModel || "rapido",
    pendingFilter,
    onConsumePendingFilter: () => setPendingFilter(null)
  }), tab === "orcamento" && /*#__PURE__*/React.createElement(Orcamento, {
    budgetRows,
    budgets,
    budgetExceptions,
    update,
    plannedTotal,
    totalSpent: totals.exp,
    monthLabel,
    txs,
    view,
    accounts
  }), tab === "metas" && /*#__PURE__*/React.createElement(Metas, {
    goals,
    update,
    txs
  }), tab === "investimentos" && /*#__PURE__*/React.createElement(Investimentos, {
    holdings,
    update,
    monthIndex,
    monthLabel,
    txs,
    view,
    onSelectMonth: selectMonth
  }), tab === "extrato" && /*#__PURE__*/React.createElement(Extrato, {
    accounts,
    update,
    txs,
    aiModel: settings?.aiModel || "rapido"
  }), tab === "perguntar" && /*#__PURE__*/React.createElement(Perguntar, {
    txs,
    accounts
  }), tab === "contas" && /*#__PURE__*/React.createElement(Contas, {
    accounts,
    update,
    monthTx: monthItens,
    txs
  }), tab === "ajuda" && /*#__PURE__*/React.createElement(Ajuda, {
    helpTarget: helpTarget,
    onConsumeTarget: () => setHelpTarget(null)
  })))), /*#__PURE__*/React.createElement("nav", {
    className: "bottomnav",
    "aria-label": "Navegação"
  }, /*#__PURE__*/React.createElement("button", {
    className: tab === "geral" ? "on" : "",
    onClick: () => setTab("geral"),
    "aria-label": "Panorama"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "panorama",
    size: 20
  }), /*#__PURE__*/React.createElement("span", null, "Panorama")), /*#__PURE__*/React.createElement("button", {
    className: tab === "balanco" ? "on" : "",
    onClick: () => setTab("balanco"),
    "aria-label": "Balanço"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendario",
    size: 20
  }), /*#__PURE__*/React.createElement("span", null, "Balanço")), /*#__PURE__*/React.createElement("button", {
    className: "fab",
    ref: fabRef,
    "aria-label": "Adicionar lançamento",
    onClick: openAdd
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "adicionar",
    size: 22
  })), /*#__PURE__*/React.createElement("button", {
    className: tab === "orcamento" ? "on" : "",
    onClick: () => setTab("orcamento"),
    "aria-label": "Orçamento"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "orcamento",
    size: 20
  }), /*#__PURE__*/React.createElement("span", null, "Orçamento")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setMoreOpen(true),
    "aria-label": "Mais opções"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "mais",
    size: 20
  }), /*#__PURE__*/React.createElement("span", null, "Mais"))), /*#__PURE__*/React.createElement(Sheet, {
    open: moreOpen,
    onClose: () => setMoreOpen(false),
    title: "Mais"
  }, MORE_TABS.map(([k, l, ic]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: "sheetlistitem",
    onClick: () => {
      setTab(k);
      setMoreOpen(false);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 18
  }), " ", /*#__PURE__*/React.createElement("span", null, l))), /*#__PURE__*/React.createElement("div", {
    className: "sheetdivider"
  }), /*#__PURE__*/React.createElement("button", {
    className: "sheetlistitem",
    onClick: () => {
      setSettingsOpen(true);
      setMoreOpen(false);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "config",
    size: 18
  }), " Configurações"), /*#__PURE__*/React.createElement("button", {
    className: "sheetlistitem",
    onClick: () => {
      exportData();
      setMoreOpen(false);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 18
  }), " Exportar backup (.json)"), /*#__PURE__*/React.createElement("button", {
    className: "sheetlistitem",
    onClick: () => {
      exportCSV();
      setMoreOpen(false);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 18
  }), " Exportar dados (.csv)"), /*#__PURE__*/React.createElement("button", {
    className: "sheetlistitem",
    onClick: () => {
      fileRef.current?.click();
      setMoreOpen(false);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "enviar",
    size: 18
  }), " Importar backup"), sb && /*#__PURE__*/React.createElement("button", {
    className: "sheetlistitem danger",
    onClick: () => {
      signOut();
      setMoreOpen(false);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sair",
    size: 18
  }), " Sair da conta"), /*#__PURE__*/React.createElement("div", {
    className: "versionline"
  }, "Razão versão ", APP_VERSION, " · ", fmtDateBR(APP_BUILD))), /*#__PURE__*/React.createElement(Sheet, {
    open: settingsOpen,
    onClose: () => setSettingsOpen(false),
    title: "Configurações"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 6
    }
  }, "Valor da sua hora de trabalho (opcional)"), /*#__PURE__*/React.createElement(Money, {
    cents: settings?.hourlyWageCents || 0,
    onChange: v => update(d => ({
      settings: {
        ...d.settings,
        hourlyWageCents: v
      }
    })),
    small: true
  }), /*#__PURE__*/React.createElement("div", {
    className: "hint"
  }, "Preenchendo, os lançamentos passam a mostrar quantas horas de trabalho aquele valor representa. Deixe em R$ 0,00 para desligar."), /*#__PURE__*/React.createElement("div", {
    className: "sheetdivider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 6
    }
  }, "Motor de IA usado para ler extratos e faturas"), /*#__PURE__*/React.createElement("div", {
    className: "seg",
    style: {
      marginBottom: 6
    }
  }, Object.entries(AI_MODELS).map(([k, m]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: (settings?.aiModel || "rapido") === k ? "on in" : "",
    onClick: () => update(d => ({
      settings: {
        ...d.settings,
        aiModel: k
      }
    }))
  }, m.label))), /*#__PURE__*/React.createElement("div", {
    className: "hint"
  }, AI_MODELS[settings?.aiModel || "rapido"].hint, " Se um documento vier bagunçado ou com muitas linhas erradas, troque para \"Cuidadoso\" e mande de novo só aquele arquivo."), /*#__PURE__*/React.createElement("div", {
    className: "sheetdivider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Versão do app"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, APP_VERSION)), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Atualizado em"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, fmtDateBR(APP_BUILD))), novaVersao ? /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    style: {
      marginTop: 10
    },
    onClick: () => window.location.reload()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 14
  }), " Instalar a versão nova") : /*#__PURE__*/React.createElement("div", {
    className: "hint"
  }, "Você está na versão mais recente que este aparelho baixou. Quando sair uma nova, um aviso aparece aqui e no topo da tela.")), /*#__PURE__*/React.createElement(Sheet, {
    open: sheetOpen,
    onClose: () => setSheetOpen(false),
    title: sheetEditTx ? "Editar lançamento" : "Novo lançamento",
    returnFocusRef: fabRef
  }, /*#__PURE__*/React.createElement(TransactionForm, {
    accounts: accounts,
    txs: txs,
    update: update,
    editTx: sheetEditTx,
    propagateIds: sheetPropagateIds,
    onDone: () => setSheetOpen(false),
    categoryMemory: categoryMemory,
    autoFocus: true
  })), /*#__PURE__*/React.createElement(ConflictDialog, {
    open: !!conflict,
    message: conflict ? conflict.message : "",
    onReload: reloadFromServer,
    onKeep: keepThisScreen,
    onClose: () => setConflict(null)
  }), /*#__PURE__*/React.createElement(Sheet, {
    open: !!importPreview,
    onClose: () => setImportPreview(null),
    title: "Importar backup"
  }, importPreview && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: "var(--text-mut)",
      marginBottom: 14,
      lineHeight: 1.5
    }
  }, "Compare o que tem no arquivo com o que já existe aqui antes de aplicar."), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Lançamentos"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, importPreview.current.transactions, " atual · ", importPreview.incoming.transactions, " no arquivo")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Contas"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, importPreview.current.accounts, " atual · ", importPreview.incoming.accounts, " no arquivo")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Metas"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, importPreview.current.goals, " atual · ", importPreview.incoming.goals, " no arquivo")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Ativos"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, importPreview.current.holdings, " atual · ", importPreview.incoming.holdings, " no arquivo")), /*#__PURE__*/React.createElement("div", {
    className: "seg",
    style: {
      margin: "16px 0 12px"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: importMode === "merge" ? "on in" : "",
    onClick: () => setImportMode("merge")
  }, "Mesclar"), /*#__PURE__*/React.createElement("button", {
    className: importMode === "replace" ? "on out" : "",
    onClick: () => setImportMode("replace")
  }, "Substituir tudo")), importMode === "merge" ? /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Mantém tudo o que já existe aqui e adiciona só os itens do arquivo que ainda não existem (comparando por id).") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      color: "var(--neg)"
    }
  }, "Isso apaga os dados atuais e os troca pelos do arquivo. Um backup do estado atual é baixado automaticamente antes. Para confirmar, digite \"substituir\" abaixo."), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    value: replaceConfirmText,
    onChange: e => setReplaceConfirmText(e.target.value),
    placeholder: "Digite \"substituir\"",
    style: {
      margin: "10px 0 4px"
    }
  })), /*#__PURE__*/React.createElement("button", {
    className: "submit",
    style: {
      marginTop: 14
    },
    onClick: applyImport,
    disabled: importMode === "replace" && replaceConfirmText.trim().toLowerCase() !== "substituir"
  }, importMode === "replace" ? "Substituir tudo" : "Mesclar dados"))), /*#__PURE__*/React.createElement(ToastHost, null), /*#__PURE__*/React.createElement(ConfirmHost, null), /*#__PURE__*/React.createElement(SeriesScopeHost, null), /*#__PURE__*/React.createElement(WelcomeTour, null));
}

/* ---------- FORMULÁRIO DE LANÇAMENTO (usado inline no desktop e dentro do sheet no mobile) ---------- */
function TransactionForm({
  accounts,
  txs,
  update,
  editTx,
  onDone,
  autoFocus,
  propagateIds,
  categoryMemory
}) {
  const [type, setType] = useState(editTx ? editTx.type : "gasto");
  const [cents, setCents] = useState(editTx ? editTx.cents : 0);
  const [cat, setCat] = useState(editTx ? editTx.category || CATS.gasto[0][0] : "Alimentação");
  const [desc, setDesc] = useState(editTx ? editTx.description : "");
  const [date, setDate] = useState(editTx ? editTx.date : todayISO());
  const [acctId, setAcctId] = useState(editTx ? editTx.acctId || accounts[0]?.id || "" : accounts[0]?.id || "");
  const [toAcctId, setToAcctId] = useState(editTx ? editTx.toAcctId || accounts[1]?.id || accounts[0]?.id || "" : accounts[1]?.id || accounts[0]?.id || "");
  const [repeat, setRepeat] = useState(false);
  const [repeatMode, setRepeatMode] = useState("fixo"); // "fixo" (recorrente) | "parcelado"
  const [repeatTimes, setRepeatTimes] = useState(2);
  const [catManual, setCatManual] = useState(!!editTx);
  const [catSuggestBusy, setCatSuggestBusy] = useState(false);
  const formRef = useRef(null);
  const descTimer = useRef(null);
  const editId = editTx ? editTx.id : null;

  // autocompletar #tag: sugere tags já usadas antes enquanto a pessoa digita "#" na descrição
  const knownTags = useMemo(() => {
    const set = new Set();
    txs.forEach(t => extractTags(t.description).forEach(tg => set.add(tg)));
    return [...set].sort();
  }, [txs]);
  const tagFragmentMatch = desc.match(/#(\w*)$/);
  const tagFragment = tagFragmentMatch ? tagFragmentMatch[1].toLowerCase() : null;
  const tagSuggestions = tagFragment != null ? knownTags.filter(tg => tg !== tagFragment && tg.startsWith(tagFragment)).slice(0, 5) : [];
  const pickTagSuggestion = tg => setDesc(d => d.replace(/#(\w*)$/, "#" + tg + " "));
  useEffect(() => {
    if (!editTx && CATS[type]) setCat(CATS[type][0][0]);
    if (!editTx) setCatManual(false);
  }, [type]);
  // sugestão de categoria enquanto o usuário digita a descrição (só se ele ainda não escolheu uma categoria na mão;
  // transferência não tem categoria). Primeiro consulta a memória local (descrição→categoria já escolhida antes) —
  // só cai pra IA se não achar nada ali, economizando uma chamada de rede no caso comum de descrição repetida.
  useEffect(() => {
    clearTimeout(descTimer.current);
    if (editId || catManual || type === "transferencia" || desc.trim().length < 3) return;
    const remembered = lookupCategoryMemory(categoryMemory, desc.trim());
    if (remembered && CATS[type].some(c => c[0] === remembered)) {
      setCat(remembered);
      return;
    }
    descTimer.current = setTimeout(async () => {
      setCatSuggestBusy(true);
      try {
        const suggested = await suggestCategoryWithAI(desc.trim(), type);
        if (suggested) setCat(suggested);
      } catch (_) {/* sugestão é só um bônus; sem IA a escolha manual de categoria continua normal */} finally {
        setCatSuggestBusy(false);
      }
    }, 800);
    return () => clearTimeout(descTimer.current);
  }, [desc, type, catManual, editId, categoryMemory]);
  const isTransfer = type === "transferencia";
  const transferInvalid = isTransfer && (!toAcctId || acctId === toAcctId);
  function submit() {
    if (cents <= 0) return;
    if (transferInvalid) return;
    const entryCat = isTransfer ? "" : cat;
    const entryToAcct = isTransfer ? toAcctId : undefined;
    const today = todayISO();
    // memória de categorização: toda vez que um lançamento com descrição é salvo, guarda a categoria escolhida
    // pra essa descrição — próxima vez que ela aparecer, sugere direto sem precisar chamar a IA
    const rememberKey = !isTransfer && desc.trim() ? desc.trim().toLowerCase() : null;
    const withMemory = (d, patch) => rememberKey ? {
      ...patch,
      categoryMemory: {
        ...(d.categoryMemory || {}),
        [rememberKey]: entryCat
      }
    } : patch;
    if (repeat && !editId) {
      const n = Math.max(2, parseInt(repeatTimes, 10) || 2);
      const baseDesc = desc.trim() || (isTransfer ? "Transferência" : cat);
      const sId = uid(); // agrupa a série toda (recorrência/parcelamento) pra permitir editar/excluir em bloco depois
      const entries = repeatMode === "parcelado" ? splitCents(cents, n).map((c, i) => {
        const d = addMonthsISO(date, i);
        return {
          id: uid(),
          type,
          cents: c,
          category: entryCat,
          description: `${baseDesc} (${i + 1}/${n})`,
          date: d,
          acctId,
          toAcctId: entryToAcct,
          status: d > today ? "previsto" : "realizado",
          seriesId: sId,
          seriesIndex: i,
          seriesTotal: n
        };
      }) : Array.from({
        length: n
      }, (_, i) => {
        const d = addMonthsISO(date, i);
        return {
          id: uid(),
          type,
          cents,
          category: entryCat,
          description: desc.trim(),
          date: d,
          acctId,
          toAcctId: entryToAcct,
          status: d > today ? "previsto" : "realizado",
          seriesId: sId,
          seriesIndex: i,
          seriesTotal: n
        };
      });
      update(d => withMemory(d, {
        transactions: [...entries, ...d.transactions]
      }));
      toast(`${n} lançamentos criados.`, "success");
      setCents(0);
      setDesc("");
      setRepeat(false);
      setRepeatTimes(2);
      setCatManual(false);
      formRef.current?.querySelector("input")?.focus();
      onDone && onDone();
      return;
    }
    const entry = {
      id: editId || uid(),
      type,
      cents,
      category: entryCat,
      description: desc.trim(),
      date,
      acctId,
      toAcctId: entryToAcct,
      status: editId ? editTx.status || "realizado" : date > today ? "previsto" : "realizado",
      ...(editId ? {
        seriesId: editTx.seriesId,
        seriesIndex: editTx.seriesIndex,
        seriesTotal: editTx.seriesTotal
      } : {})
    };
    if (editId && propagateIds && propagateIds.length) {
      // "este e os próximos" / "todos": propaga só os campos editáveis (não a data — cada ocorrência é a sua própria)
      update(d => withMemory(d, {
        transactions: d.transactions.map(t => {
          if (t.id === editId) return entry;
          // não propaga a descrição: no parcelado ela carrega o número da própria parcela "(2/4)" etc.,
          // então sobrescrever com a descrição do item editado apagaria a numeração dos outros.
          if (propagateIds.includes(t.id)) return {
            ...t,
            type: entry.type,
            cents: entry.cents,
            category: entry.category,
            acctId: entry.acctId,
            toAcctId: entry.toAcctId
          };
          return t;
        })
      }));
    } else {
      update(d => withMemory(d, {
        transactions: editId ? d.transactions.map(t => t.id === editId ? entry : t) : [entry, ...d.transactions]
      }));
    }
    toast(editId ? "Lançamento atualizado." : "Lançamento adicionado.", "success");
    setCents(0);
    setDesc("");
    setCatManual(false);
    formRef.current?.querySelector("input")?.focus();
    onDone && onDone();
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "add",
    ref: formRef
  }, editId && /*#__PURE__*/React.createElement("div", {
    className: "editing"
  }, /*#__PURE__*/React.createElement("span", null, "Editando lançamento"), /*#__PURE__*/React.createElement("button", {
    onClick: onDone
  }, "cancelar")), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, Object.entries(TYPES).map(([k, v]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: (type === k ? "on " : "") + v.cls,
    onClick: () => setType(k)
  }, v.label))), /*#__PURE__*/React.createElement(Money, {
    cents: cents,
    onChange: setCents,
    onEnter: submit,
    autoFocus: autoFocus
  }), !isTransfer && /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, CATS[type].map(([name, ic]) => /*#__PURE__*/React.createElement("button", {
    key: name,
    className: "chip" + (cat === name ? " on" : ""),
    onClick: () => {
      setCat(name);
      setCatManual(true);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "swatch",
    style: {
      background: cat === name ? "transparent" : CAT_COLOR[name] + "22"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 12
  })), name)), catSuggestBusy && /*#__PURE__*/React.createElement("span", {
    className: "aichip"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 12
  }), /*#__PURE__*/React.createElement("span", {
    className: "shimmer"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Descrição (opcional) — use #tags",
    value: desc,
    onChange: e => setDesc(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") submit();
    }
  }), tagSuggestions.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "tagsuggest"
  }, tagSuggestions.map(tg => /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: tg,
    onClick: () => pickTagSuggestion(tg)
  }, "#", tg)))), isTransfer ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: acctId,
    onChange: e => setAcctId(e.target.value),
    style: {
      flex: "0 0 auto",
      maxWidth: 170
    }
  }, accounts.map(a => /*#__PURE__*/React.createElement("option", {
    key: a.id,
    value: a.id
  }, "Origem: ", a.name))), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: toAcctId,
    onChange: e => setToAcctId(e.target.value),
    style: {
      flex: "0 0 auto",
      maxWidth: 170
    }
  }, accounts.map(a => /*#__PURE__*/React.createElement("option", {
    key: a.id,
    value: a.id
  }, "Destino: ", a.name)))) : /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: acctId,
    onChange: e => setAcctId(e.target.value),
    style: {
      flex: "0 0 auto",
      maxWidth: 170
    }
  }, accounts.map(a => /*#__PURE__*/React.createElement("option", {
    key: a.id,
    value: a.id
  }, a.name))), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "date",
    value: date,
    onChange: e => setDate(e.target.value),
    style: {
      flex: "0 0 auto",
      maxWidth: 160
    }
  })), isTransfer && transferInvalid && /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      color: "var(--neg)"
    }
  }, "A conta de origem e destino devem ser diferentes."), !editId && /*#__PURE__*/React.createElement("label", {
    className: "toggle"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: repeat,
    onChange: e => setRepeat(e.target.checked)
  }), "Repetir / Parcelar"), !editId && repeat && /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: repeatMode,
    onChange: e => setRepeatMode(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "fixo"
  }, "Fixo / Recorrente"), /*#__PURE__*/React.createElement("option", {
    value: "parcelado"
  }, "Parcelado")), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "2",
    placeholder: "Vezes",
    value: repeatTimes,
    onChange: e => setRepeatTimes(e.target.value),
    style: {
      flex: "0 0 auto",
      maxWidth: 120
    }
  })), !editId && repeat && cents > 0 && (() => {
    const n = Math.max(2, parseInt(repeatTimes, 10) || 2);
    return /*#__PURE__*/React.createElement("p", {
      className: "hint",
      style: {
        marginTop: -6,
        marginBottom: 14
      }
    }, repeatMode === "parcelado" ? /*#__PURE__*/React.createElement(React.Fragment, null, "Serão criados ", n, " lançamentos de ~", brl(Math.round(cents / n)), " cada, de ", fmtDateBR(date), " até ", fmtDateBR(addMonthsISO(date, n - 1)), ".") : /*#__PURE__*/React.createElement(React.Fragment, null, "Serão criados ", n, " lançamentos de ", brl(cents), " cada, de ", fmtDateBR(date), " até ", fmtDateBR(addMonthsISO(date, n - 1)), "."));
  })(), /*#__PURE__*/React.createElement("button", {
    className: "submit",
    onClick: submit,
    disabled: cents <= 0 || transferInvalid
  }, editId ? "Salvar alterações" : repeat ? `Criar ${Math.max(2, parseInt(repeatTimes, 10) || 2)} lançamentos` : "Salvar lançamento"));
}

/* ---------- BALANÇO ---------- */
/* =======================================================================
   BRIEFING PARA A IA — o resumo do mês só fica bom se a IA receber mais do
   que quatro totais. Esta função monta o dossiê completo do mês (comparação
   com o mês anterior e com a média recente, categorias com variação, maiores
   gastos, cartões, orçamentos, recorrentes, previstos ainda não pagos) para
   que o texto gerado possa citar fato, número e causa em vez de generalidade.
   ======================================================================= */
/* formatação leve do texto que a IA devolve: "## título", "- item" e **negrito**. Não é markdown
   completo — é só o suficiente para o resumo elaborado ficar legível em vez de virar um bloco só. */
function aiInline(text, kp) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => part.startsWith("**") && part.endsWith("**") ? /*#__PURE__*/React.createElement("b", {
    key: kp + i
  }, part.slice(2, -2)) : /*#__PURE__*/React.createElement(React.Fragment, {
    key: kp + i
  }, part));
}
function RichAI({
  text
}) {
  const blocks = [];
  String(text || "").split("\n").forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (/^#{1,4}\s/.test(line)) blocks.push({
      k: "h",
      t: line.replace(/^#{1,4}\s*/, "").replace(/\*\*/g, "")
    });else if (/^[-*•]\s+/.test(line)) blocks.push({
      k: "li",
      t: line.replace(/^[-*•]\s+/, "")
    });else if (/^\d+[.)]\s+/.test(line)) blocks.push({
      k: "li",
      t: line.replace(/^\d+[.)]\s*/, "")
    });else blocks.push({
      k: "p",
      t: line
    });
  });
  const out = [];
  let bucket = null;
  blocks.forEach(b => {
    if (b.k === "li") {
      if (!bucket) {
        bucket = [];
        out.push({
          k: "ul",
          items: bucket
        });
      }
      bucket.push(b.t);
    } else {
      bucket = null;
      out.push(b);
    }
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "airich"
  }, out.map((b, i) => b.k === "h" ? /*#__PURE__*/React.createElement("h4", {
    key: i
  }, b.t) : b.k === "ul" ? /*#__PURE__*/React.createElement("ul", {
    key: i
  }, b.items.map((t, j) => /*#__PURE__*/React.createElement("li", {
    key: j
  }, aiInline(t, i + "-" + j + "-")))) : /*#__PURE__*/React.createElement("p", {
    key: i
  }, aiInline(b.t, i + "-"))));
}
const toReal = c => Number((c / 100).toFixed(2));
const pctDiff = (atual, anterior) => anterior > 0 ? Math.round((atual - anterior) / anterior * 100) : null;
function buildMonthlyBriefing({
  txs,
  accounts,
  monthDate,
  monthIndex,
  budgetRows
}) {
  const mkOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const mk = mkOf(monthDate);
  const prevDate = new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1);
  const prevMk = mkOf(prevDate);
  const nameOf = id => accounts.find(a => a.id === id)?.name || "—";
  // mesmo critério do resto do app: gasto no cartão pesa no mês em que a fatura vence
  const ofMonth = key => txs.filter(t => isRealized(t) && txEffectiveMonth(t, accounts) === key);
  const cur = ofMonth(mk),
    prv = ofMonth(prevMk);
  const sumType = (arr, type) => arr.filter(t => t.type === type).reduce((s, t) => s + t.cents, 0);
  const curIn = sumType(cur, "ganho"),
    curOut = sumType(cur, "gasto"),
    curInv = sumType(cur, "investimento");
  const prvIn = sumType(prv, "ganho"),
    prvOut = sumType(prv, "gasto"),
    prvInv = sumType(prv, "investimento");
  const catSum = arr => {
    const m = {};
    arr.filter(t => t.type === "gasto").forEach(t => {
      m[t.category] = (m[t.category] || 0) + t.cents;
    });
    return m;
  };
  const curCat = catSum(cur),
    prvCat = catSum(prv);
  const categorias = Object.entries(curCat).sort((a, b) => b[1] - a[1]).map(([nome, c]) => ({
    nome,
    valor: toReal(c),
    pctDoTotalDeGastos: curOut > 0 ? Math.round(c / curOut * 100) : 0,
    mesAnterior: toReal(prvCat[nome] || 0),
    variacaoPct: pctDiff(c, prvCat[nome] || 0)
  }));
  // categoria que existia no mês passado e sumiu agora também é informação útil
  const categoriasQueSumiram = Object.entries(prvCat).filter(([nome]) => !curCat[nome]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([nome, c]) => ({
    nome,
    valorNoMesAnterior: toReal(c)
  }));
  const maioresGastos = cur.filter(t => t.type === "gasto").sort((a, b) => b.cents - a.cents).slice(0, 8).map(t => ({
    data: t.date,
    descricao: (t.description || "").trim() || t.category,
    categoria: t.category,
    valor: toReal(t.cents),
    conta: nameOf(t.acctId)
  }));
  const cartoes = accounts.filter(a => a.kind === "cartao").map(a => {
    const inv = cardInvoiceNet(cur, a.id);
    return {
      nome: a.name,
      gastosNaFatura: toReal(inv.gasto),
      pagamentosRecebidos: toReal(inv.paid),
      emAberto: toReal(inv.net),
      limite: toReal(a.limit || 0),
      pctDoLimiteUsado: a.limit > 0 ? Math.round(inv.net / a.limit * 100) : null
    };
  }).filter(c => c.gastosNaFatura > 0 || c.emAberto > 0 || c.pagamentosRecebidos > 0);
  const contas = accounts.filter(a => a.kind === "conta").map(a => ({
    nome: a.name,
    entrou: toReal(cur.filter(t => t.type === "ganho" && t.acctId === a.id).reduce((s, t) => s + t.cents, 0)),
    saiu: toReal(cur.filter(t => t.type === "gasto" && t.acctId === a.id).reduce((s, t) => s + t.cents, 0))
  })).filter(c => c.entrou > 0 || c.saiu > 0);
  const trf = cur.filter(t => t.type === "transferencia");
  const transferencias = {
    quantidade: trf.length,
    volume: toReal(trf.reduce((s, t) => s + t.cents, 0)),
    pagamentosDeFatura: trf.filter(t => accounts.find(a => a.id === t.toAcctId)?.kind === "cartao").map(t => ({
      data: t.date,
      valor: toReal(t.cents),
      cartao: nameOf(t.toAcctId),
      origem: nameOf(t.acctId)
    }))
  };
  const previstos = txs.filter(t => !isRealized(t) && txEffectiveMonth(t, accounts) === mk);
  const aindaNaoPagos = previstos.filter(t => t.type === "gasto").map(t => ({
    data: t.date,
    descricao: (t.description || "").trim() || t.category,
    valor: toReal(t.cents)
  })).sort((a, b) => a.data < b.data ? -1 : 1).slice(0, 8);
  const orcamentos = (budgetRows || []).filter(r => r.limit > 0).map(r => ({
    categoria: r.cat,
    limite: toReal(r.limit),
    gasto: toReal(r.spent),
    pctUsado: Math.round(r.pct * 100),
    situacao: r.status === "over" ? "estourado" : r.status === "warn" ? "perto do limite" : "dentro do limite"
  }));

  // média dos 3 meses anteriores, para dizer se o mês foi fora da curva ou só normal
  const ultimos = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(monthDate.getFullYear(), monthDate.getMonth() - i, 1);
    const b = (monthIndex || {})[mkOf(d)];
    if (b) ultimos.push({
      mes: mkOf(d),
      entradas: toReal(b.entradas),
      saidas: toReal(b.saidas),
      investido: toReal(b.investido)
    });
  }
  const base = ultimos.slice(0, 3);
  const mediaSaidas = base.length ? base.reduce((s, m) => s + m.saidas, 0) / base.length : 0;
  const mediaEntradas = base.length ? base.reduce((s, m) => s + m.entradas, 0) / base.length : 0;
  const diasNoMes = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const hojeNoMes = mkOf(new Date()) === mk;
  const diasCorridos = hojeNoMes ? new Date().getDate() : diasNoMes;
  const recorrentes = detectRecurringCandidates(txs, new Date()).slice(0, 6);
  return {
    mes: mk,
    mesAnterior: prevMk,
    mesEmAndamento: hojeNoMes,
    diasCorridos,
    diasNoMes,
    totais: {
      entradas: toReal(curIn),
      saidas: toReal(curOut),
      investido: toReal(curInv),
      saldo: toReal(curIn - curOut - curInv),
      taxaDePoupancaPct: curIn > 0 ? Math.round((curIn - curOut - curInv) / curIn * 100) : null,
      gastoMedioPorDia: diasCorridos > 0 ? toReal(Math.round(curOut / diasCorridos)) : 0,
      quantidadeDeLancamentos: cur.length
    },
    comparacaoMesAnterior: {
      entradas: toReal(prvIn),
      saidas: toReal(prvOut),
      investido: toReal(prvInv),
      variacaoEntradasPct: pctDiff(curIn, prvIn),
      variacaoSaidasPct: pctDiff(curOut, prvOut),
      variacaoInvestidoPct: pctDiff(curInv, prvInv)
    },
    mediaTresMesesAnteriores: {
      entradas: Number(mediaEntradas.toFixed(2)),
      saidas: Number(mediaSaidas.toFixed(2))
    },
    historicoRecente: ultimos,
    categorias,
    categoriasQueSumiram,
    maioresGastos,
    cartoes,
    contas,
    transferencias,
    orcamentos,
    aindaNaoPagos,
    recorrentesSuspeitos: recorrentes
  };
}

/* instruções de estilo compartilhadas por resumo do mês e recaps — é o que separa um parágrafo
   genérico ("seus gastos aumentaram") de uma análise que cita a categoria, o valor e a causa. */
const AI_SUMMARY_STYLE = `Escreva em português do Brasil, na segunda pessoa ("você"), tom direto de quem entende de finanças pessoais e fala como gente — sem jargão, sem motivacional, sem emoji.

REGRAS:
- Use SOMENTE os números do JSON. Nunca invente valor, categoria ou lançamento que não esteja lá.
- Sempre que citar um número, dê o contexto: quanto foi, quanto era antes, quantos por cento mudou.
- Prefira a causa concreta ("Lazer subiu 62% por causa dos R$ 380 do dia 12") ao efeito genérico ("os gastos aumentaram").
- Se o mês ainda está em andamento (mesEmAndamento = true), fale em ritmo e projeção, não em fechamento.
- Se faltar dado para alguma seção, diga isso em uma linha em vez de encher linguiça.
- Valores em reais no formato R$ 1.234,56.

FORMATO DA RESPOSTA (use exatamente estes títulos, com "## " na frente, e "- " nos itens):
## O essencial
Dois ou três períodos com o veredito do mês: sobrou ou faltou, e por quê.
## Para onde foi o dinheiro
3 a 5 itens com as maiores categorias, o quanto representam do total e o lançamento que puxou cada uma.
## O que mudou
3 a 4 itens comparando com o mês anterior e com a média dos últimos meses — só o que mudou de verdade (variação relevante), incluindo o que caiu.
## Pontos de atenção
2 a 4 itens: orçamento estourado, fatura de cartão alta em relação ao limite, conta prevista ainda não paga, assinatura suspeita, gasto fora da curva.
## O que fazer agora
Exatamente 3 ações concretas e específicas, cada uma com o número que a justifica.`;
function Balanco({
  grouped,
  monthLabel,
  totals,
  prevTotals,
  sparkline,
  plannedTotal,
  alerts,
  byCatChart,
  acctName,
  txs,
  view,
  accounts,
  onSelectMonth,
  update,
  isDesktop,
  onEditMobile,
  monthIndex,
  categoryMemory,
  hourlyWageCents,
  budgetRows,
  aiModel,
  pendingFilter,
  onConsumePendingFilter
}) {
  // Fase 4: busca + filtros combináveis, unificando também os filtros por clique nos gráficos (categoria/tipo).
  // Passam a valer em todos os meses (não só o exibido) — exceto quando um intervalo de datas é definido.
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    accounts: [],
    types: [],
    categories: [],
    tags: [],
    dateFrom: "",
    dateTo: "",
    status: "",
    valueMin: "",
    valueMax: ""
  });
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // filtro chegado de outra aba (ex: clique numa categoria no Panorama) — aplica uma vez e avisa o
  // App pra descartá-lo, senão reabrir o Balanço do zero reaplicaria o mesmo filtro de novo
  useEffect(() => {
    if (!pendingFilter) return;
    if (pendingFilter.category) setFilters(f => ({
      ...f,
      categories: [pendingFilter.category]
    }));else if (pendingFilter.tag) setFilters(f => ({
      ...f,
      tags: [pendingFilter.tag]
    }));
    onConsumePendingFilter && onConsumePendingFilter();
  }, [pendingFilter]);
  const [aiSummary, setAiSummary] = useState("");
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState("");
  const [inlineEditTx, setInlineEditTx] = useState(null);
  useEffect(() => {
    setAiSummary("");
    setAiSummaryError("");
  }, [monthLabel]);
  const [inlinePropagateIds, setInlinePropagateIds] = useState([]);
  function requestEdit(t) {
    function proceed(propagateIds) {
      if (isDesktop) {
        setInlineEditTx(t);
        setInlinePropagateIds(propagateIds);
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      } else onEditMobile(t, propagateIds);
    }
    if (t.seriesId) {
      askSeriesScope({
        tx: t,
        txs,
        action: "editar",
        onChoice: ids => proceed(ids.filter(id => id !== t.id))
      });
      return;
    }
    proceed([]);
  }

  // exclusão de lançamento: some da tela na hora (linha + totais do mês), com "Desfazer" por 6s antes de gravar de
  // verdade. Suporta excluir vários de uma vez (série de recorrência/parcelamento) com o mesmo mecanismo.
  const [pendingDeleteIds, setPendingDeleteIds] = useState(() => new Set());
  const pendingTimers = useRef(new Map());
  const pendingTxs = useRef(new Map()); // id -> lançamento, só para recalcular os totais exibidos enquanto pendente
  useEffect(() => () => {
    pendingTimers.current.forEach(t => clearTimeout(t));
  }, []);
  function doRequestDelete(ids, primaryTx) {
    setPendingDeleteIds(prev => {
      const n = new Set(prev);
      ids.forEach(id => n.add(id));
      return n;
    });
    ids.forEach(id => {
      const found = txs.find(x => x.id === id);
      if (found) pendingTxs.current.set(id, found);
    });
    const timer = setTimeout(() => {
      update(d => ({
        transactions: d.transactions.filter(x => !ids.includes(x.id))
      }));
      ids.forEach(id => {
        pendingTimers.current.delete(id);
        pendingTxs.current.delete(id);
      });
      setPendingDeleteIds(prev => {
        const n = new Set(prev);
        ids.forEach(id => n.delete(id));
        return n;
      });
    }, 6000);
    ids.forEach(id => pendingTimers.current.set(id, timer));
    if (inlineEditTx && ids.includes(inlineEditTx.id)) setInlineEditTx(null);
    const label = ids.length > 1 ? `${ids.length} lançamentos excluídos.` : `"${primaryTx.description || primaryTx.category || TYPES[primaryTx.type].label}" excluído.`;
    toast(label, "default", {
      duration: 6000,
      action: {
        label: "Desfazer",
        onClick: () => {
          clearTimeout(timer);
          ids.forEach(id => {
            pendingTimers.current.delete(id);
            pendingTxs.current.delete(id);
          });
          setPendingDeleteIds(prev => {
            const n = new Set(prev);
            ids.forEach(id => n.delete(id));
            return n;
          });
        }
      }
    });
  }
  function requestDelete(t) {
    if (t.seriesId) {
      askSeriesScope({
        tx: t,
        txs,
        action: "excluir",
        onChoice: ids => doRequestDelete(ids, t)
      });
      return;
    }
    doRequestDelete([t.id], t);
  }
  function markAsPaid(t) {
    update(d => ({
      transactions: d.transactions.map(x => x.id === t.id ? {
        ...x,
        status: "realizado"
      } : x)
    }));
    toast("Marcado como pago.", "success");
  }
  async function generateSummary() {
    setAiSummaryBusy(true);
    setAiSummaryError("");
    setAiSummary("");
    try {
      const briefing = buildMonthlyBriefing({
        txs,
        accounts,
        monthDate: view,
        monthIndex,
        budgetRows
      });
      const prompt = `Você é o analista financeiro pessoal de quem usa este app. Abaixo está o dossiê COMPLETO do mês de ${monthLabel}, em JSON, já calculado a partir dos lançamentos reais (valores em reais).

${JSON.stringify(briefing)}

${AI_SUMMARY_STYLE}`;
      const text = await callGemini({
        prompt,
        model: aiModelId(aiModel)
      });
      setAiSummary(text.trim());
    } catch (err) {
      setAiSummaryError(err.message || "Não foi possível gerar o resumo.");
    } finally {
      setAiSummaryBusy(false);
    }
  }
  const evo = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(view.getFullYear(), view.getMonth() - i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = monthIndex[mk] || {
        entradas: 0,
        saidas: 0
      };
      arr.push({
        name: d.toLocaleDateString("pt-BR", {
          month: "short"
        }).replace(".", ""),
        bars: [{
          v: b.entradas / 100,
          color: "var(--pos)"
        }, {
          v: b.saidas / 100,
          color: "var(--neg)"
        }],
        date: d
      });
    }
    return arr;
  }, [monthIndex, view]);
  const hasEvo = evo.some(m => m.bars.some(b => b.v > 0));
  const activeEvoIdx = evo.findIndex(e => e.date.getFullYear() === view.getFullYear() && e.date.getMonth() === view.getMonth());
  const typeOrder = ["ganho", "gasto", "investimento"];
  const toggleInArray = (key, value) => setFilters(f => ({
    ...f,
    [key]: f[key].includes(value) ? f[key].filter(v => v !== value) : [...f[key], value]
  }));
  const toggleCat = name => toggleInArray("categories", name);
  const toggleType = i => toggleInArray("types", typeOrder[i]);
  // clique no gráfico de barras só acende o destaque quando o filtro de tipo resultante é exatamente aquele
  const typeActiveIdx = filters.types.length === 1 ? typeOrder.indexOf(filters.types[0]) === -1 ? null : typeOrder.indexOf(filters.types[0]) : null;
  const catSelected = filters.categories.length === 1 ? filters.categories[0] : null;
  const allCategories = Object.keys(CAT_COLOR);
  const allTags = useMemo(() => {
    const set = new Set();
    txs.forEach(t => extractTags(t.description).forEach(tg => set.add(tg)));
    return [...set].sort();
  }, [txs]);
  const hasActiveFilters = search.trim() !== "" || filters.accounts.length > 0 || filters.types.length > 0 || filters.categories.length > 0 || filters.tags.length > 0 || !!filters.dateFrom || !!filters.dateTo || !!filters.status || !!filters.valueMin || !!filters.valueMax;
  const activeFilterCount = filters.accounts.length + filters.types.length + filters.categories.length + filters.tags.length + (filters.dateFrom || filters.dateTo ? 1 : 0) + (filters.status ? 1 : 0) + (filters.valueMin || filters.valueMax ? 1 : 0);
  // busca/filtros valem pra todo o histórico (txs é a lista completa, não só o mês exibido)
  const searchResults = useMemo(() => {
    if (!hasActiveFilters) return null;
    const q = search.trim().toLowerCase();
    const isTagQ = q.startsWith("#") && q.length > 1;
    const tagQ = isTagQ ? q.slice(1) : "";
    const minCents = filters.valueMin !== "" ? Math.round(parseFloat(filters.valueMin.replace(",", ".")) * 100) : null;
    const maxCents = filters.valueMax !== "" ? Math.round(parseFloat(filters.valueMax.replace(",", ".")) * 100) : null;
    return txs.filter(t => {
      if (q) {
        const desc = (t.description || "").toLowerCase();
        if (isTagQ) {
          if (!desc.includes("#" + tagQ)) return false;
        } else if (!desc.includes(q) && !(t.category || "").toLowerCase().includes(q)) return false;
      }
      if (filters.accounts.length && !filters.accounts.includes(t.acctId) && !(t.toAcctId && filters.accounts.includes(t.toAcctId))) return false;
      if (filters.types.length && !filters.types.includes(t.type)) return false;
      if (filters.categories.length && !filters.categories.includes(t.category)) return false;
      if (filters.tags.length) {
        const tTags = extractTags(t.description);
        if (!filters.tags.some(tg => tTags.includes(tg))) return false;
      }
      if (filters.dateFrom && t.date < filters.dateFrom) return false;
      if (filters.dateTo && t.date > filters.dateTo) return false;
      if (filters.status && (filters.status === "previsto" ? isRealized(t) : !isRealized(t))) return false;
      if (minCents != null && !isNaN(minCents) && t.cents < minCents) return false;
      if (maxCents != null && !isNaN(maxCents) && t.cents > maxCents) return false;
      return true;
    }).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id));
  }, [hasActiveFilters, search, filters, txs]);
  const searchSummary = useMemo(() => {
    if (!searchResults) return null;
    let sum = 0;
    searchResults.forEach(t => {
      sum += t.cents * TYPES[t.type].sign;
    });
    return {
      count: searchResults.length,
      sum
    };
  }, [searchResults]);
  const searchGrouped = useMemo(() => {
    if (!searchResults) return null;
    const g = {};
    searchResults.forEach(t => {
      (g[t.date] = g[t.date] || []).push(t);
    });
    return g;
  }, [searchResults]);
  const baseGrouped = hasActiveFilters ? searchGrouped || {} : grouped;
  // versão exibida: some da tela imediatamente os lançamentos com exclusão pendente (janela de "Desfazer")
  const displayGrouped = useMemo(() => {
    if (pendingDeleteIds.size === 0) return baseGrouped;
    const out = {};
    Object.entries(baseGrouped).forEach(([d, list]) => {
      const f = list.filter(t => !pendingDeleteIds.has(t.id));
      if (f.length) out[d] = f;
    });
    return out;
  }, [baseGrouped, pendingDeleteIds]);
  const displayTotals = useMemo(() => {
    if (pendingDeleteIds.size === 0) return totals;
    let {
      inc,
      exp,
      inv,
      previstoInc,
      previstoExp,
      previstoInv
    } = totals;
    pendingDeleteIds.forEach(id => {
      const t = pendingTxs.current.get(id);
      if (!t) return;
      const real = isRealized(t);
      if (t.type === "ganho") {
        if (real) inc -= t.cents;else previstoInc -= t.cents;
      } else if (t.type === "gasto") {
        if (real) exp -= t.cents;else previstoExp -= t.cents;
      } else if (t.type === "investimento") {
        if (real) inv -= t.cents;else previstoInv -= t.cents;
      }
    });
    return {
      inc,
      exp,
      inv,
      saldo: inc - exp - inv,
      previstoInc,
      previstoExp,
      previstoInv,
      previstoSaldo: previstoInc - previstoExp - previstoInv
    };
  }, [totals, pendingDeleteIds]);
  // relatório de #tags dentro da categoria filtrada (soma gasta por tag, extraída da descrição) — só quando
  // exatamente uma categoria está selecionada, sempre com base no mês exibido (o gráfico é do mês)
  const tagBreakdown = useMemo(() => {
    if (filters.categories.length !== 1) return [];
    const catName = filters.categories[0];
    const sums = {};
    Object.values(grouped).flat().forEach(t => {
      if (t.type !== "gasto" || t.category !== catName) return;
      extractTags(t.description).forEach(tg => {
        sums[tg] = (sums[tg] || 0) + t.cents;
      });
    });
    return Object.entries(sums).sort((a, b) => b[1] - a[1]).map(([tag, cents]) => ({
      tag,
      cents
    }));
  }, [filters.categories, grouped]);
  // chips removíveis: uma entrada por dimensão de filtro ativa (inclusive as vindas de clique no gráfico)
  const activeChips = useMemo(() => {
    const chips = [];
    if (search.trim()) chips.push({
      key: "q",
      label: `Busca: "${search.trim()}"`,
      onRemove: () => setSearch("")
    });
    filters.accounts.forEach(id => {
      const a = accounts.find(x => x.id === id);
      chips.push({
        key: "acc" + id,
        label: a ? a.name : "Conta",
        onRemove: () => toggleInArray("accounts", id)
      });
    });
    filters.types.forEach(ty => chips.push({
      key: "ty" + ty,
      label: TYPES[ty].label,
      onRemove: () => toggleInArray("types", ty)
    }));
    filters.categories.forEach(c => chips.push({
      key: "cat" + c,
      label: c,
      onRemove: () => toggleInArray("categories", c)
    }));
    filters.tags.forEach(tg => chips.push({
      key: "tag" + tg,
      label: "#" + tg,
      onRemove: () => toggleInArray("tags", tg)
    }));
    if (filters.dateFrom || filters.dateTo) {
      chips.push({
        key: "date",
        label: `${filters.dateFrom ? fmtDateBR(filters.dateFrom) : "início"} – ${filters.dateTo ? fmtDateBR(filters.dateTo) : "hoje"}`,
        onRemove: () => setFilters(f => ({
          ...f,
          dateFrom: "",
          dateTo: ""
        }))
      });
    }
    if (filters.status) chips.push({
      key: "status",
      label: filters.status === "previsto" ? "Previsto" : "Realizado",
      onRemove: () => setFilters(f => ({
        ...f,
        status: ""
      }))
    });
    if (filters.valueMin || filters.valueMax) {
      chips.push({
        key: "value",
        label: `${filters.valueMin ? "R$ " + filters.valueMin : "R$ 0"} – ${filters.valueMax ? "R$ " + filters.valueMax : "∞"}`,
        onRemove: () => setFilters(f => ({
          ...f,
          valueMin: "",
          valueMax: ""
        }))
      });
    }
    return chips;
  }, [search, filters, accounts]);
  function clearAllFilters() {
    setSearch("");
    setFilters({
      accounts: [],
      types: [],
      categories: [],
      tags: [],
      dateFrom: "",
      dateTo: "",
      status: "",
      valueMin: "",
      valueMax: ""
    });
  }
  const pctChange = prevTotals.saldo !== 0 ? (displayTotals.saldo - prevTotals.saldo) / Math.abs(prevTotals.saldo) * 100 : displayTotals.saldo > 0 ? 100 : 0;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "dashtop"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "herotop"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, "Saldo do mês"), /*#__PURE__*/React.createElement("div", {
    className: "bal num " + (displayTotals.saldo >= 0 ? "pos" : "neg")
  }, brl(displayTotals.saldo)), (displayTotals.previstoInc !== 0 || displayTotals.previstoExp !== 0 || displayTotals.previstoInv !== 0) && /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      fontSize: 12,
      color: "var(--text-mut)",
      marginTop: -12,
      marginBottom: 4
    }
  }, "previsto: ", brl(displayTotals.previstoSaldo))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "heropct " + (displayTotals.saldo >= prevTotals.saldo ? "up" : "down")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: displayTotals.saldo >= prevTotals.saldo ? "seta-direita" : "seta-esquerda",
    size: 11,
    style: {
      transform: displayTotals.saldo >= prevTotals.saldo ? "rotate(-90deg)" : "rotate(90deg)"
    }
  }), Math.abs(pctChange).toFixed(0), "% vs. mês anterior"), /*#__PURE__*/React.createElement(Sparkline, {
    data: sparkline
  }))), /*#__PURE__*/React.createElement("div", {
    className: "stats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 12
  }), "Entradas"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--pos)"
    }
  }, brl(displayTotals.inc))), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "enviar",
    size: 12
  }), "Saídas"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--neg)"
    }
  }, brl(displayTotals.exp))), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "investimentos",
    size: 12
  }), "Investido"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--inv)"
    }
  }, brl(displayTotals.inv))))), /*#__PURE__*/React.createElement(TransactionForm, {
    accounts: accounts,
    txs: txs,
    update: update,
    editTx: inlineEditTx,
    propagateIds: inlinePropagateIds,
    onDone: () => {
      setInlineEditTx(null);
      setInlinePropagateIds([]);
    },
    categoryMemory: categoryMemory,
    key: inlineEditTx ? inlineEditTx.id : "new"
  })), (displayTotals.inc > 0 || displayTotals.exp > 0 || displayTotals.inv > 0) && /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Análise do mês ", /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: generateSummary,
    disabled: aiSummaryBusy
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 14
  }), aiSummaryBusy ? "Analisando…" : aiSummary ? "Refazer" : "Gerar com IA")), aiSummaryBusy && /*#__PURE__*/React.createElement("div", {
    className: "aithink"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aiorb"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("span", {
    className: "core"
  })), /*#__PURE__*/React.createElement("div", {
    className: "aibody"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aititle"
  }, /*#__PURE__*/React.createElement("span", null, "Cruzando os números do mês", /*#__PURE__*/React.createElement("span", {
    className: "aidots"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "aiphase"
  }, "Comparando com o mês anterior, categorias, cartões, orçamentos e contas previstas."), /*#__PURE__*/React.createElement("div", {
    className: "aibar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: "100%",
      opacity: .25
    }
  }), /*#__PURE__*/React.createElement("span", null)))), aiSummary && /*#__PURE__*/React.createElement(RichAI, {
    text: aiSummary
  }), aiSummaryError && /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      color: "var(--neg)"
    }
  }, aiSummaryError), !aiSummary && !aiSummaryBusy && !aiSummaryError && /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Uma análise completa do mês: para onde o dinheiro foi, o que mudou em relação ao mês passado, o que merece atenção e três ações concretas — tudo calculado a partir dos seus lançamentos, cartões e orçamentos.")), plannedTotal > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Planejado × Realizado ", /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 14,
      fontWeight: 500
    }
  }, brl(displayTotals.exp), " / ", brl(plannedTotal))), /*#__PURE__*/React.createElement(ProgressBar, {
    spent: displayTotals.exp,
    limit: plannedTotal,
    status: displayTotals.exp > plannedTotal ? "over" : "ok"
  })), alerts.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 0,
      gridColumn: "1/-1"
    }
  }, alerts.map(a => /*#__PURE__*/React.createElement("div", {
    key: a.cat,
    className: "alert " + a.status
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alerta",
    size: 16
  }), /*#__PURE__*/React.createElement("span", null, a.status === "over" ? /*#__PURE__*/React.createElement(React.Fragment, null, "Você ultrapassou o orçamento de ", /*#__PURE__*/React.createElement("b", null, a.cat), " — ", brl(a.spent), " de ", brl(a.limit), ".") : /*#__PURE__*/React.createElement(React.Fragment, null, "Já usou ", Math.round(a.pct * 100), "% do orçamento de ", /*#__PURE__*/React.createElement("b", null, a.cat), " (", brl(a.spent), " de ", brl(a.limit), ")."))))), /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Buscar e filtrar ", /*#__PURE__*/React.createElement(HelpIcon, {
    section: "busca-filtros"
  })), /*#__PURE__*/React.createElement("div", {
    className: "searchbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "searchfield"
  }, /*#__PURE__*/React.createElement("span", {
    className: "searchicon"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "buscar",
    size: 16
  })), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Buscar por descrição ou #tag…",
    value: search,
    onChange: e => setSearch(e.target.value)
  }), search && /*#__PURE__*/React.createElement("button", {
    className: "clearbtn",
    "aria-label": "Limpar busca",
    onClick: () => setSearch("")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "fechar",
    size: 14
  }))), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => setFilterSheetOpen(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "filtro",
    size: 14
  }), "Filtros", activeFilterCount > 0 ? ` (${activeFilterCount})` : "")), activeChips.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "chiprow"
  }, activeChips.map(c => /*#__PURE__*/React.createElement("div", {
    className: "filterchip",
    key: c.key
  }, /*#__PURE__*/React.createElement("span", null, c.label), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Remover filtro",
    onClick: c.onRemove
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "fechar",
    size: 12
  })))), /*#__PURE__*/React.createElement("button", {
    className: "clearall",
    onClick: clearAllFilters
  }, "Limpar tudo")), hasActiveFilters && searchSummary && /*#__PURE__*/React.createElement("div", {
    className: "resultsum"
  }, searchSummary.count, " resultado", searchSummary.count !== 1 ? "s" : "", " encontrado", searchSummary.count !== 1 ? "s" : "", " · soma: ", /*#__PURE__*/React.createElement("span", {
    className: "num"
  }, brl(searchSummary.sum)))), /*#__PURE__*/React.createElement(Sheet, {
    open: filterSheetOpen,
    onClose: () => setFilterSheetOpen(false),
    title: "Filtros"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 8
    }
  }, "Conta"), /*#__PURE__*/React.createElement("div", {
    className: "chips",
    style: {
      marginBottom: 18
    }
  }, accounts.map(a => /*#__PURE__*/React.createElement("button", {
    key: a.id,
    type: "button",
    className: "chip" + (filters.accounts.includes(a.id) ? " on" : ""),
    onClick: () => toggleInArray("accounts", a.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "swatch",
    style: {
      background: a.color
    }
  }), a.name))), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 8
    }
  }, "Tipo"), /*#__PURE__*/React.createElement("div", {
    className: "chips",
    style: {
      marginBottom: 18
    }
  }, Object.entries(TYPES).map(([k, v]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    type: "button",
    className: "chip" + (filters.types.includes(k) ? " on" : ""),
    onClick: () => toggleInArray("types", k)
  }, v.label))), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 8
    }
  }, "Categoria"), /*#__PURE__*/React.createElement("div", {
    className: "chips",
    style: {
      marginBottom: 18,
      maxHeight: 180,
      overflowY: "auto"
    }
  }, allCategories.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    type: "button",
    className: "chip" + (filters.categories.includes(c) ? " on" : ""),
    onClick: () => toggleInArray("categories", c)
  }, c))), allTags.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 8
    }
  }, "Tags"), /*#__PURE__*/React.createElement("div", {
    className: "chips",
    style: {
      marginBottom: 18,
      maxHeight: 140,
      overflowY: "auto"
    }
  }, allTags.map(tg => /*#__PURE__*/React.createElement("button", {
    key: tg,
    type: "button",
    className: "chip" + (filters.tags.includes(tg) ? " on" : ""),
    onClick: () => toggleInArray("tags", tg)
  }, "#", tg)))), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 8
    }
  }, "Status"), /*#__PURE__*/React.createElement("div", {
    className: "chips",
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "chip" + (filters.status === "" ? " on" : ""),
    onClick: () => setFilters(f => ({
      ...f,
      status: ""
    }))
  }, "Todos"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "chip" + (filters.status === "realizado" ? " on" : ""),
    onClick: () => setFilters(f => ({
      ...f,
      status: "realizado"
    }))
  }, "Realizado"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "chip" + (filters.status === "previsto" ? " on" : ""),
    onClick: () => setFilters(f => ({
      ...f,
      status: "previsto"
    }))
  }, "Previsto")), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 8
    }
  }, "Intervalo de datas"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "date",
    value: filters.dateFrom,
    onChange: e => setFilters(f => ({
      ...f,
      dateFrom: e.target.value
    }))
  }), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "date",
    value: filters.dateTo,
    onChange: e => setFilters(f => ({
      ...f,
      dateTo: e.target.value
    }))
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 8
    }
  }, "Faixa de valor (R$)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "0",
    step: "0.01",
    placeholder: "Mínimo",
    value: filters.valueMin,
    onChange: e => setFilters(f => ({
      ...f,
      valueMin: e.target.value
    }))
  }), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "0",
    step: "0.01",
    placeholder: "Máximo",
    value: filters.valueMax,
    onChange: e => setFilters(f => ({
      ...f,
      valueMax: e.target.value
    }))
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: () => setFilters({
      accounts: [],
      types: [],
      categories: [],
      tags: [],
      dateFrom: "",
      dateTo: "",
      status: "",
      valueMin: "",
      valueMax: ""
    })
  }, "Limpar filtros"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: () => setFilterSheetOpen(false)
  }, "Concluído"))), hasActiveFilters ? Object.keys(displayGrouped).length === 0 && /*#__PURE__*/React.createElement(EmptyState, {
    icon: "filtro",
    title: "Nenhum resultado",
    text: "Nenhum lançamento corresponde à busca ou aos filtros aplicados.",
    action: {
      label: "Ver no manual",
      onClick: () => openHelp("busca-filtros")
    }
  }) : Object.keys(grouped).length === 0 && /*#__PURE__*/React.createElement(EmptyState, {
    icon: "documento",
    title: `Nenhum lançamento em ${monthLabel}`,
    text: isDesktop ? "Preencha o formulário aqui em cima para registrar um lançamento — ou mande de uma vez os PDFs do banco e do cartão e deixe a IA preencher tudo." : "Toque no botão + para registrar um lançamento — ou mande de uma vez os PDFs do banco e do cartão e deixe a IA preencher tudo.",
    action: {
      label: "Importar extratos e faturas",
      icon: "brilho",
      onClick: () => goToTab("extrato")
    },
    secondary: {
      label: "Ver no manual",
      onClick: () => openHelp("registrar-lancamentos")
    }
  }), Object.entries(displayGrouped).map(([d, list]) => {
    const dayTotal = list.reduce((s, t) => s + t.cents * TYPES[t.type].sign, 0);
    return /*#__PURE__*/React.createElement("div", {
      className: "daygroup",
      key: d
    }, /*#__PURE__*/React.createElement("div", {
      className: "dayhead"
    }, /*#__PURE__*/React.createElement("span", null, new Date(d + "T00:00:00").toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      ...(hasActiveFilters ? {
        year: "2-digit"
      } : {})
    })), /*#__PURE__*/React.createElement("span", {
      className: "num"
    }, dayTotal >= 0 ? "+" : "−", " ", brlNum(Math.abs(dayTotal)))), list.map(t => {
      const cls = TYPES[t.type].cls,
        acc = acctName(t.acctId);
      const isTrf = t.type === "transferencia";
      const flowMk = txEffectiveMonth(t, accounts),
        shifted = t.type === "gasto" && flowMk !== monthKey(t.date);
      const flowLabel = shifted ? shortMonthLabel(new Date(flowMk + "-01T00:00:00")) : null;
      return /*#__PURE__*/React.createElement(TxRow, {
        key: t.id,
        t: t,
        cls: cls,
        acc: acc,
        isTrf: isTrf,
        shifted: shifted,
        flowLabel: flowLabel,
        acctName: acctName,
        hourlyWageCents: hourlyWageCents,
        onEdit: () => requestEdit(t),
        onDelete: () => requestDelete(t),
        onMarkPaid: () => markAsPaid(t),
        onTagClick: tg => toggleInArray("tags", tg)
      });
    }));
  }), hasEvo && /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Evolução (6 meses)"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, "Clique em um mês para navegar até ele."), /*#__PURE__*/React.createElement("div", {
    className: "chlegend"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
    style: {
      background: "var(--pos)"
    }
  }), "Entradas"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
    style: {
      background: "var(--neg)"
    }
  }), "Saídas")), /*#__PURE__*/React.createElement(BarGroups, {
    data: evo,
    onSelect: onSelectMonth ? i => onSelectMonth(evo[i].date) : undefined,
    activeIndex: activeEvoIdx
  })), (totals.inc > 0 || totals.exp > 0 || totals.inv > 0) && /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Entradas × Saídas × Investido"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, "Clique em uma barra para filtrar o mês por tipo."), /*#__PURE__*/React.createElement(BarGroups, {
    data: [{
      name: "Entradas",
      bars: [{
        v: totals.inc / 100,
        color: "var(--pos)"
      }]
    }, {
      name: "Saídas",
      bars: [{
        v: totals.exp / 100,
        color: "var(--neg)"
      }]
    }, {
      name: "Investido",
      bars: [{
        v: totals.inv / 100,
        color: "var(--inv)"
      }]
    }],
    onSelect: toggleType,
    activeIndex: typeActiveIdx
  })), byCatChart.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Gastos por categoria"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, "Clique numa categoria para filtrar os lançamentos do mês."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Donut, {
    data: byCatChart,
    onSelect: toggleCat,
    selected: catSelected,
    centerLabel: "gastos"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 180
    }
  }, /*#__PURE__*/React.createElement(Legend, {
    data: byCatChart,
    onSelect: toggleCat,
    selected: catSelected
  }))), tagBreakdown.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      paddingTop: 14,
      borderTop: "1px solid var(--surface-2)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 6
    }
  }, "#tags dentro de ", filters.categories[0], " em ", monthLabel), tagBreakdown.map(tg => /*#__PURE__*/React.createElement("div", {
    className: "kv",
    key: tg.tag
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "#", tg.tag), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, brl(tg.cents)))))), totals.inc > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Fluxo do mês"), /*#__PURE__*/React.createElement(MonthFlow, {
    totals: totals,
    byCatChart: byCatChart,
    monthLabel: monthLabel
  })));
}
Balanco = React.memo(Balanco); // evita re-renderizar a aba inteira quando o App re-renderiza por motivo alheio (tema, menu, scroll…)

function Sparkline({
  data,
  w = 100,
  h = 40
}) {
  const gradId = "sparkgrad-" + useId(); // id único por instância — duas sparklines na mesma tela não podem colidir
  if (!data || data.length < 2) return null;
  const min = Math.min(...data, 0),
    max = Math.max(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - (v - min) / range * h]);
  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = line + ` L${w},${h} L0,${h} Z`;
  const up = data[data.length - 1] >= data[0];
  const color = up ? "var(--pos)" : "var(--neg)";
  return /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: h,
    className: "herospark",
    viewBox: `0 0 ${w} ${h}`
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: gradId,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: color,
    stopOpacity: "0.35"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: color,
    stopOpacity: "0"
  }))), /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: `url(#${gradId})`,
    stroke: "none"
  }), /*#__PURE__*/React.createElement("path", {
    d: line,
    fill: "none",
    stroke: color,
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }));
}
function TxRow({
  t,
  cls,
  acc,
  isTrf,
  shifted,
  flowLabel,
  acctName,
  onEdit,
  onDelete,
  onMarkPaid,
  onTagClick,
  hourlyWageCents
}) {
  const [swiped, setSwiped] = useState(false);
  const startX = useRef(null);
  function onTouchStart(e) {
    startX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e) {
    if (startX.current == null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (dx < -40) setSwiped(true);else if (dx > 40) setSwiped(false);
    startX.current = null;
  }
  const previsto = !isRealized(t);
  const inSeries = t.seriesTotal > 1;
  const tags = useMemo(() => extractTags(t.description), [t.description]);
  return /*#__PURE__*/React.createElement("div", {
    className: "tx" + (swiped ? " swiped" : "") + (previsto ? " previsto" : ""),
    onTouchStart: onTouchStart,
    onTouchEnd: onTouchEnd
  }, /*#__PURE__*/React.createElement("div", {
    className: "emo " + cls
  }, /*#__PURE__*/React.createElement(Icon, {
    name: isTrf ? "transferencia" : CAT_ICON[t.category] || "outros",
    size: 17
  })), /*#__PURE__*/React.createElement("div", {
    className: "info"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t1"
  }, t.description || (isTrf ? "Transferência" : t.category), previsto && /*#__PURE__*/React.createElement("span", {
    className: "tag warn",
    style: {
      marginLeft: 6
    }
  }, "previsto")), /*#__PURE__*/React.createElement("div", {
    className: "t2"
  }, isTrf ? /*#__PURE__*/React.createElement("span", null, "De ", acctName(t.acctId)?.name || "?", " → ", acctName(t.toAcctId)?.name || "?") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", null, t.description ? t.category : TYPES[t.type].label), acc && /*#__PURE__*/React.createElement("span", {
    className: "acc"
  }, /*#__PURE__*/React.createElement("i", {
    className: "dot",
    style: {
      background: acc.color
    }
  }), acc.name), shifted && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--warn)"
    }
  }, "· fatura ", flowLabel), inSeries && /*#__PURE__*/React.createElement("span", null, "· ", t.seriesIndex + 1, "/", t.seriesTotal))), tags.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "tagrow"
  }, tags.map(tg => onTagClick ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "tagchip clickable",
    key: tg,
    onClick: e => {
      e.stopPropagation();
      onTagClick(tg);
    }
  }, "#", tg) : /*#__PURE__*/React.createElement("span", {
    className: "tagchip",
    key: tg
  }, "#", tg)))), /*#__PURE__*/React.createElement("div", {
    className: "val " + cls
  }, isTrf ? /*#__PURE__*/React.createElement(React.Fragment, null, "↔ ", brlNum(t.cents)) : /*#__PURE__*/React.createElement(React.Fragment, null, TYPES[t.type].sign > 0 ? "+" : "−", " ", brlNum(t.cents)), formatHours(t.cents, hourlyWageCents) && /*#__PURE__*/React.createElement("div", {
    className: "mm",
    style: {
      marginTop: 2,
      textAlign: "right"
    }
  }, "≈ ", formatHours(t.cents, hourlyWageCents))), /*#__PURE__*/React.createElement("div", {
    className: "acts"
  }, previsto && /*#__PURE__*/React.createElement("button", {
    "aria-label": "Marcar como pago",
    onClick: onMarkPaid
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 16
  })), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Editar",
    onClick: onEdit
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "editar",
    size: 16
  })), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Excluir",
    onClick: onDelete
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "excluir",
    size: 16
  }))));
}

/* ---- indicadores do Banco Central (Selic, CDI, IPCA) via API pública do SGS, com cache diário em
   localStorage (dado de mercado, não é dado do usuário — não precisa ir pro backup/Supabase). Uma falha de
   rede aqui não deve incomodar ninguém: o card some silenciosamente em vez de mostrar erro. ---- */
const BCB_CACHE_KEY = "razao_bcb_cache";
async function fetchBcbSeries(code, n) {
  const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${n}?formato=json`);
  if (!res.ok) throw new Error("BCB indisponível");
  return res.json();
}
async function fetchBcbIndicators() {
  const today = todayISO();
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(BCB_CACHE_KEY) || "null");
  } catch (_) {}
  if (cached && cached.date === today) return cached.data;
  const [selic, cdi, ipca] = await Promise.all([fetchBcbSeries(432, 1), fetchBcbSeries(12, 1), fetchBcbSeries(433, 12)]);
  const num = v => parseFloat(String(v).replace(",", "."));
  const data = {
    selic: selic[0] ? num(selic[0].valor) : null,
    cdi: cdi[0] ? num(cdi[0].valor) : null,
    ipca12m: ipca.length ? ipca.reduce((s, x) => s + num(x.valor), 0) : null
  };
  localStorage.setItem(BCB_CACHE_KEY, JSON.stringify({
    date: today,
    data
  }));
  return data;
}
function BcbIndicators() {
  const [state, setState] = useState({
    status: "loading"
  });
  useEffect(() => {
    let alive = true;
    fetchBcbIndicators().then(data => {
      if (alive) setState({
        status: "ok",
        data
      });
    }).catch(err => {
      if (alive) setState({
        status: "err",
        error: err.message
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  if (state.status === "err") return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Indicadores econômicos"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: state.status === "loading" ? 0 : 14
    }
  }, "Fonte: Banco Central (SGS) · cache diário."), state.status === "loading" && /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Carregando…"), state.status === "ok" && /*#__PURE__*/React.createElement(React.Fragment, null, state.data.selic != null && /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Selic (meta)"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, state.data.selic.toFixed(2).replace(".", ","), "% a.a.")), state.data.cdi != null && /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "CDI (diário)"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, state.data.cdi.toFixed(4).replace(".", ","), "%")), state.data.ipca12m != null && /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "IPCA (12 meses)"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, state.data.ipca12m.toFixed(2).replace(".", ","), "%"))));
}

/* ---------- PANORAMA GERAL (consolidado de todos os meses e todas as contas) ---------- */
function Geral({
  txs,
  accounts,
  holdings,
  view,
  onSelectMonth,
  monthIndex,
  update,
  patrimonyHistory,
  recaps,
  aiModel
}) {
  const EMPTY_BUCKET = {
    entradas: 0,
    saidas: 0,
    investido: 0,
    proventos: 0,
    porCategoria: {},
    itens: []
  };
  const monthBucket = mk => monthIndex[mk] || EMPTY_BUCKET;
  // totais de todos os tempos: soma os baldes do índice em vez de re-varrer txs inteiro
  const totals = useMemo(() => {
    let inc = 0,
      exp = 0,
      inv = 0;
    Object.values(monthIndex).forEach(b => {
      inc += b.entradas;
      exp += b.saidas;
      inv += b.investido;
    });
    return {
      inc,
      exp,
      inv,
      saldo: inc - exp - inv
    };
  }, [monthIndex]);

  // saldo por conta: transferências são lançamento em par (debita a origem, credita o destino) em vez de usar o sinal fixo do tipo.
  // só o realizado conta (previsto ainda não aconteceu); soma o saldo inicial da conta por cima.
  // (dimensão por conta, não por mês — continua varrendo txs uma única vez, já é O(n) direto)
  const byAccount = useMemo(() => {
    const m = {};
    txs.filter(isRealized).forEach(t => {
      if (t.type === "transferencia") {
        m[t.acctId] = (m[t.acctId] || 0) - t.cents;
        m[t.toAcctId] = (m[t.toAcctId] || 0) + t.cents;
      } else {
        m[t.acctId] = (m[t.acctId] || 0) + t.cents * TYPES[t.type].sign;
      }
    });
    return accounts.map(a => ({
      ...a,
      balance: (m[a.id] || 0) + (a.openingBalance || 0)
    }));
  }, [txs, accounts]);

  // limite de cartão comprometido: gastos cuja fatura (fechamento/vencimento) cai no mês atual real,
  // menos transferências recebidas por aquele cartão no mesmo período (pagamento da fatura)
  const todayMk = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const cardCommitted = acctId => cardInvoiceNet(monthBucket(todayMk).itens, acctId);
  const fi = useMemo(() => financialIndependence(monthIndex, view), [monthIndex, view]);
  const totCur = holdings.reduce((s, h) => s + h.current, 0);
  const contasBalance = byAccount.filter(a => a.kind === "conta").reduce((s, a) => s + a.balance, 0);
  const patrimonio = contasBalance + totCur;

  // snapshot mensal automático do patrimônio: atualiza o valor do mês corrente sempre que ele mudar (assim o mês
  // fica sempre em dia enquanto está em curso) e nunca mexe nos meses já fechados — isso é o "histórico".
  // Só grava quando o valor realmente muda, pra não gerar um save a cada render.
  const todayMkForSnapshot = useMemo(() => todayISO().slice(0, 7), []);
  useEffect(() => {
    if (accounts.length === 0 && holdings.length === 0) return;
    if ((patrimonyHistory || {})[todayMkForSnapshot] === patrimonio) return;
    update(d => ({
      patrimonyHistory: {
        ...(d.patrimonyHistory || {}),
        [todayMkForSnapshot]: patrimonio
      }
    }));
  }, [patrimonio, todayMkForSnapshot, patrimonyHistory, accounts.length, holdings.length]);
  const patrimonyEvo = useMemo(() => {
    return Object.entries(patrimonyHistory || {}).sort(([a], [b]) => a < b ? -1 : 1).slice(-12).map(([mk, cents]) => {
      const d = new Date(mk + "-01T00:00:00");
      return {
        name: shortMonthLabel(d),
        bars: [{
          v: cents / 100,
          color: cents >= 0 ? "var(--pos)" : "var(--neg)"
        }]
      };
    });
  }, [patrimonyHistory]);

  // contas a pagar / lembretes: lançamentos previstos (ainda não realizados) que vencem nos próximos 7 dias
  // ou já venceram — reaproveita o mesmo campo status:"previsto" já usado no resto do app, sem duplicar dado
  const lembretes = useMemo(() => {
    const today = todayISO();
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() + 7);
    const limitIso = new Date(limitDate.getTime() - limitDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return txs.filter(t => !isRealized(t) && t.type !== "transferencia" && t.date <= limitIso).sort((a, b) => a.date < b.date ? -1 : 1);
  }, [txs]);
  function marcarLembretePago(t) {
    update(d => ({
      transactions: d.transactions.map(x => x.id === t.id ? {
        ...x,
        status: "realizado"
      } : x)
    }));
    toast("Marcado como pago.", "success");
  }

  // recap automático semanal/mensal por IA: ao abrir o Panorama, se a última semana e o último mês já
  // fechados ainda não têm recap gerado (e tiveram movimentação), gera um automaticamente e guarda —
  // não repete depois disso, e uma falha aqui é silenciosa (é um bônus, não deve incomodar ninguém)
  const autoRecapTried = useRef(false);
  useEffect(() => {
    if (autoRecapTried.current) return;
    autoRecapTried.current = true;
    (async () => {
      const today = todayISO();
      const lastWeekKey = weekStartISO(new Date(new Date(today + "T00:00:00").getTime() - 7 * 86400000).toISOString().slice(0, 10));
      const lastWeekEnd = new Date(new Date(lastWeekKey + "T00:00:00").getTime() + 6 * 86400000).toISOString().slice(0, 10);
      if (!(recaps?.weekly || {})[lastWeekKey]) {
        const weekTxs = txs.filter(t => isRealized(t) && t.date >= lastWeekKey && t.date <= lastWeekEnd);
        if (weekTxs.length > 0) {
          const inc = weekTxs.filter(t => t.type === "ganho").reduce((s, t) => s + t.cents, 0);
          const exp = weekTxs.filter(t => t.type === "gasto").reduce((s, t) => s + t.cents, 0);
          const inv = weekTxs.filter(t => t.type === "investimento").reduce((s, t) => s + t.cents, 0);
          try {
            const porCat = {};
            weekTxs.filter(t => t.type === "gasto").forEach(t => {
              porCat[t.category] = (porCat[t.category] || 0) + t.cents;
            });
            const briefing = {
              periodo: {
                de: lastWeekKey,
                ate: lastWeekEnd
              },
              totais: {
                entradas: toReal(inc),
                saidas: toReal(exp),
                investido: toReal(inv),
                saldo: toReal(inc - exp - inv),
                lancamentos: weekTxs.length
              },
              gastoPorCategoria: Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([nome, c]) => ({
                nome,
                valor: toReal(c)
              })),
              maioresGastos: weekTxs.filter(t => t.type === "gasto").sort((a, b) => b.cents - a.cents).slice(0, 5).map(t => ({
                data: t.date,
                descricao: (t.description || "").trim() || t.category,
                categoria: t.category,
                valor: toReal(t.cents)
              })),
              semanaAnterior: (() => {
                const ini = new Date(new Date(lastWeekKey + "T00:00:00").getTime() - 7 * 86400000).toISOString().slice(0, 10);
                const fim = new Date(new Date(lastWeekKey + "T00:00:00").getTime() - 86400000).toISOString().slice(0, 10);
                const ant = txs.filter(t => isRealized(t) && t.date >= ini && t.date <= fim);
                return {
                  de: ini,
                  ate: fim,
                  entradas: toReal(ant.filter(t => t.type === "ganho").reduce((s, t) => s + t.cents, 0)),
                  saidas: toReal(ant.filter(t => t.type === "gasto").reduce((s, t) => s + t.cents, 0))
                };
              })()
            };
            const prompt = `Dossiê da semana financeira encerrada, em JSON (valores em reais):\n\n${JSON.stringify(briefing)}\n\nEscreva um recap da semana em português do Brasil, na segunda pessoa, tom direto e sem jargão. Use SÓ os números do JSON, sem inventar nada. Estrutura: um primeiro parágrafo de 2 a 3 períodos com o veredito da semana (sobrou ou faltou e por quê, comparando com a semana anterior), seguido de 2 a 3 linhas começando com "- " apontando o que puxou o gasto e o que merece atenção na semana que começa. Cite valores no formato R$ 1.234,56.`;
            const text = (await callGemini({
              prompt
            })).trim();
            update(d => ({
              recaps: {
                ...(d.recaps || {
                  weekly: {},
                  monthly: {}
                }),
                weekly: {
                  ...(d.recaps?.weekly || {}),
                  [lastWeekKey]: {
                    text,
                    generatedAt: new Date().toISOString(),
                    from: lastWeekKey,
                    to: lastWeekEnd
                  }
                }
              }
            }));
          } catch (_) {/* recap é um bônus automático — sem IA disponível, simplesmente não gera dessa vez */}
        }
      }
      // referência: mês anterior ao mês corrente do calendário (sempre já fechado)
      const curMonthDate = new Date();
      const prevMk = new Date(curMonthDate.getFullYear(), curMonthDate.getMonth() - 1, 1);
      const prevMonthKey = `${prevMk.getFullYear()}-${String(prevMk.getMonth() + 1).padStart(2, "0")}`;
      if (!(recaps?.monthly || {})[prevMonthKey]) {
        const b = monthBucket(prevMonthKey);
        if (b.entradas > 0 || b.saidas > 0 || b.investido > 0) {
          try {
            const briefing = buildMonthlyBriefing({
              txs,
              accounts,
              monthDate: prevMk,
              monthIndex
            });
            const prompt = `Você é o analista financeiro pessoal de quem usa este app. O mês ${prevMonthKey} acabou de fechar. Dossiê completo em JSON (valores em reais):\n\n${JSON.stringify(briefing)}\n\n${AI_SUMMARY_STYLE}`;
            const text = (await callGemini({
              prompt
            })).trim();
            update(d => ({
              recaps: {
                ...(d.recaps || {
                  weekly: {},
                  monthly: {}
                }),
                monthly: {
                  ...(d.recaps?.monthly || {}),
                  [prevMonthKey]: {
                    text,
                    generatedAt: new Date().toISOString()
                  }
                }
              }
            }));
          } catch (_) {/* idem: sem IA disponível agora, tenta de novo na próxima vez que o Panorama abrir */}
        }
      }
    })();
  }, []);
  const latestWeeklyRecap = useMemo(() => {
    const keys = Object.keys(recaps?.weekly || {}).sort();
    return keys.length ? {
      key: keys[keys.length - 1],
      ...recaps.weekly[keys[keys.length - 1]]
    } : null;
  }, [recaps]);
  const latestMonthlyRecap = useMemo(() => {
    const keys = Object.keys(recaps?.monthly || {}).sort();
    return keys.length ? {
      key: keys[keys.length - 1],
      ...recaps.monthly[keys[keys.length - 1]]
    } : null;
  }, [recaps]);
  const byCatAll = useMemo(() => {
    const m = {};
    Object.values(monthIndex).forEach(b => {
      Object.entries(b.porCategoria).forEach(([cat, cents]) => {
        m[cat] = (m[cat] || 0) + cents;
      });
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
      name,
      value,
      color: CAT_COLOR[name] || "var(--text-mut)"
    }));
  }, [monthIndex]);

  // gasto por tag (tags de primeira classe): soma, em todo o histórico realizado, quanto foi gasto em
  // lançamentos marcados com cada #tag na descrição — igual ao "por categoria", só que por tag
  const byTagAll = useMemo(() => {
    const m = {};
    txs.filter(t => isRealized(t) && t.type === "gasto").forEach(t => {
      extractTags(t.description).forEach(tg => {
        m[tg] = (m[tg] || 0) + t.cents;
      });
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({
      name: "#" + name,
      value,
      color: QUALITATIVE[i % QUALITATIVE.length]
    }));
  }, [txs]);
  const EVO_CAP = 24;
  const evoAll = useMemo(() => {
    const months = Object.keys(monthIndex).sort();
    if (months.length === 0) return {
      arr: [],
      truncated: false,
      total: 0
    };
    const [fy, fm] = months[0].split("-").map(Number);
    const [ly, lm] = months[months.length - 1].split("-").map(Number);
    const total = (ly - fy) * 12 + (lm - fm) + 1;
    const show = Math.min(total, EVO_CAP);
    const start = total - show;
    const arr = [];
    for (let i = start; i < total; i++) {
      const d = new Date(fy, fm - 1 + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = monthBucket(mk);
      arr.push({
        name: shortMonthLabel(d),
        bars: [{
          v: b.entradas / 100,
          color: "var(--pos)"
        }, {
          v: b.saidas / 100,
          color: "var(--neg)"
        }],
        date: d
      });
    }
    return {
      arr,
      truncated: total > EVO_CAP,
      total
    };
  }, [monthIndex]);
  const activeEvoIdx = view ? evoAll.arr.findIndex(e => e.date.getFullYear() === view.getFullYear() && e.date.getMonth() === view.getMonth()) : -1;
  const [patternsResult, setPatternsResult] = useState("");
  const [patternsBusy, setPatternsBusy] = useState(false);
  const [patternsError, setPatternsError] = useState("");
  async function analyzePatterns() {
    setPatternsBusy(true);
    setPatternsError("");
    setPatternsResult("");
    try {
      const candidates = detectRecurringCandidates(txs, new Date());
      if (candidates.length === 0) {
        setPatternsResult("Nenhum padrão fora do comum encontrado — seus gastos recorrentes estão regulares.");
        return;
      }
      const totalRecorrente = candidates.reduce((s, c) => s + Number(c.ultimoValor || 0), 0);
      const prompt = `Padrões de gastos recorrentes detectados no histórico financeiro do usuário (JSON, valores em reais). "diasDesdeUltimaVez" alto sugere assinatura cancelada ou cobrança que sumiu; "variacaoPercentual" alto sugere reajuste ou cobrança fora do padrão. Soma dos últimos valores: R$ ${totalRecorrente.toFixed(2)}.

${JSON.stringify(candidates)}

Escreva uma análise em português do Brasil, na segunda pessoa, tom direto e sem jargão, usando SÓ estes números. Formato (use exatamente estes títulos, com "## " na frente, e "- " nos itens):
## O que chama atenção
Dois períodos com o veredito geral: quanto do seu mês está preso em cobranças recorrentes e se há algo claramente errado.
## Possivelmente esquecidas
Itens com muitos dias sem aparecer — para cada um, quantos dias, o valor que era cobrado e o que verificar. Se não houver, escreva "- Nenhuma cobrança sumiu do radar."
## Reajustes e valores fora do padrão
Itens que subiram ou caíram muito — cite o valor de agora, a média anterior e a variação percentual. Se não houver, escreva "- Nenhum valor fora do padrão."
## O que fazer agora
Exatamente 3 ações concretas, cada uma citando o nome do gasto e o número que a justifica.
Valores no formato R$ 1.234,56. Nunca invente um gasto que não esteja no JSON.`;
      const text = await callGemini({
        prompt,
        model: aiModelId(aiModel)
      });
      setPatternsResult(text.trim());
    } catch (err) {
      setPatternsError(err.message || "Não foi possível analisar os padrões.");
    } finally {
      setPatternsBusy(false);
    }
  }
  if (txs.length === 0) {
    return /*#__PURE__*/React.createElement(EmptyState, {
      icon: "panorama",
      title: "Nenhum lançamento registrado ainda",
      text: "O jeito mais rápido de começar: baixe os PDFs do mês no site do seu banco e do seu cartão e mande todos aqui de uma vez — a IA lê, classifica e você só confere.",
      action: {
        label: "Importar extratos e faturas",
        icon: "brilho",
        onClick: () => goToTab("extrato")
      },
      secondary: {
        label: "Ver no manual",
        onClick: () => openHelp("registrar-lancamentos")
      }
    });
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "herotop"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, "Saldo total acumulado (todos os meses)"), /*#__PURE__*/React.createElement("div", {
    className: "bal num " + (totals.saldo >= 0 ? "pos" : "neg")
  }, brl(totals.saldo)))), /*#__PURE__*/React.createElement("div", {
    className: "stats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 12
  }), "Entradas"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--pos)"
    }
  }, brl(totals.inc))), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "enviar",
    size: 12
  }), "Saídas"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--neg)"
    }
  }, brl(totals.exp))), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "investimentos",
    size: 12
  }), "Investido"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--inv)"
    }
  }, brl(totals.inv))))), (latestWeeklyRecap || latestMonthlyRecap) && /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Recap automático ", /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 14,
    style: {
      color: "var(--accent)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: latestWeeklyRecap && latestMonthlyRecap ? 10 : 0
    }
  }, "Gerado por IA sozinho quando a semana ou o mês fecham — nenhum clique necessário."), latestMonthlyRecap && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: latestWeeklyRecap ? 14 : 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Mês de ", latestMonthlyRecap.key), /*#__PURE__*/React.createElement(RichAI, {
    text: latestMonthlyRecap.text
  })), latestWeeklyRecap && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Semana de ", fmtDateBR(latestWeeklyRecap.from), " a ", fmtDateBR(latestWeeklyRecap.to)), /*#__PURE__*/React.createElement(RichAI, {
    text: latestWeeklyRecap.text
  }))), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Saldo por conta ", /*#__PURE__*/React.createElement(HelpIcon, {
    section: "contas-cartoes"
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Soma de todos os lançamentos já registrados em cada conta, desde o início."), byAccount.map(a => {
    const committed = a.kind === "cartao" ? cardCommitted(a.id) : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "acct",
      key: a.id,
      style: {
        flexDirection: "column",
        alignItems: "stretch",
        gap: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "adot",
      style: {
        background: a.color
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: a.kind === "cartao" ? "cartao" : "banco",
      size: 16
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "aname"
    }, a.name), /*#__PURE__*/React.createElement("div", {
      className: "akind"
    }, a.kind === "cartao" ? "Cartão" : "Conta")), /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        fontSize: 15,
        fontWeight: 500,
        color: a.balance >= 0 ? "var(--pos)" : "var(--neg)"
      }
    }, brl(a.balance))), a.kind === "cartao" && a.limit > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8,
        marginLeft: 48
      }
    }, /*#__PURE__*/React.createElement(ProgressBar, {
      spent: committed.net,
      limit: a.limit,
      status: committed.net >= a.limit ? "over" : committed.net / a.limit >= 0.8 ? "warn" : "ok"
    }), /*#__PURE__*/React.createElement("div", {
      className: "mm"
    }, Math.min(100, committed.net / a.limit * 100).toFixed(0), "% do limite comprometido · ", brl(committed.net), " de ", brl(a.limit), committed.credit > 0 ? ` · você pagou ${brl(committed.credit)} a mais, que fica como saldo no cartão` : "")));
  })), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Independência Financeira"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Quanto os proventos médios dos últimos 6 meses cobririam dos seus gastos médios. Proventos são o que a sua carteira paga sozinha: dividendos, juros, aluguéis."), fi.avgProv > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "bal num",
    style: {
      fontSize: 32,
      fontWeight: 500,
      margin: "2px 0 4px",
      color: fi.pct >= 100 ? "var(--pos)" : "var(--text)"
    }
  }, fi.pct.toFixed(1), "%"), /*#__PURE__*/React.createElement(ProgressBar, {
    spent: Math.min(fi.pct, 100),
    limit: 100,
    status: fi.pct >= 100 ? "ok" : fi.pct >= 50 ? "warn" : "none"
  }), /*#__PURE__*/React.createElement("div", {
    className: "mm"
  }, "Meta: 100% · Proventos médios ", brl(Math.round(fi.avgProv)), "/mês · Gastos médios ", brl(Math.round(fi.avgGasto)), "/mês · calculado com base em ", fi.monthsWithData, " ", fi.monthsWithData === 1 ? "mês" : "meses")) : /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      marginTop: 0
    }
  }, "Ainda não há proventos registrados, então este indicador fica em espera — não é um problema, é só o começo. Assim que você lançar um ganho na categoria \"Proventos\", ele passa a mostrar que parte dos seus gastos", fi.avgGasto > 0 ? ` (hoje ${brl(Math.round(fi.avgGasto))}/mês)` : "", " a sua carteira já sustentaria sozinha.")), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Patrimônio estimado ", /*#__PURE__*/React.createElement(HelpIcon, {
    section: "panorama-ajuda"
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Saldo das contas (sem cartões) + valor atual da carteira de investimentos."), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Em contas"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, brl(contasBalance))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Em investimentos"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: "var(--inv)"
    }
  }, brl(totCur))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, /*#__PURE__*/React.createElement("b", null, "Total")), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      fontSize: 18,
      fontWeight: 600
    }
  }, brl(patrimonio)))), lembretes.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Contas a pagar e lembretes"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Lançamentos previstos que vencem nos próximos 7 dias ou já passaram do prazo."), lembretes.map(t => {
    const today = todayISO();
    const overdue = t.date < today;
    const days = Math.round((new Date(t.date + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
    return /*#__PURE__*/React.createElement("div", {
      className: "kv",
      key: t.id
    }, /*#__PURE__*/React.createElement("span", {
      className: "kk"
    }, t.description || t.category || TYPES[t.type].label, /*#__PURE__*/React.createElement("span", {
      className: "tag " + (overdue ? "over" : days === 0 ? "warn" : "ok"),
      style: {
        marginLeft: 8
      }
    }, overdue ? `atrasado ${Math.abs(days)}d` : days === 0 ? "hoje" : `em ${days}d`)), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "vv",
      style: {
        color: t.type === "ganho" ? "var(--pos)" : "var(--neg)"
      }
    }, brl(t.cents)), /*#__PURE__*/React.createElement("button", {
      className: "sbtn iconsbtn",
      "aria-label": "Marcar como pago",
      onClick: () => marcarLembretePago(t)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 14
    }))));
  })), patrimonyEvo.length >= 2 && /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Histórico de patrimônio"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, "Snapshot automático do patrimônio total ao final de cada mês."), /*#__PURE__*/React.createElement(BarGroups, {
    data: patrimonyEvo
  })), /*#__PURE__*/React.createElement(BcbIndicators, null), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Assinaturas e recorrências ", /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: analyzePatterns,
    disabled: patternsBusy
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 14
  }), patternsBusy ? "Analisando…" : "Analisar com IA")), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Encontra cobranças mensais que sumiram do seu extrato (assinatura esquecida ou já cancelada) e valores que fugiram do padrão de sempre."), patternsBusy && /*#__PURE__*/React.createElement("div", {
    className: "aithink"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aiorb"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("span", {
    className: "core"
  })), /*#__PURE__*/React.createElement("div", {
    className: "aibody"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aititle"
  }, /*#__PURE__*/React.createElement("span", null, "Procurando padrões nas suas recorrências", /*#__PURE__*/React.createElement("span", {
    className: "aidots"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "aiphase"
  }, "Cadência mensal, cobranças que sumiram e valores fora da média."), /*#__PURE__*/React.createElement("div", {
    className: "aibar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: "100%",
      opacity: .25
    }
  }), /*#__PURE__*/React.createElement("span", null)))), patternsResult && /*#__PURE__*/React.createElement(RichAI, {
    text: patternsResult
  }), patternsError && /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      color: "var(--neg)"
    }
  }, patternsError), !patternsResult && !patternsBusy && !patternsError && /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "A varredura é local e instantânea; a IA entra só para explicar o que encontrou e sugerir o que fazer.")), evoAll.arr.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Evolução completa"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, evoAll.truncated ? `Mostrando os últimos ${EVO_CAP} de ${evoAll.total} meses. ` : "", "Clique em um mês para navegar até ele."), /*#__PURE__*/React.createElement("div", {
    className: "chlegend"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
    style: {
      background: "var(--pos)"
    }
  }), "Entradas"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
    style: {
      background: "var(--neg)"
    }
  }), "Saídas")), /*#__PURE__*/React.createElement(BarGroups, {
    data: evoAll.arr,
    onSelect: onSelectMonth ? i => onSelectMonth(evoAll.arr[i].date) : undefined,
    activeIndex: activeEvoIdx
  })), byCatAll.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Gastos por categoria (todo o período)"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, "Clique numa categoria pra ver os lançamentos no Balanço."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Donut, {
    data: byCatAll,
    centerLabel: "gastos",
    onSelect: name => goToTab("balanco", {
      category: name
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 180
    }
  }, /*#__PURE__*/React.createElement(Legend, {
    data: byCatAll,
    onSelect: name => goToTab("balanco", {
      category: name
    })
  })))), byTagAll.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Gasto por tag (todo o período)"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, "Somado a partir das #tags usadas na descrição dos lançamentos. Clique numa tag pra ver os lançamentos no Balanço."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Donut, {
    data: byTagAll,
    centerLabel: "gasto",
    onSelect: name => goToTab("balanco", {
      tag: name.replace(/^#/, "")
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 180
    }
  }, /*#__PURE__*/React.createElement(Legend, {
    data: byTagAll,
    onSelect: name => goToTab("balanco", {
      tag: name.replace(/^#/, "")
    })
  })))));
}
Geral = React.memo(Geral);

/* ---------- ORÇAMENTO ---------- */
function Orcamento({
  budgetRows,
  budgets,
  budgetExceptions,
  update,
  plannedTotal,
  totalSpent,
  monthLabel,
  txs,
  view,
  accounts
}) {
  const [openCat, setOpenCat] = useState(null);
  const [val, setVal] = useState(0);
  const [scope, setScope] = useState("default"); // "default" (todos os meses) | "month" (exceção deste mês)
  const allCats = CATS.gasto.map(c => c[0]);
  const vKey = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, "0")}`;
  const setBudgetDefault = (c, cents) => {
    update(d => {
      const b = {
        ...d.budgets
      };
      if (cents > 0) b[c] = cents;else delete b[c];
      return {
        budgets: b
      };
    });
  };
  const setBudgetException = (c, cents) => {
    update(d => {
      const monthMap = {
        ...(d.budgetExceptions[vKey] || {})
      };
      if (cents > 0) monthMap[c] = cents;else delete monthMap[c];
      const next = {
        ...d.budgetExceptions
      };
      if (Object.keys(monthMap).length) next[vKey] = monthMap;else delete next[vKey];
      return {
        budgetExceptions: next
      };
    });
  };
  const activeCat = openCat || allCats[0];
  const saveBudget = () => {
    if (scope === "month") setBudgetException(activeCat, val);else setBudgetDefault(activeCat, val);
    toast("Limite salvo.", "success");
  };
  const removeBudget = () => {
    if (scope === "month") setBudgetException(activeCat, 0);else setBudgetDefault(activeCat, 0);
    setVal(0);
  };
  const pickCategory = c => {
    setOpenCat(c);
    const hasExc = budgetExceptions[vKey]?.[c] != null;
    setScope(hasExc ? "month" : "default");
    setVal(hasExc ? budgetExceptions[vKey][c] : budgets[c] || 0);
  };
  const pickScope = s => {
    setScope(s);
    setVal(s === "month" ? budgetExceptions[vKey]?.[activeCat] || 0 : budgets[activeCat] || 0);
  };

  // mesma base do restante do orçamento: gasto conta no mês da fatura do cartão, não no mês da compra
  const prevSpentByCat = useMemo(() => {
    const d = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    const pk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = {};
    txs.filter(t => t.type === "gasto" && txEffectiveMonth(t, accounts) === pk).forEach(t => {
      m[t.category] = (m[t.category] || 0) + t.cents;
    });
    return m;
  }, [txs, view, accounts]);

  // comprometimento das próximas rendas: quanto do que já está lançado (realizado + previsto) pro mês
  // consome a renda esperada dele — olha os 3 próximos meses (o atual e os dois seguintes)
  const commitment = useMemo(() => {
    const now = new Date();
    return [0, 1, 2].map(i => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      let ganho = 0,
        gasto = 0;
      txs.forEach(t => {
        if (t.type === "transferencia") return;
        const flowMk = t.type === "gasto" ? txEffectiveMonth(t, accounts) : monthKey(t.date);
        if (flowMk !== mk) return;
        if (t.type === "ganho") ganho += t.cents;else if (t.type === "gasto") gasto += t.cents;
      });
      const pct = ganho > 0 ? gasto / ganho * 100 : gasto > 0 ? 100 : 0;
      return {
        mk,
        label: capFirst(d.toLocaleDateString("pt-BR", {
          month: "long",
          year: "numeric"
        })),
        ganho,
        gasto,
        pct,
        status: ganho === 0 ? "none" : pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok"
      };
    });
  }, [txs, accounts]);

  // simulador "e se" — totalmente local, sem IA: usa a média mensal real dos últimos 6 meses como base
  // e aplica a mudança hipotética na hora, sem gravar nada
  const [simCat, setSimCat] = useState("");
  const [simPct, setSimPct] = useState(0);
  const [simExtraType, setSimExtraType] = useState("gasto");
  const [simExtraValue, setSimExtraValue] = useState(0);
  const avgMonthly = useMemo(() => {
    const m = {};
    txs.filter(isRealized).forEach(t => {
      if (t.type === "transferencia") return;
      const mk = t.type === "gasto" ? txEffectiveMonth(t, accounts) : monthKey(t.date);
      m[mk] = m[mk] || {
        ganho: 0,
        gasto: 0,
        inv: 0
      };
      if (t.type === "ganho") m[mk].ganho += t.cents;else if (t.type === "gasto") m[mk].gasto += t.cents;else if (t.type === "investimento") m[mk].inv += t.cents;
    });
    const keys = Object.keys(m).sort().slice(-6);
    if (keys.length === 0) return {
      ganho: 0,
      gasto: 0,
      inv: 0,
      months: 0
    };
    const sum = keys.reduce((s, k) => ({
      ganho: s.ganho + m[k].ganho,
      gasto: s.gasto + m[k].gasto,
      inv: s.inv + m[k].inv
    }), {
      ganho: 0,
      gasto: 0,
      inv: 0
    });
    return {
      ganho: Math.round(sum.ganho / keys.length),
      gasto: Math.round(sum.gasto / keys.length),
      inv: Math.round(sum.inv / keys.length),
      months: keys.length
    };
  }, [txs, accounts]);
  const avgByCat = useMemo(() => {
    const m = {};
    txs.filter(t => isRealized(t) && t.type === "gasto").forEach(t => {
      const mk = txEffectiveMonth(t, accounts);
      (m[t.category] = m[t.category] || {})[mk] = (m[t.category][mk] || 0) + t.cents;
    });
    const out = {};
    Object.entries(m).forEach(([cat, byMonth]) => {
      const keys = Object.keys(byMonth).sort().slice(-6);
      out[cat] = Math.round(keys.reduce((s, k) => s + byMonth[k], 0) / Math.max(1, keys.length));
    });
    return out;
  }, [txs, accounts]);
  const simResult = useMemo(() => {
    const catAvg = simCat ? avgByCat[simCat] || 0 : 0;
    const reduction = Math.round(catAvg * (simPct / 100));
    const novoGasto = Math.max(0, avgMonthly.gasto - reduction + (simExtraType === "gasto" ? simExtraValue : 0));
    const novoGanho = avgMonthly.ganho + (simExtraType === "ganho" ? simExtraValue : 0);
    const saldoAtual = avgMonthly.ganho - avgMonthly.gasto - avgMonthly.inv;
    const novoSaldo = novoGanho - novoGasto - avgMonthly.inv;
    return {
      reduction,
      saldoAtual,
      novoSaldo,
      delta: novoSaldo - saldoAtual
    };
  }, [avgMonthly, avgByCat, simCat, simPct, simExtraType, simExtraValue]);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Orçamento de ", monthLabel, " ", /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: totalSpent > plannedTotal && plannedTotal > 0 ? "var(--neg)" : "var(--text)"
    }
  }, brl(totalSpent), " / ", brl(plannedTotal)), " ", /*#__PURE__*/React.createElement(HelpIcon, {
    section: "orcamento-ajuda"
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Defina quanto quer gastar em cada categoria. O histórico ajuda a ser realista. Gastos no cartão contam no mês da fatura, não no mês da compra."), budgetRows.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Nenhuma categoria com orçamento ou gasto ainda. Use o cartão \"Definir orçamento\" para escolher uma categoria e um limite — o histórico de quanto você costuma gastar aparece aqui assim que houver lançamentos."), budgetRows.map(r => {
    const rollover = r.limit > 0 ? r.limit - (prevSpentByCat[r.cat] || 0) : 0;
    return /*#__PURE__*/React.createElement("div", {
      className: "budrow",
      key: r.cat
    }, /*#__PURE__*/React.createElement("div", {
      className: "bh"
    }, /*#__PURE__*/React.createElement("span", {
      className: "bname"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: CAT_ICON[r.cat] || "outros",
      size: 15
    }), " ", r.cat, r.status === "over" && /*#__PURE__*/React.createElement("span", {
      className: "tag over"
    }, "estourou"), r.status === "warn" && /*#__PURE__*/React.createElement("span", {
      className: "tag warn"
    }, "atenção"), r.status === "ok" && /*#__PURE__*/React.createElement("span", {
      className: "tag ok"
    }, "no limite")), /*#__PURE__*/React.createElement("span", {
      className: "bval"
    }, brl(r.spent), r.limit > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-mut)"
      }
    }, " / ", brl(r.limit)))), /*#__PURE__*/React.createElement(ProgressBar, {
      spent: r.spent,
      limit: r.limit,
      status: r.status
    }), /*#__PURE__*/React.createElement("div", {
      className: "mm"
    }, r.hist ? /*#__PURE__*/React.createElement(React.Fragment, null, "Histórico: mín ", brl(r.hist.min), " · média ", brl(r.hist.avg), " · máx ", brl(r.hist.max)) : "Sem histórico ainda", " · ", /*#__PURE__*/React.createElement("button", {
      style: {
        border: "none",
        background: "none",
        color: "var(--inv)",
        cursor: "pointer",
        fontSize: 11,
        textDecoration: "underline",
        padding: 0
      },
      onClick: () => pickCategory(r.cat)
    }, r.limit > 0 ? "editar limite" : "definir limite")), r.isException && /*#__PURE__*/React.createElement("div", {
      className: "mm",
      style: {
        color: "var(--inv)"
      }
    }, "Limite específico de ", monthLabel, " · ", /*#__PURE__*/React.createElement("button", {
      style: {
        border: "none",
        background: "none",
        color: "var(--inv)",
        cursor: "pointer",
        fontSize: 11,
        textDecoration: "underline",
        padding: 0
      },
      onClick: () => setBudgetException(r.cat, 0)
    }, "remover exceção")), rollover > 0 && /*#__PURE__*/React.createElement("div", {
      className: "mm",
      style: {
        color: "var(--pos)"
      }
    }, "Sobrou ", brl(rollover), " do mês passado nesta categoria — dá para remanejar para este mês ou para investimentos."));
  })), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Definir orçamento"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Escolha a categoria, o valor e se vale só para ", monthLabel, " ou todos os meses (planejamento sazonal)."), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: activeCat,
    onChange: e => pickCategory(e.target.value),
    style: {
      marginBottom: 10
    }
  }, allCats.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }, c))), /*#__PURE__*/React.createElement("div", {
    className: "seg",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: scope === "default" ? "on in" : "",
    onClick: () => pickScope("default")
  }, "Todos os meses"), /*#__PURE__*/React.createElement("button", {
    className: scope === "month" ? "on inv" : "",
    onClick: () => pickScope("month")
  }, "Neste mês (", monthLabel, ")")), /*#__PURE__*/React.createElement(Money, {
    cents: val,
    onChange: setVal,
    small: true,
    onEnter: saveBudget
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    onClick: saveBudget
  }, "Salvar limite"), val > 0 && /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: removeBudget
  }, "Remover"))), /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Comprometimento das próximas rendas"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, "Quanto do que já está lançado (realizado + previsto) consome a renda esperada em cada mês."), commitment.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.mk,
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "bh"
  }, /*#__PURE__*/React.createElement("span", {
    className: "bname"
  }, c.label, c.status === "over" && /*#__PURE__*/React.createElement("span", {
    className: "tag over"
  }, "comprometido"), c.status === "warn" && /*#__PURE__*/React.createElement("span", {
    className: "tag warn"
  }, "atenção"), c.status === "ok" && /*#__PURE__*/React.createElement("span", {
    className: "tag ok"
  }, "tranquilo")), /*#__PURE__*/React.createElement("span", {
    className: "bval"
  }, brl(c.gasto), c.ganho > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-mut)"
    }
  }, " / ", brl(c.ganho)))), c.ganho > 0 ? /*#__PURE__*/React.createElement(ProgressBar, {
    spent: c.gasto,
    limit: c.ganho,
    status: c.status
  }) : /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      marginTop: 4
    }
  }, c.gasto > 0 ? "Gastos lançados sem nenhuma renda prevista para o mês." : "Nada lançado ainda para este mês.")))), /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Simulador \"e se\""), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Local, sem IA — ", avgMonthly.months > 0 ? `usa a média real dos seus últimos ${avgMonthly.months} ${avgMonthly.months === 1 ? "mês" : "meses"} como base e recalcula na hora.` : "assim que houver pelo menos um mês fechado, simula aqui o efeito de cortar um gasto ou assumir um novo."), avgMonthly.months === 0 ? /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Sem histórico suficiente ainda para simular.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: simCat,
    onChange: e => setSimCat(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "Reduzir uma categoria (opcional)…"), allCats.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }, c, " (média ", brl(avgByCat[c] || 0), "/mês)"))), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "0",
    max: "100",
    placeholder: "% de redução",
    value: simPct || "",
    onChange: e => setSimPct(Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0))),
    disabled: !simCat,
    style: {
      flex: "0 0 auto",
      maxWidth: 160
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: simExtraType,
    onChange: e => setSimExtraType(e.target.value),
    style: {
      flex: "0 0 auto",
      maxWidth: 200
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "gasto"
  }, "Novo gasto mensal (opcional)"), /*#__PURE__*/React.createElement("option", {
    value: "ganho"
  }, "Novo ganho mensal (opcional)")), /*#__PURE__*/React.createElement(Money, {
    cents: simExtraValue,
    onChange: setSimExtraValue,
    small: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      paddingTop: 14,
      borderTop: "1px solid var(--surface-2)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Saldo médio mensal atual"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, brl(simResult.saldoAtual))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, /*#__PURE__*/React.createElement("b", null, "Saldo médio mensal projetado")), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      fontSize: 16,
      fontWeight: 600,
      color: simResult.novoSaldo >= simResult.saldoAtual ? "var(--pos)" : "var(--neg)"
    }
  }, brl(simResult.novoSaldo))), /*#__PURE__*/React.createElement("div", {
    className: "mm"
  }, simResult.delta >= 0 ? "+" : "", brl(simResult.delta), " por mês em relação ao atual", simResult.reduction > 0 ? ` (redução de ${brl(simResult.reduction)} em ${simCat})` : "")))));
}
Orcamento = React.memo(Orcamento);

/* ---------- METAS ---------- */
function Metas({
  goals,
  update,
  txs
}) {
  const [form, setForm] = useState(null);
  const [contribId, setContribId] = useState(null);
  const [contrib, setContrib] = useState(0);
  const blank = {
    name: "",
    target: 0,
    saved: 0,
    deadline: "",
    linkedCategory: null
  };
  // categorias que fazem sentido ligar a uma meta (poupança/investimento) — gasto fica de fora
  const linkedCategoryOptions = useMemo(() => [...CATS.investimento, ...CATS.ganho].map(c => c[0]).filter((v, i, a) => a.indexOf(v) === i), []);
  // meta ligada a uma categoria real: o progresso soma automaticamente todo lançamento realizado daquela
  // categoria, além do valor guardado manualmente — não precisa "avisar" a meta toda vez que investe
  const goalAutoSaved = g => {
    if (!g.linkedCategory) return 0;
    return txs.filter(t => isRealized(t) && t.category === g.linkedCategory && t.type !== "gasto").reduce((s, t) => s + t.cents, 0);
  };
  const save = () => {
    if (!form.name.trim() || form.target <= 0) return;
    update(d => ({
      goals: form.id ? d.goals.map(x => x.id === form.id ? form : x) : [...d.goals, {
        ...form,
        id: uid()
      }]
    }));
    setForm(null);
    toast("Meta salva.", "success");
  };
  const remove = g => askConfirm({
    title: "Excluir meta?",
    message: `"${g.name}" será removida.`,
    onConfirm: () => {
      update(d => ({
        goals: d.goals.filter(x => x.id !== g.id)
      }));
      toast("Meta excluída.", "success");
    }
  });
  const addContrib = g => {
    update(d => ({
      goals: d.goals.map(x => x.id === g.id ? {
        ...x,
        saved: x.saved + contrib
      } : x)
    }));
    setContribId(null);
    setContrib(0);
    toast("Valor guardado.", "success");
  };
  const monthsLeft = dl => {
    if (!dl) return null;
    const d = new Date(dl),
      n = new Date();
    return Math.max(0, (d.getFullYear() - n.getFullYear()) * 12 + d.getMonth() - n.getMonth());
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("h3", null, "Metas e planos ", /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => setForm(blank)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "adicionar",
    size: 14
  }), " Nova"), /*#__PURE__*/React.createElement(HelpIcon, {
    section: "metas-ajuda"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Pague seus sonhos primeiro: defina valor, prazo e acompanhe o progresso."), form && /*#__PURE__*/React.createElement("div", {
    className: "miniform"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Nome (ex: Viagem, Reserva)",
    value: form.name,
    onChange: e => setForm({
      ...form,
      name: e.target.value
    }),
    style: {
      marginBottom: 10
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "10px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Valor total"), /*#__PURE__*/React.createElement(Money, {
    cents: form.target,
    onChange: v => setForm({
      ...form,
      target: v
    }),
    small: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "10px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Já guardado (manual)"), /*#__PURE__*/React.createElement(Money, {
    cents: form.saved,
    onChange: v => setForm({
      ...form,
      saved: v
    }),
    small: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Prazo"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "date",
    value: form.deadline,
    onChange: e => setForm({
      ...form,
      deadline: e.target.value
    }),
    style: {
      marginBottom: 10
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Ligar a uma categoria (opcional)"), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: form.linkedCategory || "",
    onChange: e => setForm({
      ...form,
      linkedCategory: e.target.value || null
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "Nenhuma — só o valor guardado manualmente"), linkedCategoryOptions.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }, c))), /*#__PURE__*/React.createElement("div", {
    className: "hint"
  }, "Ligando a uma categoria, todo lançamento real dessa categoria soma automaticamente no progresso da meta."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    onClick: save
  }, "Salvar meta"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => setForm(null)
  }, "Cancelar"))), goals.length === 0 && !form && /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Nenhuma meta ainda. Crie sua primeira, como uma reserva de emergência."), goals.map(g => {
    const autoSaved = goalAutoSaved(g);
    const totalSaved = g.saved + autoSaved;
    const pct = g.target > 0 ? Math.min(100, totalSaved / g.target * 100) : 0;
    const ml = monthsLeft(g.deadline);
    const need = ml && ml > 0 ? Math.max(0, Math.ceil((g.target - totalSaved) / ml)) : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "goal",
      key: g.id
    }, /*#__PURE__*/React.createElement("div", {
      className: "gh"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "gname"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "metas",
      size: 16
    }), " ", g.name), /*#__PURE__*/React.createElement("div", {
      className: "gsub"
    }, pct.toFixed(0), "% concluído", g.deadline && /*#__PURE__*/React.createElement(React.Fragment, null, " · prazo ", new Date(g.deadline + "T00:00:00").toLocaleDateString("pt-BR", {
      month: "short",
      year: "numeric"
    })), need != null && /*#__PURE__*/React.createElement(React.Fragment, null, " · guardar ", brl(need), "/mês"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 2
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "sbtn iconsbtn",
      "aria-label": "Editar",
      onClick: () => setForm(g)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "editar",
      size: 15
    })), /*#__PURE__*/React.createElement("button", {
      className: "sbtn iconsbtn",
      "aria-label": "Excluir",
      onClick: () => remove(g)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "excluir",
      size: 15
    })))), /*#__PURE__*/React.createElement("div", {
      className: "bar"
    }, /*#__PURE__*/React.createElement("i", {
      style: {
        width: pct + "%",
        background: pct >= 100 ? "var(--pos)" : "var(--inv)"
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "gv"
    }, /*#__PURE__*/React.createElement("span", {
      className: "num"
    }, brl(totalSaved)), /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        color: "var(--text-mut)"
      }
    }, brl(g.target))), g.linkedCategory && /*#__PURE__*/React.createElement("div", {
      className: "mm"
    }, "Ligada à categoria \"", g.linkedCategory, "\" · ", brl(autoSaved), " de lançamentos reais + ", brl(g.saved), " guardados manualmente"), contribId === g.id ? /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement(Money, {
      cents: contrib,
      onChange: setContrib,
      small: true,
      onEnter: () => addContrib(g),
      autoFocus: true
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "sbtn primary",
      onClick: () => addContrib(g)
    }, "Guardar"), /*#__PURE__*/React.createElement("button", {
      className: "sbtn",
      onClick: () => setContribId(null)
    }, "Cancelar"))) : /*#__PURE__*/React.createElement("div", {
      className: "gacts"
    }, /*#__PURE__*/React.createElement("button", {
      className: "sbtn",
      onClick: () => {
        setContribId(g.id);
        setContrib(0);
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "adicionar",
      size: 13
    }), " Guardar dinheiro")));
  }));
}
Metas = React.memo(Metas);

/* ---------- INVESTIMENTOS ---------- */
function Investimentos({
  holdings,
  update,
  monthIndex,
  monthLabel,
  txs,
  view,
  onSelectMonth
}) {
  const [form, setForm] = useState(null);
  const [classFilter, setClassFilter] = useState(null);
  const EMPTY_BUCKET = {
    entradas: 0,
    saidas: 0,
    investido: 0,
    proventos: 0,
    porCategoria: {},
    itens: []
  };
  const monthBucket = mk => monthIndex[mk] || EMPTY_BUCKET;
  const vKey = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, "0")}`;
  const blank = {
    name: "",
    cls: CLASSES[0],
    invested: 0,
    current: 0
  };
  const save = () => {
    if (!form.name.trim()) return;
    update(d => ({
      holdings: form.id ? d.holdings.map(x => x.id === form.id ? form : x) : [...d.holdings, {
        ...form,
        id: uid()
      }]
    }));
    setForm(null);
    toast("Ativo salvo.", "success");
  };
  const remove = h => askConfirm({
    title: "Excluir ativo?",
    message: `"${h.name}" será removido da sua carteira.`,
    onConfirm: () => {
      update(d => ({
        holdings: d.holdings.filter(x => x.id !== h.id)
      }));
      toast("Ativo excluído.", "success");
    }
  });
  const totInv = holdings.reduce((s, h) => s + h.invested, 0);
  const totCur = holdings.reduce((s, h) => s + h.current, 0);
  const rend = totCur - totInv;
  const byClass = useMemo(() => {
    const m = {};
    holdings.forEach(h => {
      m[h.cls] = (m[h.cls] || 0) + h.current;
    });
    return Object.entries(m).filter(([, v]) => v > 0).map(([name, value]) => ({
      name,
      value,
      color: CLASS_COLOR[name] || "var(--text-mut)"
    }));
  }, [holdings]);
  const aportesMes = monthBucket(vKey).investido;
  const proventosMes = monthBucket(vKey).proventos;
  const proventosTotal = useMemo(() => Object.values(monthIndex).reduce((s, b) => s + b.proventos, 0), [monthIndex]);
  const proventosEvo = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(view.getFullYear(), view.getMonth() - i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = monthBucket(mk);
      arr.push({
        name: d.toLocaleDateString("pt-BR", {
          month: "short"
        }).replace(".", ""),
        bars: [{
          v: b.investido / 100,
          color: "var(--inv)"
        }, {
          v: b.proventos / 100,
          color: "var(--pos)"
        }],
        date: d
      });
    }
    return arr;
  }, [monthIndex, view]);
  const hasProventosEvo = proventosEvo.some(m => m.bars.some(b => b.v > 0));
  const activeProvIdx = proventosEvo.findIndex(e => e.date.getFullYear() === view.getFullYear() && e.date.getMonth() === view.getMonth());
  const fi = useMemo(() => financialIndependence(monthIndex, view), [monthIndex, view]);
  const toggleClass = name => setClassFilter(f => f === name ? null : name);
  const visibleHoldings = classFilter ? holdings.filter(h => h.cls === classFilter) : holdings;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Carteira consolidada ", /*#__PURE__*/React.createElement(HelpIcon, {
    section: "investimentos-ajuda"
  })), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Total aplicado"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: "var(--inv)"
    }
  }, brl(totInv))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Valor atual"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, brl(totCur))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Rendimento"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: rend >= 0 ? "var(--pos)" : "var(--neg)"
    }
  }, rend >= 0 ? "+" : "−", " ", brlNum(Math.abs(rend)), totInv > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      opacity: .8
    }
  }, "  (", (rend / totInv * 100).toFixed(1), "%", ")"))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Aportes em ", monthLabel), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: "var(--inv)"
    }
  }, brl(aportesMes)))), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Proventos recebidos"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Dividendos e renda passiva, separados do capital aportado."), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Recebido em ", monthLabel), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: "var(--pos)"
    }
  }, brl(proventosMes))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Total acumulado"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: "var(--pos)"
    }
  }, brl(proventosTotal))), hasProventosEvo && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "chlegend",
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
    style: {
      background: "var(--inv)"
    }
  }), "Aportes"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", {
    style: {
      background: "var(--pos)"
    }
  }), "Proventos")), /*#__PURE__*/React.createElement(BarGroups, {
    data: proventosEvo,
    onSelect: onSelectMonth ? i => onSelectMonth(proventosEvo[i].date) : undefined,
    activeIndex: activeProvIdx
  }))), /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Independência Financeira"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Quanto os proventos médios dos últimos 6 meses cobririam dos seus gastos médios. Proventos são o que a sua carteira paga sozinha: dividendos, juros, aluguéis."), fi.avgProv > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "bal num",
    style: {
      fontSize: 32,
      fontWeight: 500,
      margin: "2px 0 4px",
      color: fi.pct >= 100 ? "var(--pos)" : "var(--text)"
    }
  }, fi.pct.toFixed(1), "%"), /*#__PURE__*/React.createElement(ProgressBar, {
    spent: Math.min(fi.pct, 100),
    limit: 100,
    status: fi.pct >= 100 ? "ok" : fi.pct >= 50 ? "warn" : "none"
  }), /*#__PURE__*/React.createElement("div", {
    className: "mm"
  }, "Meta: 100% · Proventos médios ", brl(Math.round(fi.avgProv)), "/mês · Gastos médios ", brl(Math.round(fi.avgGasto)), "/mês · calculado com base em ", fi.monthsWithData, " ", fi.monthsWithData === 1 ? "mês" : "meses")) : /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      marginTop: 0
    }
  }, "Ainda não há proventos registrados, então este indicador fica em espera — não é um problema, é só o começo. Assim que você lançar um ganho na categoria \"Proventos\", ele passa a mostrar que parte dos seus gastos", fi.avgGasto > 0 ? ` (hoje ${brl(Math.round(fi.avgGasto))}/mês)` : "", " a sua carteira já sustentaria sozinha.")), byClass.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card g-6"
  }, /*#__PURE__*/React.createElement("h3", null, "Composição por classe"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, "Clique numa classe para filtrar seus ativos."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Donut, {
    data: byClass,
    size: 150,
    onSelect: toggleClass,
    selected: classFilter,
    centerLabel: "carteira"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 160
    }
  }, /*#__PURE__*/React.createElement(Legend, {
    data: byClass,
    onSelect: toggleClass,
    selected: classFilter
  })))), /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Seus ativos ", /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => setForm(blank)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "adicionar",
    size: 14
  }), " Adicionar")), classFilter && /*#__PURE__*/React.createElement("div", {
    className: "filterchip"
  }, /*#__PURE__*/React.createElement("span", null, "Filtrando: ", classFilter), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Limpar filtro",
    onClick: () => setClassFilter(null)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "fechar",
    size: 12
  }))), form && /*#__PURE__*/React.createElement("div", {
    className: "miniform"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Nome (ex: Tesouro Selic 2029, PETR4)",
    value: form.name,
    onChange: e => setForm({
      ...form,
      name: e.target.value
    }),
    style: {
      marginBottom: 10
    }
  }), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: form.cls,
    onChange: e => setForm({
      ...form,
      cls: e.target.value
    }),
    style: {
      marginBottom: 10
    }
  }, CLASSES.map(c => /*#__PURE__*/React.createElement("option", {
    key: c
  }, c))), /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Valor aplicado"), /*#__PURE__*/React.createElement(Money, {
    cents: form.invested,
    onChange: v => setForm({
      ...form,
      invested: v
    }),
    small: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Valor atual"), /*#__PURE__*/React.createElement(Money, {
    cents: form.current,
    onChange: v => setForm({
      ...form,
      current: v
    }),
    small: true
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    onClick: save
  }, "Salvar"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => setForm(null)
  }, "Cancelar"))), holdings.length === 0 && !form && /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Cadastre seus investimentos para acompanhar a carteira e o rendimento em um só lugar."), holdings.length > 0 && visibleHoldings.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Nenhum ativo na classe ", classFilter, "."), visibleHoldings.map(h => {
    const r = h.current - h.invested;
    return /*#__PURE__*/React.createElement("div", {
      className: "kv",
      key: h.id
    }, /*#__PURE__*/React.createElement("span", {
      className: "kk",
      style: {
        color: "var(--text)"
      }
    }, h.name, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-mut)",
        fontSize: 12
      }
    }, "  ·  ", h.cls)), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "vv"
    }, brl(h.current)), /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        fontSize: 12,
        color: r >= 0 ? "var(--pos)" : "var(--neg)"
      }
    }, r >= 0 ? "+" : "−", brlNum(Math.abs(r))), /*#__PURE__*/React.createElement("button", {
      className: "sbtn iconsbtn",
      "aria-label": "Editar",
      onClick: () => setForm(h)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "editar",
      size: 14
    })), /*#__PURE__*/React.createElement("button", {
      className: "sbtn iconsbtn",
      "aria-label": "Excluir",
      onClick: () => remove(h)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "excluir",
      size: 14
    }))));
  }), /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Dica: atualize o \"valor atual\" de tempos em tempos para ver o rendimento real.")));
}
Investimentos = React.memo(Investimentos);

/* ---------- CONTAS ---------- */
// parcelado (não "fixo"/recorrente) sempre carrega o sufixo "(i/n)" no fim da descrição, gerado no submit()
// do formulário — é o único jeito de diferenciar os dois sem guardar um campo novo no lançamento
function isInstallmentSeries(t) {
  return t.seriesTotal > 1 && new RegExp(`\\(${t.seriesIndex + 1}\\/${t.seriesTotal}\\)$`).test(t.description || "");
}
const monthsFromToday = dateIso => {
  const d = new Date(dateIso + "T00:00:00"),
    n = new Date();
  return Math.max(0, (d.getFullYear() - n.getFullYear()) * 12 + (d.getMonth() - n.getMonth()));
};
/* custo real do parcelamento vs. CDI: parcelamento "sem juros" no Brasil não cobra nada a mais no nominal,
   mas segurar o dinheiro por mais tempo (em vez de pagar à vista) tem valor — se investido ao CDI nesse
   meio tempo, esse valor futuro vale menos em termos de hoje. A diferença entre o nominal das parcelas que
   faltam e o valor presente (descontado ao CDI) é a economia real de ter parcelado em vez de pago à vista. */
function Parcelamentos({
  txs
}) {
  const [cdiAnnual, setCdiAnnual] = useState(null);
  useEffect(() => {
    fetchBcbIndicators().then(d => {
      // CDI vem como taxa diária (código 12 do SGS) — anualiza por 252 dias úteis, convenção padrão no Brasil.
      // Sem CDI disponível, usa a Selic meta (já anual) como aproximação (historicamente muito próximas).
      if (d.cdi != null) setCdiAnnual((Math.pow(1 + d.cdi / 100, 252) - 1) * 100);else if (d.selic != null) setCdiAnnual(d.selic);
    }).catch(() => {});
  }, []);
  const series = useMemo(() => {
    const groups = {};
    txs.forEach(t => {
      if (isInstallmentSeries(t)) (groups[t.seriesId] = groups[t.seriesId] || []).push(t);
    });
    return Object.values(groups).map(items => {
      const sorted = [...items].sort((a, b) => a.seriesIndex - b.seriesIndex);
      const remaining = sorted.filter(t => !isRealized(t));
      if (remaining.length === 0) return null;
      return {
        seriesId: sorted[0].seriesId,
        baseDesc: (sorted[0].description || "").replace(/\s*\(\d+\/\d+\)$/, "") || sorted[0].category,
        total: sorted.length,
        paidCount: sorted.length - remaining.length,
        remaining
      };
    }).filter(Boolean);
  }, [txs]);
  if (series.length === 0) return null;
  const monthlyRate = cdiAnnual != null ? Math.pow(1 + cdiAnnual / 100, 1 / 12) - 1 : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "card g-12"
  }, /*#__PURE__*/React.createElement("h3", null, "Parcelamentos ativos"), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 0
    }
  }, monthlyRate != null ? "Economia real de ter parcelado em vez de pago à vista, descontando as parcelas futuras pela CDI/Selic vigente." : "Parcelas que ainda faltam pagar."), series.map(s => {
    const nominal = s.remaining.reduce((sum, t) => sum + t.cents, 0);
    const presentValue = monthlyRate != null ? s.remaining.reduce((sum, t) => sum + t.cents / Math.pow(1 + monthlyRate, monthsFromToday(t.date) + 1), 0) : null;
    const economia = presentValue != null ? Math.round(nominal - presentValue) : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "kv",
      key: s.seriesId,
      style: {
        alignItems: "flex-start"
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "kk"
    }, s.baseDesc, " ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-mut)"
      }
    }, "· ", s.paidCount, "/", s.total, " pagas")), /*#__PURE__*/React.createElement("span", {
      className: "vv",
      style: {
        textAlign: "right"
      }
    }, brl(nominal), " restantes", economia != null && /*#__PURE__*/React.createElement("div", {
      className: "mm",
      style: {
        marginTop: 2
      }
    }, "economia real ≈ ", brl(economia))));
  }));
}
Parcelamentos = React.memo(Parcelamentos);
function Contas({
  accounts,
  update,
  monthTx,
  txs
}) {
  const [form, setForm] = useState(null);
  const [deleteFlow, setDeleteFlow] = useState(null); // {account, linkedCount}
  const [reassignTo, setReassignTo] = useState("");
  // auditoria de fatura: cola o texto da fatura do banco/cartão e compara com o que já está registrado
  // no app pra aquele cartão naquele mês — "bateu" / "na fatura mas não registrado" / "registrado mas não na fatura"
  const [auditAccount, setAuditAccount] = useState(null);
  const [auditMonth, setAuditMonth] = useState(todayISO().slice(0, 7));
  const [auditText, setAuditText] = useState("");
  const [auditResult, setAuditResult] = useState(null);
  function openAudit(a) {
    setAuditAccount(a);
    setAuditMonth(todayISO().slice(0, 7));
    setAuditText("");
    setAuditResult(null);
  }
  function runAudit() {
    const parsed = parseExtratoText(auditText).filter(it => it.type === "gasto");
    const registered = txs.filter(t => t.type === "gasto" && t.acctId === auditAccount.id && txEffectiveMonth(t, accounts) === auditMonth);
    const usedRegIds = new Set(),
      usedParsedIds = new Set();
    parsed.forEach(p => {
      const match = registered.find(t => !usedRegIds.has(t.id) && t.date === p.date && t.cents === p.cents);
      if (match) {
        usedRegIds.add(match.id);
        usedParsedIds.add(p.id);
      }
    });
    setAuditResult({
      bateu: parsed.filter(p => usedParsedIds.has(p.id)),
      naFaturaNaoRegistrado: parsed.filter(p => !usedParsedIds.has(p.id)),
      registradoNaoNaFatura: registered.filter(t => !usedRegIds.has(t.id))
    });
  }
  const blank = {
    name: "",
    kind: "conta",
    color: "#3B63C4",
    closingDay: "",
    dueDay: "",
    limit: 0,
    openingBalance: 0,
    openingDate: todayISO()
  };
  const COLORS = ["#3B63C4", "#E05A2B", "#12805F", "#C2382F", "#B87C10", "#A57BE0", "#46B7C7", "#8C93A8"];
  const save = () => {
    if (!form.name.trim()) return;
    update(d => ({
      accounts: form.id ? d.accounts.map(x => x.id === form.id ? form : x) : [...d.accounts, {
        ...form,
        id: uid()
      }]
    }));
    setForm(null);
    toast("Conta salva.", "success");
  };
  const remove = a => {
    if (accounts.length <= 1) return toast("Mantenha ao menos uma conta.", "error");
    const linkedCount = txs.filter(t => t.acctId === a.id || t.toAcctId === a.id).length;
    if (linkedCount === 0) {
      askConfirm({
        title: `Excluir ${a.name}?`,
        message: "Esta conta não tem lançamentos associados.",
        onConfirm: () => {
          update(d => ({
            accounts: d.accounts.filter(x => x.id !== a.id)
          }));
          toast("Conta excluída.", "success");
        }
      });
      return;
    }
    const other = accounts.find(x => x.id !== a.id);
    setReassignTo(other ? other.id : "");
    setDeleteFlow({
      account: a,
      linkedCount
    });
  };
  function confirmRemoveWithReassign() {
    if (!deleteFlow || !reassignTo) return;
    const {
      account,
      linkedCount
    } = deleteFlow;
    update(d => ({
      accounts: d.accounts.filter(x => x.id !== account.id),
      transactions: d.transactions.map(t => t.acctId === account.id || t.toAcctId === account.id ? {
        ...t,
        acctId: t.acctId === account.id ? reassignTo : t.acctId,
        toAcctId: t.toAcctId === account.id ? reassignTo : t.toAcctId
      } : t)
    }));
    toast(`Conta excluída. ${linkedCount} lançamento(s) movido(s) para outra conta.`, "success");
    setDeleteFlow(null);
  }
  const cardTotal = id => cardInvoiceNet(monthTx, id);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("h3", null, "Contas e cartões ", /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => setForm(blank)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "adicionar",
    size: 14
  }), " Adicionar"), /*#__PURE__*/React.createElement(HelpIcon, {
    section: "contas-cartoes"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Organize de onde entra e sai cada valor. Cartões mostram a fatura do mês."), form && /*#__PURE__*/React.createElement("div", {
    className: "miniform"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Nome (ex: Nubank, Carteira)",
    value: form.name,
    onChange: e => setForm({
      ...form,
      name: e.target.value
    }),
    style: {
      marginBottom: 10
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "seg",
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: form.kind === "conta" ? "on in" : "",
    onClick: () => setForm({
      ...form,
      kind: "conta"
    })
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "banco",
    size: 14
  }), " Conta"), /*#__PURE__*/React.createElement("button", {
    className: form.kind === "cartao" ? "on inv" : "",
    onClick: () => setForm({
      ...form,
      kind: "cartao"
    })
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "cartao",
    size: 14
  }), " Cartão")), form.kind === "cartao" && /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "1",
    max: "31",
    placeholder: "Dia de fechamento",
    value: form.closingDay || "",
    onChange: e => setForm({
      ...form,
      closingDay: e.target.value ? parseInt(e.target.value, 10) : ""
    })
  }), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "number",
    min: "1",
    max: "31",
    placeholder: "Dia de vencimento",
    value: form.dueDay || "",
    onChange: e => setForm({
      ...form,
      dueDay: e.target.value ? parseInt(e.target.value, 10) : ""
    })
  })), form.kind === "cartao" && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Limite do cartão"), /*#__PURE__*/React.createElement(Money, {
    cents: form.limit || 0,
    onChange: v => setForm({
      ...form,
      limit: v
    }),
    small: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Saldo inicial (o que já tinha antes de começar a registrar aqui)"), /*#__PURE__*/React.createElement(Money, {
    cents: form.openingBalance || 0,
    onChange: v => setForm({
      ...form,
      openingBalance: v
    }),
    small: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 4
    }
  }, "Data do saldo inicial"), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "date",
    value: form.openingDate || "",
    onChange: e => setForm({
      ...form,
      openingDate: e.target.value
    })
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 12
    }
  }, COLORS.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    "aria-label": "Cor " + c,
    onClick: () => setForm({
      ...form,
      color: c
    }),
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      background: c,
      border: form.color === c ? "2px solid var(--text)" : "2px solid transparent",
      cursor: "pointer"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    onClick: save
  }, "Salvar"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => setForm(null)
  }, "Cancelar"))), accounts.map(a => {
    const inv = cardTotal(a.id);
    return /*#__PURE__*/React.createElement("div", {
      className: "acct",
      key: a.id,
      style: {
        flexDirection: "column",
        alignItems: "stretch",
        gap: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "adot",
      style: {
        background: a.color
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: a.kind === "cartao" ? "cartao" : "banco",
      size: 16
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "aname"
    }, a.name), /*#__PURE__*/React.createElement("div", {
      className: "akind"
    }, a.kind === "cartao" ? /*#__PURE__*/React.createElement(React.Fragment, null, "Cartão", a.closingDay ? ` · fecha dia ${a.closingDay}` : "", a.dueDay ? ` · vence dia ${a.dueDay}` : "", " · fatura do mês ", inv.net === 0 && inv.gasto > 0 ? "quitada" : brl(inv.net), inv.credit > 0 ? ` · ${brl(inv.credit)} pagos a mais` : "") : "Conta", a.openingBalance ? /*#__PURE__*/React.createElement(React.Fragment, null, " · saldo inicial ", brl(a.openingBalance), a.openingDate ? ` em ${fmtDateBR(a.openingDate)}` : "") : "")), a.kind === "cartao" && /*#__PURE__*/React.createElement("button", {
      className: "sbtn iconsbtn",
      "aria-label": "Auditar fatura",
      onClick: () => openAudit(a)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "documento",
      size: 14
    })), /*#__PURE__*/React.createElement("button", {
      className: "sbtn iconsbtn",
      "aria-label": "Editar",
      onClick: () => setForm(a)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "editar",
      size: 14
    })), /*#__PURE__*/React.createElement("button", {
      className: "sbtn iconsbtn",
      "aria-label": "Excluir",
      onClick: () => remove(a)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "excluir",
      size: 14
    }))), a.kind === "cartao" && a.limit > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8,
        marginLeft: 48
      }
    }, /*#__PURE__*/React.createElement(ProgressBar, {
      spent: inv.net,
      limit: a.limit,
      status: inv.net >= a.limit ? "over" : inv.net / a.limit >= 0.8 ? "warn" : "ok"
    }), /*#__PURE__*/React.createElement("div", {
      className: "mm"
    }, Math.min(100, inv.net / a.limit * 100).toFixed(0), "% do limite comprometido · ", brl(inv.net), " de ", brl(a.limit), inv.credit > 0 ? ` · sobrou ${brl(inv.credit)} pago a mais` : "")));
  })), /*#__PURE__*/React.createElement(Parcelamentos, {
    txs: txs
  }), /*#__PURE__*/React.createElement(Sheet, {
    open: !!deleteFlow,
    onClose: () => setDeleteFlow(null),
    title: deleteFlow ? `Excluir ${deleteFlow.account.name}?` : ""
  }, deleteFlow && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: "var(--text-mut)",
      marginBottom: 14,
      lineHeight: 1.5
    }
  }, "Esta conta tem ", deleteFlow.linkedCount, " lançamento", deleteFlow.linkedCount === 1 ? "" : "s", " associado", deleteFlow.linkedCount === 1 ? "" : "s", ". Escolha para onde movê-los antes de excluir."), /*#__PURE__*/React.createElement("select", {
    className: "fld",
    value: reassignTo,
    onChange: e => setReassignTo(e.target.value),
    style: {
      marginBottom: 16
    }
  }, accounts.filter(x => x.id !== deleteFlow.account.id).map(x => /*#__PURE__*/React.createElement("option", {
    key: x.id,
    value: x.id
  }, x.name))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: () => setDeleteFlow(null)
  }, "Cancelar"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn danger",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: confirmRemoveWithReassign
  }, "Excluir e mover")))), /*#__PURE__*/React.createElement(Sheet, {
    open: !!auditAccount,
    onClose: () => setAuditAccount(null),
    title: auditAccount ? `Auditar fatura · ${auditAccount.name}` : ""
  }, auditAccount && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 8
    }
  }, "Cole abaixo o texto da fatura (mesmo formato aceito em \"Importar do banco\") e escolha o mês de referência."), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    type: "month",
    value: auditMonth,
    onChange: e => {
      setAuditMonth(e.target.value);
      setAuditResult(null);
    },
    style: {
      marginBottom: 10
    }
  }), /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: 6,
    style: {
      resize: "vertical",
      fontFamily: "'IBM Plex Mono',monospace",
      fontSize: 13,
      marginBottom: 10
    },
    placeholder: "01/07/2026 Compra Mercado XYZ -150,00\n05/07/2026 Uber -32,00",
    value: auditText,
    onChange: e => {
      setAuditText(e.target.value);
      setAuditResult(null);
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    onClick: runAudit,
    disabled: !auditText.trim()
  }, "Analisar fatura"), auditResult && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14
  }), " Bateu"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, auditResult.bateu.length, " · ", brl(auditResult.bateu.reduce((s, p) => s + p.cents, 0)))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alerta",
    size: 14
  }), " Na fatura, não registrado"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: "var(--warn)"
    }
  }, auditResult.naFaturaNaoRegistrado.length, " · ", brl(auditResult.naFaturaNaoRegistrado.reduce((s, p) => s + p.cents, 0)))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alerta",
    size: 14
  }), " Registrado, não na fatura"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: "var(--neg)"
    }
  }, auditResult.registradoNaoNaFatura.length, " · ", brl(auditResult.registradoNaoNaFatura.reduce((s, p) => s + p.cents, 0)))), auditResult.naFaturaNaoRegistrado.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 6
    }
  }, "Na fatura mas não registrado no app"), auditResult.naFaturaNaoRegistrado.map(p => /*#__PURE__*/React.createElement("div", {
    className: "kv",
    key: p.id
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, fmtDateBR(p.date), " · ", p.desc || "—"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, brl(p.cents))))), auditResult.registradoNaoNaFatura.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginBottom: 6
    }
  }, "Registrado no app mas não encontrado na fatura"), auditResult.registradoNaoNaFatura.map(t => /*#__PURE__*/React.createElement("div", {
    className: "kv",
    key: t.id
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, fmtDateBR(t.date), " · ", t.description || t.category), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, brl(t.cents))))), auditResult.naFaturaNaoRegistrado.length === 0 && auditResult.registradoNaoNaFatura.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      color: "var(--pos)"
    }
  }, "Tudo bateu — a fatura corresponde exatamente ao que está registrado.")))));
}
Contas = React.memo(Contas);

/* ---------- ASSISTENTE (perguntas em linguagem natural sobre os dados do usuário) ---------- */
const ASSISTANT_TX_CAP = 3000;
function Perguntar({
  txs,
  accounts
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setQuestion("");
    const entry = {
      q,
      a: "",
      error: ""
    };
    setHistory(h => [...h, entry]);
    try {
      const acctNames = Object.fromEntries(accounts.map(a => [a.id, a.name]));
      const capped = txs.length > ASSISTANT_TX_CAP;
      const sample = capped ? txs.slice(0, ASSISTANT_TX_CAP) : txs;
      const lines = sample.map(t => `${t.date};${TYPES[t.type].label};${t.category};${acctNames[t.acctId] || "?"};${(t.cents / 100).toFixed(2)};${t.description || ""}`).join("\n");
      const prompt = `Você é um assistente financeiro. Abaixo está o histórico de lançamentos do usuário, um por linha, no formato "data;tipo;categoria;conta;valor;descrição" (valor em reais)${capped ? ` — mostrando os ${ASSISTANT_TX_CAP} lançamentos mais recentes de um histórico maior` : ""}:

${lines || "(nenhum lançamento registrado ainda)"}

Pergunta do usuário: "${q}"

Responda de forma direta e curta, em português do Brasil, baseando-se SOMENTE nos dados acima. Se não houver dados suficientes para responder com confiança, diga isso claramente em vez de inventar um número.`;
      const text = await callGemini({
        prompt
      });
      setHistory(h => h.map(item => item === entry ? {
        ...item,
        a: text.trim()
      } : item));
    } catch (err) {
      setHistory(h => h.map(item => item === entry ? {
        ...item,
        error: err.message || "Não foi possível obter uma resposta."
      } : item));
    } finally {
      setBusy(false);
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("h3", null, "Assistente ", /*#__PURE__*/React.createElement(HelpIcon, {
    section: "assistente-ajuda"
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Pergunte qualquer coisa sobre seus lançamentos, em linguagem natural."), history.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Exemplos: \"quanto gastei com Uber esse ano?\", \"qual foi meu maior gasto em julho?\", \"quanto recebi de proventos em 2026?\""), history.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16,
      marginBottom: 16
    }
  }, history.map((item, i) => /*#__PURE__*/React.createElement("div", {
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      marginBottom: 4
    }
  }, "Você perguntou: ", item.q), item.error ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--neg)"
    }
  }, item.error) : item.a ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      lineHeight: 1.6
    }
  }, item.a) : /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-mut)"
    }
  }, "Pensando…")))), /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Pergunte algo sobre suas finanças…",
    value: question,
    onChange: e => setQuestion(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") ask();
    },
    disabled: busy
  })), /*#__PURE__*/React.createElement("button", {
    className: "submit",
    onClick: ask,
    disabled: busy || !question.trim()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 15
  }), " ", busy ? "Perguntando…" : "Perguntar"));
}
Perguntar = React.memo(Perguntar);

/* ---------- EXTRATO INTELIGENTE ---------- */
const EXTRATO_LINE_RE = /(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
function parseExtratoText(text) {
  const year = new Date().getFullYear();
  const out = [];
  text.split(/\n+/).forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(EXTRATO_LINE_RE);
    if (!m) return;
    const [, dpart, desc, vpart] = m;
    const [dd, mm, yy] = dpart.split("/");
    const yr = yy ? yy.length === 2 ? "20" + yy : yy : String(year);
    const iso = `${yr}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    const neg = vpart.trim().startsWith("-");
    const num = parseFloat(vpart.replace(/-/g, "").replace(/\./g, "").replace(",", "."));
    if (isNaN(num)) return;
    const cents = Math.round(num * 100);
    const type = neg ? "gasto" : "ganho";
    out.push({
      id: uid(),
      date: iso,
      desc: desc.trim(),
      cents,
      type,
      category: CATS[type][0][0],
      acctId: ""
    });
  });
  return out;
}
/* ---------- IMPORTAR DO BANCO (importação em lote de extratos e faturas) ----------
   A ideia é chegar o mais perto possível de um "open finance manual": a pessoa joga TODOS os PDFs do mês
   (extratos das contas + faturas dos cartões) de uma vez, e o app cuida do resto — descobre de qual banco
   é cada documento, se é extrato ou fatura, casa com a conta cadastrada e classifica cada linha, separando
   gasto, entrada, investimento, pagamento de fatura e transferência entre bancos. Nada é salvo sem revisão. */

const DOC_PHASES = {
  fila: {
    label: "Na fila",
    weight: 0
  },
  lendo: {
    label: "Abrindo o arquivo",
    weight: 0.06
  },
  ia: {
    label: "IA lendo o documento",
    weight: 0.15
  },
  conferindo: {
    label: "Conferindo os lançamentos",
    weight: 0.92
  },
  pronto: {
    label: "Pronto",
    weight: 1
  },
  erro: {
    label: "Falhou",
    weight: 1
  }
};
const DOC_TIPO_LABEL = {
  extrato: "Extrato",
  fatura: "Fatura",
  recibo: "Recibo",
  outro: "Documento"
};
const MAX_DOC_BYTES = 3 * 1024 * 1024;
const VALOR_COR = {
  gasto: "var(--neg)",
  ganho: "var(--pos)",
  investimento: "var(--inv)",
  transferencia: "var(--trf)"
};
const daysApart = (a, b) => Math.abs((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000);
const normDesc = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
function Extrato({
  accounts,
  update,
  txs,
  aiModel
}) {
  const [docs, setDocs] = useState([]); // um por arquivo enviado, com status e progresso próprios
  const [items, setItems] = useState([]); // lançamentos reconhecidos, cada um apontando para o docId de origem
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState("");
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const runningRef = useRef(false);
  const queueRef = useRef([]); // fila real de processamento: aceita arquivos jogados enquanto outra leva roda

  const patchDoc = (id, patch) => setDocs(ds => ds.map(d => d.id === id ? {
    ...d,
    ...patch
  } : d));

  // avanço "de dentro" do documento enquanto a IA pensa: a barra caminha em direção ao fim da fase (88%)
  // sem nunca alcançá-la, para não prometer conclusão antes da resposta chegar. Os saltos de verdade
  // (arquivo aberto, resposta recebida, documento pronto) são os que movem o número para valer.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setDocs(ds => ds.map(d => d.status === "ia" ? {
        ...d,
        progress: Math.min(0.88, d.progress + (0.9 - d.progress) * 0.05)
      } : d));
    }, 400);
    return () => clearInterval(t);
  }, [running]);
  const overall = useMemo(() => {
    if (docs.length === 0) return 0;
    return docs.reduce((s, d) => s + Math.min(1, d.progress), 0) / docs.length;
  }, [docs]);
  const doneCount = docs.filter(d => d.status === "pronto" || d.status === "erro").length;
  const currentDoc = docs.find(d => d.status !== "pronto" && d.status !== "erro" && d.status !== "fila");
  async function processOne(doc) {
    patchDoc(doc.id, {
      status: "lendo",
      progress: DOC_PHASES.lendo.weight
    });
    let aiError = "";
    try {
      const base64 = await fileToBase64(doc.file);
      patchDoc(doc.id, {
        status: "ia",
        progress: DOC_PHASES.ia.weight
      });
      const res = await analyzeDocumentWithAI({
        base64,
        mimeType: doc.file.type || "application/pdf",
        fileName: doc.name,
        accounts,
        model: aiModelId(aiModel)
      });
      patchDoc(doc.id, {
        status: "conferindo",
        progress: DOC_PHASES.conferindo.weight
      });
      const {
        meta,
        rows
      } = mapAiDocument(res, accounts, doc.id);
      if (rows.length === 0) throw new Error("A IA não encontrou nenhum lançamento neste arquivo.");
      setItems(prev => [...prev, ...rows]);
      patchDoc(doc.id, {
        status: "pronto",
        progress: 1,
        meta,
        count: rows.length,
        file: null
      });
      return;
    } catch (err) {
      aiError = err.message || "Falha ao analisar com IA.";
    }
    // rede de segurança: sem IA disponível, ainda dá para extrair o texto do PDF localmente e usar o
    // parser por regex (só reconhece gasto/ganho, sem identificar banco nem transferência)
    if (/pdf/i.test(doc.file?.type || "") || /\.pdf$/i.test(doc.name)) {
      try {
        patchDoc(doc.id, {
          status: "conferindo",
          progress: DOC_PHASES.conferindo.weight
        });
        await loadPdfJs();
        const buf = await doc.file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({
          data: buf
        }).promise;
        const extracted = await extractPdfText(pdf);
        const rows = localRowsFromText(extracted, doc.id, accounts);
        if (rows.length === 0) throw new Error("Nenhuma linha reconhecida (o PDF pode ser uma imagem escaneada).");
        setItems(prev => [...prev, ...rows]);
        patchDoc(doc.id, {
          status: "pronto",
          progress: 1,
          count: rows.length,
          file: null,
          aviso: `IA indisponível (${aiError}) — lido localmente, sem identificar banco nem transferências.`,
          meta: {
            tipo: "outro",
            banco: "",
            contaId: accounts[0]?.id || "",
            contaAuto: false,
            periodoInicio: "",
            periodoFim: "",
            vencimento: "",
            totalDocumento: 0,
            confianca: null,
            observacao: "",
            fonte: "local"
          }
        });
        return;
      } catch (localErr) {
        patchDoc(doc.id, {
          status: "erro",
          progress: 1,
          error: `${aiError} ${localErr.message || ""}`.trim(),
          file: null
        });
        return;
      }
    }
    patchDoc(doc.id, {
      status: "erro",
      progress: 1,
      error: aiError,
      file: null
    });
  }
  async function addFiles(fileList) {
    const all = Array.from(fileList || []);
    const accepted = all.filter(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) || /^image\//.test(f.type));
    if (accepted.length === 0) {
      toast("Envie arquivos PDF ou imagens.", "error");
      return;
    }
    if (accepted.length < all.length) toast(`${all.length - accepted.length} arquivo(s) ignorado(s): só PDF e imagem.`, "error");
    // o arquivo trafega em base64 (≈ +33%) dentro de um JSON; acima disso a função serverless recusa o corpo
    const grandes = accepted.filter(f => f.size > MAX_DOC_BYTES);
    if (grandes.length) toast(`${grandes.length} arquivo(s) acima de 3 MB podem falhar na IA — separe em partes menores se der erro.`, "error");
    const novos = accepted.map(f => ({
      id: uid(),
      name: f.name,
      size: f.size,
      file: f,
      status: "fila",
      progress: 0,
      error: "",
      aviso: "",
      meta: null,
      count: 0
    }));
    setDocs(ds => [...ds, ...novos]);
    queueRef.current.push(...novos);
    if (runningRef.current) return; // já tem uma leva rodando: ela vai consumir estes também
    runningRef.current = true;
    setRunning(true);
    try {
      // um de cada vez: evita estourar a cota gratuita da IA e mantém o progresso legível
      while (queueRef.current.length) await processOne(queueRef.current.shift());
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }
  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }
  function analisarTexto() {
    const rows = localRowsFromText(text, "manual", accounts);
    if (rows.length === 0) {
      toast("Nenhuma linha reconhecida no texto colado.", "error");
      return;
    }
    const manualDoc = {
      id: "manual",
      name: "Texto colado",
      size: 0,
      file: null,
      status: "pronto",
      progress: 1,
      error: "",
      aviso: "",
      count: rows.length,
      meta: {
        tipo: "outro",
        banco: "",
        contaId: accounts[0]?.id || "",
        contaAuto: false,
        periodoInicio: "",
        periodoFim: "",
        vencimento: "",
        totalDocumento: 0,
        confianca: null,
        observacao: "",
        fonte: "local"
      }
    };
    setDocs(ds => ds.some(d => d.id === "manual") ? ds.map(d => d.id === "manual" ? manualDoc : d) : [...ds, manualDoc]);
    setItems(prev => [...prev.filter(it => it.docId !== "manual"), ...rows]);
  }
  function updateItem(id, patch) {
    setItems(its => its.map(it => it.id === id ? {
      ...it,
      ...patch
    } : it));
  }
  function removeItem(id) {
    setItems(its => its.filter(it => it.id !== id));
  }
  function removeDoc(id) {
    setItems(its => its.filter(it => it.docId !== id));
    setDocs(ds => ds.filter(d => d.id !== id));
  }
  function limparTudo() {
    setItems([]);
    setDocs([]);
    setText("");
  }

  // trocar a conta do documento reetiqueta todos os lançamentos dele de uma vez — inclusive o outro lado
  // das transferências, quando era o documento que ocupava aquela ponta
  function setDocAccount(docId, newAcct) {
    const doc = docs.find(d => d.id === docId);
    const old = doc?.meta?.contaId || "";
    patchDoc(docId, {
      meta: {
        ...doc.meta,
        contaId: newAcct,
        contaAuto: false
      }
    });
    setItems(its => its.map(it => it.docId !== docId ? it : {
      ...it,
      acctId: it.acctId === old || !it.acctId && it.type !== "transferencia" ? newAcct : it.acctId,
      toAcctId: it.toAcctId === old ? newAcct : it.toAcctId
    }));
  }

  // duplicata contra o histórico já salvo: mesma data, valor, tipo e descrição
  const dupHistorico = useMemo(() => {
    const set = new Set();
    items.forEach(it => {
      const dup = txs.some(t => t.date === it.date && t.cents === it.cents && t.type === it.type && normDesc(t.description) === normDesc(it.desc));
      if (dup) set.add(it.id);
    });
    return set;
  }, [items, txs]);
  // duplicata ENTRE documentos: o caso clássico é o pagamento da fatura, que aparece tanto no extrato da
  // conta quanto na própria fatura do cartão. Mesmo valor, mesmo tipo, datas próximas, documentos diferentes.
  const dupEntreDocs = useMemo(() => {
    const set = new Set();
    const vistos = [];
    items.forEach(it => {
      const tol = it.type === "transferencia" ? 3 : 0;
      const hit = vistos.find(v => v.docId !== it.docId && v.cents === it.cents && v.type === it.type && daysApart(v.date, it.date) <= tol && (it.type === "transferencia" || normDesc(v.desc) === normDesc(it.desc)));
      if (hit) set.add(it.id);else vistos.push(it);
    });
    return set;
  }, [items]);
  const isDup = id => dupHistorico.has(id) || dupEntreDocs.has(id);
  // assim que um item é marcado como duplicata, ele sai da seleção sozinho (mas continua visível e aprovável)
  const dupApplied = useRef(new Set());
  useEffect(() => {
    const novos = items.filter(it => isDup(it.id) && !dupApplied.current.has(it.id)).map(it => it.id);
    if (novos.length === 0) return;
    novos.forEach(id => dupApplied.current.add(id));
    setItems(its => its.map(it => novos.includes(it.id) ? {
      ...it,
      selected: false
    } : it));
  }, [dupHistorico, dupEntreDocs]);
  const itemOk = it => it.acctId && (it.type !== "transferencia" || it.toAcctId && it.toAcctId !== it.acctId);
  // no celular a lista viria com 8 campos por lançamento — uma fatura de 30 linhas viraria um rolo sem fim.
  // Cada item aparece resumido em duas linhas e só abre os campos quando a pessoa toca em "ajustar".
  // O que precisa de decisão (falta conta, falta destino da transferência) já nasce aberto.
  const isDesktop = useIsDesktop();
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = id => setExpanded(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const nomeConta = id => accounts.find(a => a.id === id)?.name || "conta não escolhida";
  const prontos = items.filter(it => it.selected && itemOk(it));
  const pendentes = items.filter(it => it.selected && !itemOk(it));
  const resumo = useMemo(() => {
    const s = {
      gasto: 0,
      ganho: 0,
      investimento: 0,
      transferencia: 0,
      nTrf: 0
    };
    items.filter(it => it.selected).forEach(it => {
      s[it.type] += it.cents;
      if (it.type === "transferencia") s.nTrf++;
    });
    return s;
  }, [items]);
  function toTx(it) {
    const base = {
      id: uid(),
      type: it.type,
      cents: it.cents,
      category: it.type === "transferencia" ? "" : it.category,
      description: it.desc,
      date: it.date,
      acctId: it.acctId,
      status: it.date > todayISO() ? "previsto" : "realizado"
    };
    if (it.type === "transferencia") base.toAcctId = it.toAcctId;
    return base;
  }
  function aprovar(lista) {
    if (lista.length === 0) return;
    const entries = lista.map(toTx);
    // alimenta a memória de categorização com o que foi confirmado aqui: da próxima vez que essa mesma
    // descrição aparecer (na mão ou noutro extrato), a categoria já vem sugerida sem custar chamada de IA
    const memoria = {};
    lista.forEach(it => {
      if (it.type !== "transferencia" && it.desc.trim()) memoria[it.desc.trim().toLowerCase()] = it.category;
    });
    update(d => ({
      transactions: [...entries, ...d.transactions],
      categoryMemory: {
        ...(d.categoryMemory || {}),
        ...memoria
      }
    }));
    const ids = new Set(lista.map(it => it.id));
    setItems(its => its.filter(it => !ids.has(it.id)));
    toast(`${entries.length} lançamento${entries.length === 1 ? "" : "s"} importado${entries.length === 1 ? "" : "s"}.`, "success");
  }
  const docsComItens = docs.filter(d => items.some(it => it.docId === d.id));
  // a IA casa o documento com a conta pelo NOME do banco. Enquanto as contas tiverem os nomes
  // genéricos que vêm de fábrica, esse casamento não tem como acontecer e a pessoa acaba
  // escolhendo a conta na mão em todo documento — vale avisar antes de ela perder tempo.
  const contasGenericas = accounts.filter(a => /^(conta|cartão|cartao|conta principal|cartão de crédito|cartao de credito|carteira|banco)$/i.test((a.name || "").trim()));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("h3", null, "Importar do banco ", /*#__PURE__*/React.createElement(HelpIcon, {
    section: "extrato-ajuda"
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Jogue aqui todos os PDFs do mês — extratos das contas e faturas dos cartões, de uma vez. A IA descobre de qual banco é cada documento, se é extrato ou fatura, e separa gasto, entrada, investimento, pagamento de fatura e transferência entre os seus bancos. Nada entra no app antes de você revisar."), contasGenericas.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "banner",
    style: {
      marginBottom: 14,
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 200
    }
  }, "Antes de importar, vale renomear ", contasGenericas.length === 1 ? "a conta" : "as contas", " ", contasGenericas.map(a => `"${a.name}"`).join(", "), " com o nome do banco de verdade (Nubank, Itaú, Inter, C6…). É por esse nome que a IA descobre sozinha a qual conta cada PDF pertence — com nome genérico, você teria que escolher em cada documento."), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => goToTab("contas")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "banco",
    size: 14
  }), " Renomear agora")), /*#__PURE__*/React.createElement("div", {
    className: "dropzone" + (dragOver ? " over" : ""),
    onClick: () => fileRef.current?.click(),
    onDragOver: e => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: onDrop,
    role: "button",
    tabIndex: 0,
    onKeyDown: e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileRef.current?.click();
      }
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "documento",
    size: 26,
    style: {
      opacity: .5
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "dzt"
  }, "Arraste os PDFs aqui ou clique para escolher"), /*#__PURE__*/React.createElement("div", {
    className: "dzs"
  }, "Pode mandar vários de uma vez: extrato do banco A, do banco B, fatura do cartão C…", /*#__PURE__*/React.createElement("br", null), "PDF ou foto (JPG/PNG) de recibo.")), /*#__PURE__*/React.createElement("input", {
    ref: fileRef,
    type: "file",
    accept: "application/pdf,image/*",
    multiple: true,
    style: {
      display: "none"
    },
    onChange: e => {
      addFiles(e.target.files);
      e.target.value = "";
    }
  }), /*#__PURE__*/React.createElement("input", {
    ref: cameraRef,
    type: "file",
    accept: "image/*",
    capture: "environment",
    style: {
      display: "none"
    },
    onChange: e => {
      addFiles(e.target.files);
      e.target.value = "";
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 12,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => cameraRef.current?.click()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "camera",
    size: 14
  }), " Fotografar recibo"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    onClick: () => setShowText(v => !v)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "editar",
    size: 14
  }), " ", showText ? "Esconder" : "Colar texto"), (docs.length > 0 || items.length > 0) && /*#__PURE__*/React.createElement("button", {
    className: "sbtn danger",
    onClick: limparTudo,
    disabled: running
  }, "Limpar tudo")), showText && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    className: "fld",
    rows: 5,
    style: {
      resize: "vertical",
      fontFamily: "'IBM Plex Mono',monospace",
      fontSize: 13,
      marginBottom: 8
    },
    placeholder: "01/07/2026 Compra Mercado XYZ -150,00\n05/07/2026 PIX recebido 500,00",
    value: text,
    onChange: e => setText(e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    onClick: analisarTexto,
    disabled: !text.trim()
  }, "Analisar texto colado"), /*#__PURE__*/React.createElement("p", {
    className: "hint"
  }, "Leitura local, sem IA: uma linha por lançamento, no formato \"DD/MM/AAAA descrição valor\". Valor negativo vira gasto, positivo vira ganho."))), docs.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      marginTop: 14
    }
  }, running && /*#__PURE__*/React.createElement("div", {
    className: "aithink"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aiorb"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("span", {
    className: "core"
  })), /*#__PURE__*/React.createElement("div", {
    className: "aibody"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aititle"
  }, /*#__PURE__*/React.createElement("span", null, "Analisando seus documentos", /*#__PURE__*/React.createElement("span", {
    className: "aidots"
  })), /*#__PURE__*/React.createElement("span", {
    className: "aipct"
  }, Math.round(overall * 100), "%")), /*#__PURE__*/React.createElement("div", {
    className: "aiphase"
  }, doneCount, " de ", docs.length, " concluído", doneCount === 1 ? "" : "s", currentDoc ? ` · ${DOC_PHASES[currentDoc.status].label}: ${currentDoc.name}` : ""), /*#__PURE__*/React.createElement("div", {
    className: "aibar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: `${Math.max(2, overall * 100)}%`
    }
  }), /*#__PURE__*/React.createElement("span", null)))), !running && docs.length > 0 && /*#__PURE__*/React.createElement("h3", {
    style: {
      marginBottom: 8
    }
  }, "Documentos (", docs.length, ")"), docs.map(d => /*#__PURE__*/React.createElement("div", {
    className: "docrow",
    key: d.id
  }, /*#__PURE__*/React.createElement(Icon, {
    name: d.meta?.tipo === "fatura" ? "cartao" : d.meta?.tipo === "recibo" ? "camera" : "documento",
    size: 15,
    style: {
      color: d.status === "erro" ? "var(--neg)" : "var(--text-mut)",
      flex: "0 0 auto"
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "dname"
  }, d.name), d.status === "pronto" && /*#__PURE__*/React.createElement("span", {
    className: "dstat",
    style: {
      color: "var(--pos)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 12
  }), " ", d.count, " lançamento", d.count === 1 ? "" : "s"), d.status === "erro" && /*#__PURE__*/React.createElement("span", {
    className: "dstat",
    style: {
      color: "var(--neg)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alerta",
    size: 12
  }), " falhou"), d.status === "fila" && /*#__PURE__*/React.createElement("span", {
    className: "dstat"
  }, "na fila"), ["lendo", "ia", "conferindo"].includes(d.status) && /*#__PURE__*/React.createElement("span", {
    className: "dstat"
  }, /*#__PURE__*/React.createElement("i", {
    className: "dspin"
  }), " ", DOC_PHASES[d.status].label, " · ", Math.round(d.progress * 100), "%"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn iconsbtn",
    "aria-label": "Remover documento",
    disabled: running,
    onClick: () => removeDoc(d.id)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "fechar",
    size: 13
  })))), docs.filter(d => d.status === "erro").map(d => /*#__PURE__*/React.createElement("p", {
    className: "hint",
    key: d.id,
    style: {
      color: "var(--neg)"
    }
  }, d.name, ": ", d.error)), docs.filter(d => d.aviso).map(d => /*#__PURE__*/React.createElement("p", {
    className: "hint",
    key: d.id,
    style: {
      color: "var(--warn)"
    }
  }, d.name, ": ", d.aviso))), items.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("h3", null, "Revisar e importar ", /*#__PURE__*/React.createElement("span", {
    className: "aipct"
  }, prontos.length, " de ", items.length)), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Confira o que a IA entendeu. Desmarque o que não quiser, ajuste conta, tipo e categoria — e importe tudo de uma vez."), /*#__PURE__*/React.createElement("div", {
    className: "stats",
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "enviar",
    size: 12
  }), "Gastos"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--neg)"
    }
  }, brl(resumo.gasto))), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 12
  }), "Entradas"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--pos)"
    }
  }, brl(resumo.ganho))), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "investimentos",
    size: 12
  }), "Investido"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--inv)"
    }
  }, brl(resumo.investimento))), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "transferencia",
    size: 12
  }), "Transferências"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      color: "var(--trf)"
    }
  }, resumo.nTrf, " · ", brl(resumo.transferencia)))), (dupHistorico.size > 0 || dupEntreDocs.size > 0) && /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      color: "var(--warn)",
      marginTop: 0,
      marginBottom: 10
    }
  }, dupHistorico.size > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, dupHistorico.size, " item(ns) já existem no seu histórico. "), dupEntreDocs.size > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, dupEntreDocs.size, " item(ns) aparecem em dois documentos ao mesmo tempo (típico do pagamento da fatura, que sai no extrato e chega na fatura). "), "Já vieram desmarcados — marque de novo se forem lançamentos legítimos e diferentes."), pendentes.length > 0 && /*#__PURE__*/React.createElement("p", {
    className: "hint",
    style: {
      color: "var(--warn)",
      marginTop: 0,
      marginBottom: 10
    }
  }, pendentes.length, " item(ns) marcados ainda estão sem conta (ou sem o destino da transferência) e não serão importados até você escolher."), docsComItens.map(doc => {
    const docItems = items.filter(it => it.docId === doc.id);
    const selDoc = docItems.filter(it => it.selected);
    const acct = accounts.find(a => a.id === doc.meta?.contaId);
    const tipo = doc.meta?.tipo || "outro";
    return /*#__PURE__*/React.createElement("div", {
      key: doc.id
    }, /*#__PURE__*/React.createElement("div", {
      className: "dochead"
    }, /*#__PURE__*/React.createElement("span", {
      className: "badge " + tipo
    }, DOC_TIPO_LABEL[tipo]), /*#__PURE__*/React.createElement("b", {
      style: {
        fontSize: 13
      }
    }, doc.meta?.banco || doc.name), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--text-mut)"
      }
    }, doc.meta?.periodoInicio && doc.meta?.periodoFim ? `${fmtDateBR(doc.meta.periodoInicio)} a ${fmtDateBR(doc.meta.periodoFim)} · ` : "", docItems.length, " lançamento", docItems.length === 1 ? "" : "s", doc.meta?.totalDocumento > 0 ? ` · total ${brl(doc.meta.totalDocumento)}` : ""), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--text-mut)"
      }
    }, tipo === "fatura" ? "Cartão:" : "Conta:"), /*#__PURE__*/React.createElement("select", {
      className: "fld",
      style: {
        width: "auto",
        minWidth: 150,
        padding: "7px 10px",
        fontSize: 13
      },
      value: doc.meta?.contaId || "",
      onChange: e => setDocAccount(doc.id, e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "Escolher…"), accounts.map(a => /*#__PURE__*/React.createElement("option", {
      key: a.id,
      value: a.id
    }, a.name, a.kind === "cartao" ? " (cartão)" : ""))), /*#__PURE__*/React.createElement("button", {
      className: "sbtn",
      onClick: () => setItems(its => its.map(it => it.docId === doc.id ? {
        ...it,
        selected: selDoc.length !== docItems.length
      } : it))
    }, selDoc.length === docItems.length ? "Desmarcar todos" : "Marcar todos"))), /*#__PURE__*/React.createElement("div", {
      className: "docbody"
    }, doc.meta?.observacao && /*#__PURE__*/React.createElement("p", {
      className: "hint",
      style: {
        marginTop: 0,
        marginBottom: 8
      }
    }, doc.meta.observacao, doc.meta.confianca != null ? ` · confiança ${Math.round(doc.meta.confianca * 100)}%` : ""), acct && tipo === "fatura" && acct.kind !== "cartao" && /*#__PURE__*/React.createElement("p", {
      className: "hint",
      style: {
        color: "var(--warn)",
        marginTop: 0
      }
    }, "Esta é uma fatura de cartão, mas a conta escolhida não é um cartão — os gastos vão entrar na conta bancária."), docItems.map(it => {
      const dup = isDup(it.id);
      const falta = !itemOk(it);
      const aberto = isDesktop || expanded.has(it.id) || falta;
      return /*#__PURE__*/React.createElement("div", {
        className: "itemrow" + (it.selected ? "" : " off"),
        key: it.id
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: it.selected,
        onChange: e => updateItem(it.id, {
          selected: e.target.checked
        }),
        "aria-label": "Importar este lançamento"
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          minWidth: 0
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "row2",
        style: {
          marginBottom: aberto ? 6 : 0,
          alignItems: "center"
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "num",
        style: {
          fontSize: 12,
          color: "var(--text-mut)",
          flex: "0 0 auto",
          minWidth: 0
        }
      }, fmtDateBR(it.date)), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 13,
          flex: "2 1 200px"
        }
      }, it.desc || "—", dup && /*#__PURE__*/React.createElement("span", {
        className: "tag warn",
        style: {
          marginLeft: 6
        }
      }, "duplicata"), it.confidence != null && it.confidence < 0.6 && /*#__PURE__*/React.createElement("span", {
        className: "tag warn",
        style: {
          marginLeft: 6
        }
      }, "conferir"), it.natureza === "pagamento_fatura" && /*#__PURE__*/React.createElement("span", {
        className: "tag ok",
        style: {
          marginLeft: 6
        }
      }, "pagamento de fatura"), (it.natureza === "transferencia_saida" || it.natureza === "transferencia_entrada") && /*#__PURE__*/React.createElement("span", {
        className: "tag ok",
        style: {
          marginLeft: 6
        }
      }, "entre bancos"), it.natureza === "estorno" && /*#__PURE__*/React.createElement("span", {
        className: "tag ok",
        style: {
          marginLeft: 6
        }
      }, "estorno")), aberto ? /*#__PURE__*/React.createElement("div", {
        style: {
          flex: "0 0 165px",
          minWidth: 150
        }
      }, /*#__PURE__*/React.createElement(Money, {
        cents: it.cents,
        onChange: v => updateItem(it.id, {
          cents: v
        }),
        small: true
      })) : /*#__PURE__*/React.createElement("span", {
        className: "num",
        style: {
          flex: "0 0 auto",
          minWidth: 0,
          fontSize: 14,
          fontWeight: 500,
          whiteSpace: "nowrap",
          color: VALOR_COR[it.type]
        }
      }, brl(it.cents))), !aberto && /*#__PURE__*/React.createElement("button", {
        type: "button",
        className: "itemsummary",
        onClick: () => toggleExpand(it.id)
      }, /*#__PURE__*/React.createElement("span", null, TYPES[it.type].label, " · ", it.type === "transferencia" ? `${nomeConta(it.acctId)} → ${nomeConta(it.toAcctId)}` : `${it.category} · ${nomeConta(it.acctId)}`), /*#__PURE__*/React.createElement("b", null, "ajustar")), aberto && /*#__PURE__*/React.createElement("div", {
        className: "row2",
        style: {
          marginBottom: 0
        }
      }, /*#__PURE__*/React.createElement("select", {
        className: "fld",
        value: it.type,
        onChange: e => {
          const type = e.target.value;
          updateItem(it.id, {
            type,
            category: type === "transferencia" ? "" : CATS[type][0][0],
            toAcctId: type === "transferencia" ? it.toAcctId : ""
          });
        }
      }, Object.entries(TYPES).map(([k, v]) => /*#__PURE__*/React.createElement("option", {
        key: k,
        value: k
      }, v.label))), it.type === "transferencia" ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("select", {
        className: "fld",
        value: it.acctId,
        onChange: e => updateItem(it.id, {
          acctId: e.target.value
        })
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "Sai de…"), accounts.map(a => /*#__PURE__*/React.createElement("option", {
        key: a.id,
        value: a.id
      }, "Sai de ", a.name))), /*#__PURE__*/React.createElement("select", {
        className: "fld",
        value: it.toAcctId || "",
        onChange: e => updateItem(it.id, {
          toAcctId: e.target.value
        })
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "Entra em…"), accounts.map(a => /*#__PURE__*/React.createElement("option", {
        key: a.id,
        value: a.id
      }, "Entra em ", a.name)))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("select", {
        className: "fld",
        value: it.category,
        onChange: e => updateItem(it.id, {
          category: e.target.value
        })
      }, CATS[it.type].map(([name]) => /*#__PURE__*/React.createElement("option", {
        key: name,
        value: name
      }, name))), /*#__PURE__*/React.createElement("select", {
        className: "fld",
        value: it.acctId,
        onChange: e => updateItem(it.id, {
          acctId: e.target.value
        })
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "Conta…"), accounts.map(a => /*#__PURE__*/React.createElement("option", {
        key: a.id,
        value: a.id
      }, a.name))))), aberto && !isDesktop && !falta && /*#__PURE__*/React.createElement("button", {
        type: "button",
        className: "itemsummary",
        onClick: () => toggleExpand(it.id)
      }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("b", null, "recolher")), falta && it.selected && /*#__PURE__*/React.createElement("div", {
        className: "hint",
        style: {
          color: "var(--warn)",
          marginTop: 4
        }
      }, "Falta escolher ", it.type === "transferencia" ? "as duas contas da transferência" : "a conta", ".")), /*#__PURE__*/React.createElement("button", {
        className: "sbtn iconsbtn",
        "aria-label": "Descartar",
        onClick: () => removeItem(it.id)
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "excluir",
        size: 13
      })));
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 10,
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "sbtn primary",
      disabled: selDoc.filter(itemOk).length === 0,
      onClick: () => aprovar(selDoc.filter(itemOk))
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 14
    }), " Importar deste documento (", selDoc.filter(itemOk).length, ")"))));
  }), /*#__PURE__*/React.createElement("button", {
    className: "submit",
    onClick: () => aprovar(prontos),
    disabled: prontos.length === 0
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 16
  }), " Importar ", prontos.length, " lançamento", prontos.length === 1 ? "" : "s", " de ", docsComItens.length, " documento", docsComItens.length === 1 ? "" : "s")));
}
Extrato = React.memo(Extrato);

/* ================================================================================
   MANUAL DE USO (Ajuda) — Fase 7. Tudo aqui roda sobre DEMO_DATA, um conjunto
   fictício isolado do estado real: nenhum exemplo desta aba lê, grava ou altera os
   dados de verdade. Os poucos formulários "ao vivo" usam estado local só deles,
   nunca update() nem chamadas de IA reais — e dizem isso explicitamente.
   ================================================================================ */
const DEMO_DATA = (() => {
  const acc1 = {
    id: "demo-a1",
    name: "Conta Corrente",
    kind: "conta",
    color: "#3B63C4",
    openingBalance: 150000,
    openingDate: "2026-01-05"
  };
  const acc2 = {
    id: "demo-c1",
    name: "Cartão Roxo",
    kind: "cartao",
    color: "#A57BE0",
    closingDay: 20,
    dueDay: 28,
    limit: 300000,
    openingBalance: 0,
    openingDate: ""
  };
  const accounts = [acc1, acc2];
  const today = new Date();
  const iso = dt => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const d = daysAgo => {
    const x = new Date(today);
    x.setDate(x.getDate() - daysAgo);
    return iso(x);
  };
  const transactions = [{
    id: "demo-t1",
    type: "ganho",
    cents: 450000,
    category: "Salário",
    description: "Salário",
    date: d(20),
    acctId: acc1.id,
    status: "realizado"
  }, {
    id: "demo-t2",
    type: "gasto",
    cents: 8900,
    category: "Alimentação",
    description: "Mercado #casa",
    date: d(18),
    acctId: acc1.id,
    status: "realizado"
  }, {
    id: "demo-t3",
    type: "gasto",
    cents: 3200,
    category: "Transporte",
    description: "Uber #trabalho",
    date: d(15),
    acctId: acc2.id,
    status: "realizado"
  }, {
    id: "demo-t4",
    type: "gasto",
    cents: 5500,
    category: "Lazer",
    description: "Cinema",
    date: d(10),
    acctId: acc2.id,
    status: "realizado"
  }, {
    id: "demo-t5",
    type: "investimento",
    cents: 60000,
    category: "Renda Fixa",
    description: "Aporte mensal",
    date: d(9),
    acctId: acc1.id,
    status: "realizado"
  }, {
    id: "demo-t6",
    type: "transferencia",
    cents: 35000,
    category: "",
    description: "Pagamento da fatura",
    date: d(5),
    acctId: acc1.id,
    toAcctId: acc2.id,
    status: "realizado"
  }, {
    id: "demo-t7",
    type: "gasto",
    cents: 12000,
    category: "Contas",
    description: "Internet",
    date: d(3),
    acctId: acc1.id,
    status: "realizado"
  }, {
    id: "demo-t8",
    type: "ganho",
    cents: 15000,
    category: "Freelance",
    description: "Bico de fim de semana",
    date: iso(new Date(today.getTime() + 3 * 86400000)),
    acctId: acc1.id,
    status: "previsto"
  }];
  const budgets = {
    "Alimentação": 100000,
    "Lazer": 40000
  };
  const goals = [{
    id: "demo-g1",
    name: "Viagem",
    target: 500000,
    saved: 120000,
    deadline: iso(new Date(today.getFullYear(), today.getMonth() + 6, 1)),
    linkedCategory: null
  }];
  const holdings = [{
    id: "demo-h1",
    name: "Tesouro Selic 2029",
    cls: "Renda Fixa",
    invested: 200000,
    current: 214000
  }];
  return {
    accounts,
    transactions,
    budgets,
    goals,
    holdings
  };
})();
const DEMO_ACCOUNTS = DEMO_DATA.accounts.map(a => {
  let balance = a.openingBalance || 0;
  DEMO_DATA.transactions.filter(isRealized).forEach(t => {
    if (t.type === "transferencia") {
      if (t.acctId === a.id) balance -= t.cents;
      if (t.toAcctId === a.id) balance += t.cents;
    } else if (t.acctId === a.id) {
      balance += t.cents * TYPES[t.type].sign;
    }
  });
  return {
    ...a,
    balance
  };
});
const DEMO_ACCT_NAME = id => DEMO_ACCOUNTS.find(a => a.id === id);
const DEMO_BY_CAT = (() => {
  const m = {};
  DEMO_DATA.transactions.filter(t => isRealized(t) && t.type === "gasto").forEach(t => {
    m[t.category] = (m[t.category] || 0) + t.cents;
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
    name,
    value,
    color: CAT_COLOR[name] || "var(--text-mut)"
  }));
})();
const DEMO_BUDGET_ROWS = Object.entries(DEMO_DATA.budgets).map(([cat, limit]) => {
  const spent = DEMO_DATA.transactions.filter(t => isRealized(t) && t.type === "gasto" && t.category === cat).reduce((s, t) => s + t.cents, 0);
  const pct = limit > 0 ? spent / limit : 0;
  return {
    cat,
    limit,
    spent,
    pct,
    status: pct >= 1 ? "over" : pct >= 0.8 ? "warn" : "ok"
  };
});
const DEMO_PATRIMONIO = DEMO_ACCOUNTS.filter(a => a.kind === "conta").reduce((s, a) => s + a.balance, 0) + DEMO_DATA.holdings.reduce((s, h) => s + h.current, 0);
const DEMO_BY_CLASS = (() => {
  const m = {};
  DEMO_DATA.holdings.forEach(h => {
    m[h.cls] = (m[h.cls] || 0) + h.current;
  });
  return Object.entries(m).map(([name, value]) => ({
    name,
    value,
    color: CLASS_COLOR[name] || "var(--text-mut)"
  }));
})();

/* ícone discreto de ajuda contextual, usado no cabeçalho dos cartões principais — abre o manual
   direto na seção correspondente, via o mesmo pub-sub de openHelp() */
function HelpIcon({
  section
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "helpicon",
    "aria-label": "Ajuda sobre esta seção",
    onClick: () => openHelp(section)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "ajuda",
    size: 13
  }));
}
function HelpExample({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "helpexample"
  }, /*#__PURE__*/React.createElement("div", {
    className: "helpexamplelabel"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "olho",
    size: 12
  }), " Exemplo com dados fictícios", label ? ` — ${label}` : "", " (não altera os seus dados)"), children);
}
/* diagramas SVG: só usados onde um componente ao vivo não faz sentido (dependem de gesto de toque ou de
   um contexto de tela cheia no celular) — desenhados com os mesmos tokens de cor/tipografia do app */
function SwipeDiagram() {
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 320 70",
    width: "100%",
    height: "70",
    style: {
      maxWidth: 340,
      display: "block"
    },
    role: "img",
    "aria-label": "Diagrama: arraste um lançamento para a esquerda para revelar editar e excluir"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "8",
    width: "230",
    height: "54",
    rx: "12",
    fill: "var(--surface)",
    stroke: "var(--hairline)"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "30",
    cy: "35",
    r: "12",
    fill: "var(--neg-bg)"
  }), /*#__PURE__*/React.createElement("text", {
    x: "54",
    y: "31",
    fontSize: "12",
    fill: "var(--text)",
    fontFamily: "Inter,sans-serif"
  }, "Mercado"), /*#__PURE__*/React.createElement("text", {
    x: "54",
    y: "46",
    fontSize: "10",
    fill: "var(--text-mut)",
    fontFamily: "Inter,sans-serif"
  }, "Alimentação"), /*#__PURE__*/React.createElement("rect", {
    x: "238",
    y: "8",
    width: "78",
    height: "54",
    rx: "12",
    fill: "var(--neg-bg)"
  }), /*#__PURE__*/React.createElement("text", {
    x: "277",
    y: "40",
    fontSize: "10",
    fill: "var(--neg)",
    textAnchor: "middle",
    fontFamily: "Inter,sans-serif"
  }, "Excluir"), /*#__PURE__*/React.createElement("path", {
    d: "M175 65 L145 65",
    stroke: "var(--accent)",
    strokeWidth: "2",
    markerEnd: "url(#swipearrow)"
  }), /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("marker", {
    id: "swipearrow",
    markerWidth: "8",
    markerHeight: "8",
    refX: "4",
    refY: "4",
    orient: "auto"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M0 0 L8 4 L0 8 Z",
    fill: "var(--accent)"
  }))));
}
function BottomNavDiagram() {
  const left = [["Panorama", 40], ["Balanço", 110]];
  const right = [["Orçamento", 250], ["Mais", 310]];
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 350 76",
    width: "100%",
    height: "76",
    style: {
      maxWidth: 360,
      display: "block"
    },
    role: "img",
    "aria-label": "Diagrama: barra inferior do celular com o botão de adicionar lançamento no centro"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "0",
    y: "6",
    width: "350",
    height: "56",
    rx: "14",
    fill: "var(--surface)",
    stroke: "var(--hairline)"
  }), left.map(([label, x]) => /*#__PURE__*/React.createElement("g", {
    key: label
  }, /*#__PURE__*/React.createElement("circle", {
    cx: x,
    cy: "34",
    r: "10",
    fill: "none",
    stroke: "var(--text-mut)",
    strokeWidth: "1.5"
  }), /*#__PURE__*/React.createElement("text", {
    x: x,
    y: "58",
    fontSize: "8",
    fill: "var(--text-mut)",
    textAnchor: "middle",
    fontFamily: "Inter,sans-serif"
  }, label))), /*#__PURE__*/React.createElement("circle", {
    cx: "175",
    cy: "34",
    r: "22",
    fill: "var(--accent)"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "175",
    y1: "25",
    x2: "175",
    y2: "43",
    stroke: "#fff",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "166",
    y1: "34",
    x2: "184",
    y2: "34",
    stroke: "#fff",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }), right.map(([label, x]) => /*#__PURE__*/React.createElement("g", {
    key: label
  }, /*#__PURE__*/React.createElement("circle", {
    cx: x,
    cy: "34",
    r: "10",
    fill: "none",
    stroke: "var(--text-mut)",
    strokeWidth: "1.5"
  }), /*#__PURE__*/React.createElement("text", {
    x: x,
    y: "58",
    fontSize: "8",
    fill: "var(--text-mut)",
    textAnchor: "middle",
    fontFamily: "Inter,sans-serif"
  }, label))), /*#__PURE__*/React.createElement("text", {
    x: "175",
    y: "72",
    fontSize: "9",
    fill: "var(--text-mut)",
    textAnchor: "middle",
    fontFamily: "Inter,sans-serif"
  }, "o botão central abre \"novo lançamento\" em qualquer aba"));
}
const HELP_SECTIONS = [{
  id: "primeiros-passos",
  n: 1,
  title: "Primeiros passos",
  kw: "criar conta entrar login instalar tela inicial modo local esqueci senha primeira vez recuperar"
}, {
  id: "registrar-lancamentos",
  n: 2,
  title: "Registrar lançamentos",
  kw: "lançamento gasto ganho investimento transferência valor categoria tags repetir parcelar botão adicionar fab central"
}, {
  id: "contas-cartoes",
  n: 3,
  title: "Contas e cartões",
  kw: "conta cartão saldo inicial fechamento vencimento limite fatura mês seguinte competência caixa"
}, {
  id: "transferencias",
  n: 4,
  title: "Transferências",
  kw: "transferência mover dinheiro pagar fatura cartão"
}, {
  id: "orcamento-ajuda",
  n: 5,
  title: "Orçamento",
  kw: "orçamento limite categoria mês histórico barra aviso estourou exceção"
}, {
  id: "metas-ajuda",
  n: 6,
  title: "Metas",
  kw: "meta guardar dinheiro prazo objetivo poupança ligada categoria real"
}, {
  id: "investimentos-ajuda",
  n: 7,
  title: "Investimentos",
  kw: "investimento ativo aporte provento carteira selic cdi ipca independência financeira"
}, {
  id: "extrato-ajuda",
  n: 8,
  title: "Importar do banco",
  kw: "extrato inteligente extrato pdf recibo foto importar colar texto duplicata auditoria fatura vários múltiplos bancos open finance lote arrastar progresso ia modelo transferência entre bancos pagamento de fatura"
}, {
  id: "assistente-ajuda",
  n: 9,
  title: "Assistente",
  kw: "assistente perguntar pergunta ia inteligência artificial"
}, {
  id: "busca-filtros",
  n: 10,
  title: "Busca e filtros",
  kw: "busca buscar filtro filtros chip categoria conta data valor status previsto realizado tag"
}, {
  id: "panorama-ajuda",
  n: 11,
  title: "Panorama",
  kw: "panorama patrimônio comprometimento parcelamento indicador tag gasto por tag banco central"
}, {
  id: "backup-seguranca",
  n: 12,
  title: "Backup e segurança",
  kw: "backup exportar importar json csv mesclar substituir segurança senha dados bancários"
}, {
  id: "faq",
  n: 13,
  title: "Perguntas frequentes",
  kw: "saldo não bate fatura sumiu esqueci senha offline internet dúvida"
}];
function HelpSection({
  id,
  n,
  title,
  purpose,
  steps,
  tip,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "card helpsection",
    id: "help-" + id
  }, /*#__PURE__*/React.createElement("div", {
    className: "helpn"
  }, "Seção ", n, " de ", HELP_SECTIONS.length), /*#__PURE__*/React.createElement("h4", null, title), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: "var(--text-mut)",
      lineHeight: 1.5,
      marginBottom: steps?.length ? 10 : 0
    }
  }, purpose), steps?.length > 0 && /*#__PURE__*/React.createElement("ol", {
    className: "helpsteps"
  }, steps.map((s, i) => /*#__PURE__*/React.createElement("li", {
    key: i
  }, s))), children, tip && /*#__PURE__*/React.createElement("div", {
    className: "helptip"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 14,
    style: {
      flex: "0 0 auto"
    }
  }), /*#__PURE__*/React.createElement("span", null, tip)));
}

/* mini-formulário de exemplo: mesmos campos do formulário real de lançamento, mas com estado 100% local
   — "Salvar" não chama update() nem grava nada, é só pra mostrar como o fluxo funciona */
function DemoTxForm() {
  const [type, setType] = useState("gasto");
  const [cents, setCents] = useState(4590);
  const [desc, setDesc] = useState("Mercado #casa");
  const [saved, setSaved] = useState(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "add",
    style: {
      padding: 0,
      border: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg",
    style: {
      marginBottom: 10
    }
  }, Object.entries(TYPES).filter(([k]) => k !== "transferencia").map(([k, v]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: (type === k ? "on " : "") + v.cls,
    onClick: () => setType(k)
  }, v.label))), /*#__PURE__*/React.createElement(Money, {
    cents: cents,
    onChange: setCents,
    small: true
  }), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    style: {
      marginTop: 10
    },
    placeholder: "Descrição — use #tags",
    value: desc,
    onChange: e => setDesc(e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    style: {
      marginTop: 10
    },
    onClick: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    }
  }, saved ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14
  }), " Salvo (exemplo)") : "Salvar lançamento (exemplo)"));
}
let tourListener = null;
function replayTour() {
  tourListener && tourListener();
}
const TOUR_STEPS = [{
  title: "Bem-vindo ao Razão",
  text: "Um jeito rápido de registrar e entender seu dinheiro, sem planilha. Vamos ver o essencial em poucos passos."
}, {
  title: "O caminho mais rápido: importar do banco",
  text: "Baixe os PDFs do mês no site do seu banco e do seu cartão e jogue todos de uma vez em \"Importar do banco\". A IA descobre de qual banco é cada arquivo, separa gasto, entrada, pagamento de fatura e transferência entre bancos — você só confere e importa."
}, {
  title: "Ou registre na mão, quando preferir",
  text: "Gastos, ganhos, investimentos e transferências — use o botão de adicionar (o + central no celular, ou o formulário no topo do Balanço no computador)."
}, {
  title: "Acompanhe pelo Panorama e Balanço",
  text: "O Panorama mostra o histórico completo desde o início; o Balanço mostra mês a mês, com gráficos e orçamento."
}, {
  title: "Nomeie suas contas com o banco de verdade",
  text: "Em Contas, troque \"Conta principal\" pelo nome real (Nubank, Itaú, Inter). É por esse nome que a importação reconhece sozinha de quem é cada PDF. Aproveite e configure fechamento e vencimento dos cartões: assim um gasto no cartão conta na fatura do mês certo, não no mês da compra."
}, {
  title: "Precisa de ajuda?",
  text: "A aba Ajuda tem um manual completo com exemplos ao vivo, e o ícone \"?\" nos cartões principais leva direto pra seção certa."
}];
function WelcomeTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    tourListener = () => {
      setStep(0);
      setOpen(true);
    };
    try {
      if (!localStorage.getItem("razao_tour_seen")) {
        setStep(0);
        setOpen(true);
      }
    } catch (_) {}
    return () => {
      tourListener = null;
    };
  }, []);
  function finish() {
    setOpen(false);
    try {
      localStorage.setItem("razao_tour_seen", "1");
    } catch (_) {}
  }
  const s = TOUR_STEPS[step];
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: finish,
    title: ""
  }, /*#__PURE__*/React.createElement("div", {
    className: "tourstep"
  }, "Passo ", step + 1, " de ", TOUR_STEPS.length), /*#__PURE__*/React.createElement("h4", {
    style: {
      fontFamily: "'Sora',sans-serif",
      fontSize: 17,
      marginBottom: 8
    }
  }, s.title), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.6,
      color: "var(--text-mut)"
    }
  }, s.text), /*#__PURE__*/React.createElement("div", {
    className: "tourdots"
  }, TOUR_STEPS.map((_, i) => /*#__PURE__*/React.createElement("i", {
    key: i,
    className: i === step ? "on" : ""
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, step < TOUR_STEPS.length - 1 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: finish
  }, "Pular"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: () => setStep(x => x + 1)
  }, "Próximo")) : /*#__PURE__*/React.createElement("button", {
    className: "sbtn primary",
    style: {
      flex: 1,
      justifyContent: "center"
    },
    onClick: finish
  }, "Concluir")));
}
function Ajuda({
  helpTarget,
  onConsumeTarget
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const visible = id => {
    if (!q) return true;
    const meta = HELP_SECTIONS.find(s => s.id === id);
    return meta.title.toLowerCase().includes(q) || meta.kw.includes(q);
  };
  useEffect(() => {
    if (!helpTarget) return;
    setSearch("");
    const t = setTimeout(() => {
      document.getElementById("help-" + helpTarget)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 80);
    onConsumeTarget();
    return () => clearTimeout(t);
  }, [helpTarget]);
  const jump = id => document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "helpwrap"
  }, /*#__PURE__*/React.createElement("nav", {
    className: "helpnav",
    "aria-label": "Seções do manual"
  }, HELP_SECTIONS.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    onClick: () => jump("help-" + s.id)
  }, s.n, ". ", s.title)), /*#__PURE__*/React.createElement("button", {
    onClick: () => jump("help-glossario")
  }, "Glossário")), /*#__PURE__*/React.createElement("div", {
    className: "helpcontent"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("h3", null, "Manual de uso"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Tudo o que você precisa pra usar o Razão, com exemplos ao vivo — dados fictícios, nunca os seus."), /*#__PURE__*/React.createElement("div", {
    className: "searchfield"
  }, /*#__PURE__*/React.createElement("span", {
    className: "searchicon"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "buscar",
    size: 16
  })), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Buscar no manual…",
    value: search,
    onChange: e => setSearch(e.target.value)
  }), search && /*#__PURE__*/React.createElement("button", {
    className: "clearbtn",
    "aria-label": "Limpar busca",
    onClick: () => setSearch("")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "fechar",
    size: 14
  }))), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    style: {
      marginTop: 12
    },
    onClick: replayTour
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "brilho",
    size: 14
  }), " Rever o tour de boas-vindas")), visible("primeiros-passos") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "primeiros-passos",
    n: 1,
    title: "Primeiros passos",
    purpose: "Como começar a usar o Razão, com ou sem conta na nuvem.",
    steps: ["Ao abrir o app pela primeira vez, você pode criar uma conta com e-mail e senha, ou continuar em Modo local (os dados ficam só neste aparelho, sem sincronizar entre dispositivos).", "Se criar conta, confirme o e-mail recebido — ao confirmar, você volta automaticamente para o app já autenticado.", "Esqueceu a senha? Use \"Esqueci minha senha\" na tela de entrada para receber um link de redefinição por e-mail.", "No celular, para instalar como app: abra o menu do navegador e escolha \"Adicionar à tela inicial\" (ou \"Instalar app\", dependendo do navegador)."],
    tip: "Modo local e conta na nuvem não são um sorteio único — dá pra criar conta depois e importar um backup exportado do modo local (veja a seção 12)."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "tela de entrada (ilustrativa)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      maxWidth: 280
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "seu@email.com",
    readOnly: true
  }), /*#__PURE__*/React.createElement("input", {
    className: "fld",
    placeholder: "Senha",
    type: "password",
    readOnly: true
  }), /*#__PURE__*/React.createElement("button", {
    className: "submit",
    type: "button",
    tabIndex: -1
  }, "Entrar"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    type: "button",
    tabIndex: -1,
    style: {
      justifyContent: "center"
    }
  }, "Continuar em Modo local")))), visible("registrar-lancamentos") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "registrar-lancamentos",
    n: 2,
    title: "Registrar lançamentos",
    purpose: "Os quatro tipos de lançamento e os campos do formulário.",
    steps: ["Escolha o tipo: Gasto, Ganho, Investimento ou Transferência.", "Digite o valor sem vírgula — os dois últimos dígitos viram os centavos automaticamente (ex: 1590 vira R$ 15,90).", "Escolha a categoria, ou deixe a IA sugerir enquanto você digita a descrição (ela também aprende com o que você já categorizou antes).", "Use #tags na descrição pra marcar lançamentos que quer acompanhar juntos depois (ex: #viagem) — elas viram chips clicáveis na lista.", "Marque \"Repetir / Parcelar\" pra criar vários lançamentos de uma vez: fixo repete o mesmo valor todo mês, parcelado divide o valor total."],
    tip: "No celular, arraste um lançamento da lista para a esquerda pra revelar os botões de editar e excluir."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "formulário de lançamento"
  }, /*#__PURE__*/React.createElement(DemoTxForm, null)), /*#__PURE__*/React.createElement(HelpExample, {
    label: "arrastar para editar/excluir (mobile)"
  }, /*#__PURE__*/React.createElement(SwipeDiagram, null)), /*#__PURE__*/React.createElement(HelpExample, {
    label: "atalho do botão central (mobile)"
  }, /*#__PURE__*/React.createElement(BottomNavDiagram, null))), visible("contas-cartoes") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "contas-cartoes",
    n: 3,
    title: "Contas e cartões",
    purpose: "A diferença entre conta e cartão, saldo inicial, e por que um gasto no cartão pode aparecer no mês seguinte.",
    steps: ["Conta: dinheiro que você já tem (corrente, poupança, carteira). Cartão: dinheiro que você ainda vai pagar, numa fatura.", "Saldo inicial é o que você já tinha antes de começar a registrar aqui — sem ele, o saldo mostrado no app não bate com o do banco.", "Em cartões, configure o dia de fechamento e de vencimento: isso decide em qual fatura (mês) cada compra entra.", "Pague a fatura por uma Transferência da conta para o cartão (seção 4) — isso zera o valor devido."],
    tip: "Isso é competência × caixa: o gasto pertence ao mês da fatura (competência), não ao mês em que o cartão foi passado (caixa). Uma compra de 25/07 com fechamento dia 20 cai na fatura de agosto, não de julho."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "lista de contas"
  }, DEMO_ACCOUNTS.map(a => /*#__PURE__*/React.createElement("div", {
    className: "acct",
    key: a.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "adot",
    style: {
      background: a.color
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: a.kind === "cartao" ? "cartao" : "banco",
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "aname"
  }, a.name), /*#__PURE__*/React.createElement("div", {
    className: "akind"
  }, a.kind === "cartao" ? `Cartão · fecha dia ${a.closingDay} · vence dia ${a.dueDay}` : "Conta")), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      fontSize: 15,
      fontWeight: 500,
      color: a.balance >= 0 ? "var(--pos)" : "var(--neg)"
    }
  }, brl(a.balance)))))), visible("transferencias") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "transferencias",
    n: 4,
    title: "Transferências",
    purpose: "Mover dinheiro entre suas próprias contas, e como isso paga a fatura do cartão.",
    steps: ["Escolha o tipo Transferência, a conta de origem e a de destino.", "Uma transferência não conta como gasto nem ganho no seu total do mês — ela só move saldo entre contas.", "Pra pagar a fatura do cartão: transfira da conta corrente para o cartão, no valor da fatura."],
    tip: "Transferir para o cartão reduz o valor da fatura em aberto na hora — dá pra conferir em Contas."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "lançamento de transferência"
  }, /*#__PURE__*/React.createElement(TxRow, {
    t: DEMO_DATA.transactions.find(t => t.type === "transferencia"),
    cls: "trf",
    acc: null,
    isTrf: true,
    shifted: false,
    flowLabel: null,
    acctName: DEMO_ACCT_NAME,
    onEdit: () => {},
    onDelete: () => {},
    onMarkPaid: () => {}
  }))), visible("orcamento-ajuda") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "orcamento-ajuda",
    n: 5,
    title: "Orçamento",
    purpose: "Definir quanto você quer gastar em cada categoria e acompanhar o andamento.",
    steps: ["Escolha a categoria e o valor limite.", "Decida se o limite vale só para o mês atual (sazonal, ex: dezembro) ou para todos os meses (padrão).", "A barra mostra o quanto já foi gasto; fica amarela perto do limite e vermelha ao estourar.", "O histórico (mín/média/máx dos últimos meses) ajuda a definir um limite realista."],
    tip: "Gastos no cartão contam no orçamento pelo mês da fatura, não pelo mês da compra — a mesma régua da seção 3."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "categoria com orçamento"
  }, DEMO_BUDGET_ROWS.map(r => /*#__PURE__*/React.createElement("div", {
    className: "budrow",
    key: r.cat
  }, /*#__PURE__*/React.createElement("div", {
    className: "bh"
  }, /*#__PURE__*/React.createElement("span", {
    className: "bname"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: CAT_ICON[r.cat] || "outros",
    size: 15
  }), " ", r.cat, r.status === "over" && /*#__PURE__*/React.createElement("span", {
    className: "tag over"
  }, "estourou"), r.status === "warn" && /*#__PURE__*/React.createElement("span", {
    className: "tag warn"
  }, "atenção"), r.status === "ok" && /*#__PURE__*/React.createElement("span", {
    className: "tag ok"
  }, "no limite")), /*#__PURE__*/React.createElement("span", {
    className: "bval"
  }, brl(r.spent), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-mut)"
    }
  }, "/ ", brl(r.limit)))), /*#__PURE__*/React.createElement(ProgressBar, {
    spent: r.spent,
    limit: r.limit,
    status: r.status
  }))))), visible("metas-ajuda") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "metas-ajuda",
    n: 6,
    title: "Metas",
    purpose: "Criar objetivos de longo prazo (viagem, reserva de emergência) e acompanhar o progresso.",
    steps: ["Defina um nome, o valor total e, opcionalmente, um prazo — o app calcula quanto guardar por mês pra chegar lá.", "Use \"Guardar dinheiro\" pra somar manualmente um valor ao progresso.", "Ou ligue a meta a uma categoria real (de ganho ou investimento): todo lançamento real daquela categoria passa a somar automaticamente, sem precisar avisar a meta."],
    tip: "Uma meta ligada a categoria soma o manual + o automático — os dois juntos, nunca em dobro."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "meta com progresso"
  }, DEMO_DATA.goals.map(g => {
    const pct = Math.min(100, g.saved / g.target * 100);
    return /*#__PURE__*/React.createElement("div", {
      className: "goal",
      key: g.id
    }, /*#__PURE__*/React.createElement("div", {
      className: "gh"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "gname"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "metas",
      size: 16
    }), " ", g.name), /*#__PURE__*/React.createElement("div", {
      className: "gsub"
    }, pct.toFixed(0), "% concluído · prazo ", new Date(g.deadline + "T00:00:00").toLocaleDateString("pt-BR", {
      month: "short",
      year: "numeric"
    })))), /*#__PURE__*/React.createElement("div", {
      className: "bar"
    }, /*#__PURE__*/React.createElement("i", {
      style: {
        width: pct + "%",
        background: "var(--inv)"
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "gv"
    }, /*#__PURE__*/React.createElement("span", {
      className: "num"
    }, brl(g.saved)), /*#__PURE__*/React.createElement("span", {
      className: "num",
      style: {
        color: "var(--text-mut)"
      }
    }, brl(g.target))));
  }))), visible("investimentos-ajuda") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "investimentos-ajuda",
    n: 7,
    title: "Investimentos",
    purpose: "Cadastrar sua carteira, acompanhar aportes, proventos e indicadores de mercado.",
    steps: ["Cadastre cada ativo com o valor aplicado e o valor atual — a diferença é o rendimento.", "Lançamentos do tipo Investimento contam como aporte do mês; do tipo Ganho na categoria \"Proventos\" contam como provento.", "Selic, CDI e IPCA (Banco Central) aparecem no Panorama, atualizados uma vez por dia.", "Independência Financeira mostra quanto os proventos médios dos últimos 6 meses cobririam dos seus gastos médios."],
    tip: "100% de Independência Financeira significa: se você parasse de trabalhar, os proventos médios sozinhos cobririam seus gastos médios."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "composição da carteira"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Donut, {
    data: DEMO_BY_CLASS,
    size: 130,
    centerLabel: "carteira"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 160
    }
  }, /*#__PURE__*/React.createElement(Legend, {
    data: DEMO_BY_CLASS
  }))))), visible("extrato-ajuda") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "extrato-ajuda",
    n: 8,
    title: "Importar do banco",
    purpose: "Fechar o mês inteiro de uma vez: joga todos os PDFs dos seus bancos e cartões, a IA lê, identifica e classifica tudo.",
    steps: ["Arraste (ou escolha) TODOS os documentos do mês de uma vez: extrato do banco A, extrato do banco B, fatura do cartão C. Pode misturar PDF e foto de recibo.", "Enquanto a IA lê, o painel mostra em que documento ela está, a fase da leitura e a porcentagem de conclusão da fila inteira.", "Para cada arquivo, a IA decide se é extrato ou fatura, de qual banco é, e casa com a conta ou cartão que você já cadastrou. Se errar a conta, o seletor no cabeçalho do documento troca todos os lançamentos dele de uma vez.", "Cada linha vira um tipo: gasto, ganho, investimento ou transferência. Pagamento de fatura e transferência entre os seus bancos viram transferência (saem de uma conta e entram na outra), então não contam como gasto novo.", "Gastos que aparecem numa fatura entram no cartão daquela fatura — é isso que faz o gasto pesar no mês em que a fatura vence, e não no dia da compra.", "Revise: desmarque o que não quiser, ajuste conta, tipo e categoria. Depois importe tudo com um clique, ou documento por documento.", "Duplicatas vêm desmarcadas sozinhas — tanto as que já existem no seu histórico quanto as que aparecem em dois documentos (o caso clássico: o pagamento da fatura, que sai no extrato da conta e chega na fatura do cartão).", "Em Contas, o botão de auditoria de fatura ainda existe, para conferir um cartão específico contra o que já está registrado."],
    tip: "Se a IA estiver fora do ar ou sem cota, o PDF ainda é lido localmente pelo leitor embutido (só reconhece gasto e ganho, sem identificar banco nem transferência). Em Configurações dá para trocar o motor de IA entre Rápido e Cuidadoso — vale mudar para Cuidadoso quando alguma fatura vier com muitas linhas erradas. Arquivos acima de 3 MB podem não caber numa leitura só."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "a IA lendo a fila de documentos"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aithink"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aiorb"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("span", {
    className: "core"
  })), /*#__PURE__*/React.createElement("div", {
    className: "aibody"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aititle"
  }, /*#__PURE__*/React.createElement("span", null, "Analisando seus documentos"), /*#__PURE__*/React.createElement("span", {
    className: "aipct"
  }, "62%")), /*#__PURE__*/React.createElement("div", {
    className: "aiphase"
  }, "2 de 3 concluídos · IA lendo o documento: fatura-cartao-julho.pdf"), /*#__PURE__*/React.createElement("div", {
    className: "aibar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: "62%"
    }
  }), /*#__PURE__*/React.createElement("span", null))))), /*#__PURE__*/React.createElement(HelpExample, {
    label: "documento identificado e classificado"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dochead"
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge fatura"
  }, "Fatura"), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 13
    }
  }, "Nubank"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-mut)"
    }
  }, "01/07/2026 a 31/07/2026 · 24 lançamentos · total R$ 1.842,30")), /*#__PURE__*/React.createElement("div", {
    className: "docbody"
  }, /*#__PURE__*/React.createElement("div", {
    className: "itemrow"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: true,
    readOnly: true,
    tabIndex: -1
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 13
    }
  }, "10/07/2026 · Pagamento recebido ", /*#__PURE__*/React.createElement("span", {
    className: "tag ok",
    style: {
      marginLeft: 6
    }
  }, "pagamento de fatura"), /*#__PURE__*/React.createElement("div", {
    className: "mm",
    style: {
      marginTop: 4
    }
  }, "Vira transferência: sai da Conta Corrente e entra no Cartão Roxo — não conta como gasto."))), /*#__PURE__*/React.createElement("div", {
    className: "itemrow"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: true,
    readOnly: true,
    tabIndex: -1
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 13
    }
  }, "12/07/2026 · Mercado XYZ (3/10)", /*#__PURE__*/React.createElement("div", {
    className: "mm",
    style: {
      marginTop: 4
    }
  }, "Vira gasto em Alimentação, no Cartão Roxo.")))))), visible("assistente-ajuda") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "assistente-ajuda",
    n: 9,
    title: "Assistente",
    purpose: "Pergunte em linguagem natural sobre os seus lançamentos.",
    steps: ["Digite uma pergunta como \"quanto gastei com Uber esse ano?\" ou \"qual foi meu maior gasto em julho?\".", "A resposta é gerada só a partir dos seus dados — se não houver informação suficiente, o assistente diz isso em vez de inventar um número."],
    tip: "Perguntas específicas (com categoria, período ou valor) tendem a dar respostas melhores do que perguntas muito abertas."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "pergunta e resposta"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      marginBottom: 4
    }
  }, "Você perguntou: quanto gastei com Alimentação esse mês?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      lineHeight: 1.6,
      color: "var(--text-mut)"
    }
  }, "No exemplo, R$ 89,00 em Alimentação — um único lançamento, o mercado do dia 18."))), visible("busca-filtros") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "busca-filtros",
    n: 10,
    title: "Busca e filtros",
    purpose: "Encontrar lançamentos específicos em todo o histórico, não só no mês exibido.",
    steps: ["No Balanço, digite na busca por descrição ou por #tag — o resultado aparece enquanto você digita.", "Abra Filtros pra combinar conta, tipo, categoria, tags, intervalo de datas, status (previsto/realizado) e faixa de valor.", "Cada filtro ativo vira um chip removível; \"Limpar tudo\" reseta de uma vez.", "Clicar numa categoria no gráfico, ou numa tag na lista, também aplica o filtro correspondente."],
    tip: "O contador de resultados e a soma aparecem junto da busca, sempre que algum filtro está ativo."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "filtros ativos como chips"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chiprow",
    style: {
      marginTop: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "filterchip"
  }, /*#__PURE__*/React.createElement("span", null, "Categoria: Alimentação"), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Remover",
    type: "button",
    tabIndex: -1
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "fechar",
    size: 12
  }))), /*#__PURE__*/React.createElement("div", {
    className: "filterchip"
  }, /*#__PURE__*/React.createElement("span", null, "#viagem"), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Remover",
    type: "button",
    tabIndex: -1
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "fechar",
    size: 12
  })))))), visible("panorama-ajuda") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "panorama-ajuda",
    n: 11,
    title: "Panorama",
    purpose: "A visão consolidada de todos os meses e contas, com os indicadores extras.",
    steps: ["Saldo por conta soma tudo desde o início; Patrimônio estimado soma contas (sem cartão) + carteira de investimentos.", "Histórico de patrimônio guarda um retrato automático do total ao fim de cada mês, num gráfico.", "Contas a pagar e lembretes lista o que está previsto pra vencer nos próximos 7 dias, ou já atrasado.", "Gasto por tag soma, em todo o período, o quanto foi gasto em lançamentos marcados com cada #tag.", "Recap automático: a IA resume sozinha a semana e o mês assim que eles terminam, sem precisar pedir."],
    tip: "Independência Financeira, indicadores do Banco Central e o recap automático dependem de ter histórico e/ou internet — sem isso, esses cartões simplesmente não aparecem."
  }, /*#__PURE__*/React.createElement(HelpExample, {
    label: "patrimônio estimado"
  }, /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Em contas"), /*#__PURE__*/React.createElement("span", {
    className: "vv"
  }, brl(DEMO_ACCOUNTS.filter(a => a.kind === "conta").reduce((s, a) => s + a.balance, 0)))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Em investimentos"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      color: "var(--inv)"
    }
  }, brl(DEMO_DATA.holdings.reduce((s, h) => s + h.current, 0)))), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, /*#__PURE__*/React.createElement("b", null, "Total")), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      fontSize: 18,
      fontWeight: 600
    }
  }, brl(DEMO_PATRIMONIO))))), visible("backup-seguranca") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "backup-seguranca",
    n: 12,
    title: "Backup e segurança",
    purpose: "Como exportar, importar e onde os seus dados realmente ficam.",
    steps: ["Exporte um backup .json completo (dá pra reimportar depois) ou um .csv (pra abrir em planilha).", "Ao importar um backup, escolha Mesclar (soma ao que já existe) ou Substituir tudo (apaga o atual e usa só o importado — pede confirmação digitada).", "Com conta na nuvem, os dados ficam no banco de dados do projeto (Supabase); em Modo local, ficam só neste aparelho.", "O Razão nunca pede login do seu banco, senha de cartão ou qualquer credencial bancária — todo lançamento é digitado ou importado por você."],
    tip: "Um backup antigo, de uma versão anterior do app, sempre importa sem erro — o app atualiza o formato dele sozinho ao carregar."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    type: "button",
    tabIndex: -1
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "baixar",
    size: 14
  }), " Exportar backup (.json)"), /*#__PURE__*/React.createElement("button", {
    className: "sbtn",
    type: "button",
    tabIndex: -1
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "enviar",
    size: 14
  }), " Importar backup"))), visible("faq") && /*#__PURE__*/React.createElement(HelpSection, {
    id: "faq",
    n: 13,
    title: "Perguntas frequentes",
    purpose: ""
  }, /*#__PURE__*/React.createElement("div", {
    className: "kv",
    style: {
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Por que meu saldo não bate com o do banco?"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "55%"
    }
  }, "Provavelmente falta configurar o saldo inicial da conta (seção 3) — o valor que você já tinha antes de começar a registrar aqui.")), /*#__PURE__*/React.createElement("div", {
    className: "kv",
    style: {
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Por que o gasto do cartão sumiu deste mês?"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "55%"
    }
  }, "Ele não sumiu — foi pra fatura certa, que pode ser o mês seguinte dependendo do dia de fechamento (seção 3).")), /*#__PURE__*/React.createElement("div", {
    className: "kv",
    style: {
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Esqueci a senha, e agora?"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "55%"
    }
  }, "Use \"Esqueci minha senha\" na tela de entrada (seção 1) pra receber um link de redefinição por e-mail.")), /*#__PURE__*/React.createElement("div", {
    className: "kv",
    style: {
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Funciona sem internet?"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "55%"
    }
  }, "Sim — o app abre offline com o último estado salvo, em modo somente leitura até a conexão voltar. Em Modo local funciona 100% offline o tempo todo."))), /*#__PURE__*/React.createElement("div", {
    className: "card",
    id: "help-glossario"
  }, /*#__PURE__*/React.createElement("h3", null, "Glossário"), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Competência"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "60%"
    }
  }, "O mês \"dono\" de um gasto — no cartão, é o mês da fatura, não da compra.")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Caixa"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "60%"
    }
  }, "O mês em que o dinheiro de fato saiu ou entrou.")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Provento"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "60%"
    }
  }, "Ganho recebido por causa de um investimento (dividendo, juro, rendimento).")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Aporte"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "60%"
    }
  }, "Dinheiro que você coloca num investimento.")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Rendimento"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "60%"
    }
  }, "A diferença entre o valor atual de um ativo e o que foi aportado nele.")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Patrimônio"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "60%"
    }
  }, "Saldo das contas (sem cartão) somado ao valor atual da carteira de investimentos.")), /*#__PURE__*/React.createElement("div", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kk"
  }, "Independência financeira"), /*#__PURE__*/React.createElement("span", {
    className: "vv",
    style: {
      textAlign: "right",
      maxWidth: "60%"
    }
  }, "Quanto os proventos médios cobririam dos gastos médios, se você parasse de trabalhar.")))));
}
Ajuda = React.memo(Ajuda);
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
window.__RAZAO_APP_LOADED__ = true;
