/* services/geminiService.js — IA (Gemini via /api/gemini): leitura de extratos/faturas/recibos, sugestão de categoria, briefing do mês. */
import { parseExtratoText } from "../components/movements/ImportStatement";
import { CATS, CLASSES, catComDica } from "../domain/categories";
import { TYPES, isRealized } from "../domain/types";
import { cardInvoiceNet, pctDiff, toReal, txEffectiveMonth } from "../utils/calculations";
import { todayISO } from "../utils/dates";
import { uid } from "../utils/ids";
import { fpNorm } from "../utils/validators";

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
const fileToBase64 = (file)=> new Promise((resolve,reject)=>{
  const r = new FileReader();
  r.onload = ()=> resolve(String(r.result).split(",")[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

/* chama o proxy /api/gemini; devolve o texto cru da resposta (JSON.parse se usar schema) */
async function callGemini({ prompt, inlineData, schema, model }){
  let res;
  try{
    res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, inlineData, schema, model }),
    });
  }catch(networkErr){
    throw new Error("Não foi possível falar com a IA (sem conexão com o servidor).");
  }
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || `Erro na IA (${res.status}).`);
  if(!data.text) throw new Error("A IA não retornou dados.");
  return data.text;
}

/* modelos disponíveis no proxy /api/gemini. "rapido" é o padrão (cota grátis generosa);
   "cuidadoso" usa o modelo maior, que erra menos em fatura/extrato com layout esquisito,
   em troca de uma cota grátis bem menor e de alguns segundos a mais por documento. */
const AI_MODELS = {
  rapido:    { id:"gemini-2.5-flash", label:"Rápido",    hint:"Gemini 2.5 Flash — cota grátis alta, alguns segundos por documento." },
  cuidadoso: { id:"gemini-2.5-pro",   label:"Cuidadoso", hint:"Gemini 2.5 Pro — lê com mais atenção faturas confusas; cota grátis menor e mais lento." },
};
const aiModelId = (key)=>(AI_MODELS[key]||AI_MODELS.rapido).id;

/* naturezas que a IA pode atribuir a uma linha do documento. Ficam separadas do "type" do app porque
   pagamento de fatura e transferência entre bancos viram o MESMO type ("transferencia") no final, só que
   com contas de origem/destino diferentes — a distinção importa para montar o par certo. */
const AI_NATUREZAS = ["gasto","ganho","investimento","pagamento_fatura","transferencia_saida","transferencia_entrada","estorno","ignorar"];
const AI_DOC_TIPOS = ["extrato","fatura","nota_corretagem","recibo","outro"];

function docFingerprints(identificacao){
  const keys=[];
  const conta=fpNorm(identificacao?.conta);
  if(conta.length>=5) keys.push("conta:"+conta);
  (identificacao?.finaisCartao||[]).forEach(c=>{
    const n=fpNorm(c);
    if(n.length>=4) keys.push("cartao:"+n.slice(-4));
  });
  return [...new Set(keys)];
}
/* conta cadastrada cuja impressão digital bate com a do documento (casamento determinístico, sem IA) */
function accountByFingerprint(keys, accounts){
  if(!keys.length) return null;
  return accounts.find(a=>(a.matchKeys||[]).some(k=>keys.includes(k))) || null;
}

/* descreve as contas cadastradas para a IA: é o que permite casar o documento com o banco certo
   ("fatura do Nubank" → o cartão Nubank) e apontar a contraparte de transferências e pagamentos. */
function accountsForPrompt(accounts){
  return accounts.map(a=>{
    const o = { id:a.id, nome:a.name, tipo: a.kind==="cartao" ? "cartão de crédito" : "conta bancária" };
    if(a.kind==="cartao" && a.closingDay) o.diaFechamento = a.closingDay;
    if(a.kind==="cartao" && a.dueDay) o.diaVencimento = a.dueDay;
    // números já aprendidos de importações anteriores — a pista mais confiável que a IA pode ter
    const nums=(a.matchKeys||[]).map(k=>k.startsWith("cartao:")?("cartão final "+k.slice(7)):("conta nº "+k.slice(6)));
    if(nums.length) o.numerosConhecidos = nums;
    return o;
  });
}

/* Lê um documento inteiro (extrato, fatura de cartão, nota de corretagem, recibo — em PDF, foto ou print
   de tela) e devolve {documento, lancamentos, ativos} já classificados. É o coração do "open finance
   manual": a IA primeiro decide QUE documento é aquele e de QUAL conta cadastrada ele é, depois
   classifica linha por linha. */
async function analyzeDocumentWithAI({ base64, mimeType, fileName, accounts, model }){
  // cada categoria vem com o que costuma entrar nela; a IA deve devolver só o nome, antes dos parênteses
  const categoryList = Object.entries(CATS).map(([t,cats])=>`- ${t}: ${cats.map(c=>catComDica(c[0])).join("; ")}`).join("\n")
    + "\n(Use exatamente o nome da categoria, sem o texto entre parênteses.)";
  const ehImagem = /^image\//.test(mimeType||"");
  const prompt = `Você é um analista financeiro brasileiro, meticuloso, que lê documentos bancários e os transforma em lançamentos estruturados. Leia o documento INTEIRO com atenção — todas as páginas — antes de responder. Nome do arquivo: "${fileName||"documento"}". Data de hoje: ${todayISO()}.
${ehImagem?`
ESTE ARQUIVO É UMA IMAGEM (foto ou print de tela). Pode ser um print do extrato/fatura dentro do app do banco, uma foto de uma nota de corretagem impressa, ou um cupom fiscal. NÃO assuma que é um recibo de compra única: trate pelo conteúdo, exatamente como faria com um PDF, e extraia TODAS as linhas de lançamento que estiverem visíveis na imagem.
`:""}
CONTAS JÁ CADASTRADAS PELO USUÁRIO (use exatamente estes ids):
${JSON.stringify(accountsForPrompt(accounts), null, 1)}

PASSO 1 — Identifique o documento (campo "documento"):
- tipo:
  · "extrato" = movimentação de uma CONTA bancária (saldo, PIX, TED, débitos, créditos, salário, rendimentos).
  · "fatura" = fatura de CARTÃO DE CRÉDITO (compras do período, parcelas, "total a pagar", vencimento, limite, pagamento mínimo).
  · "nota_corretagem" = nota de corretagem / nota de negociação da bolsa (tem "NOTA DE CORRETAGEM", "Data pregão", "Negócios realizados", "Resumo financeiro", "Líquido para", corretora tipo Inter DTVM, XP, Rico, Clear, NuInvest, BTG).
  · "recibo" = cupom fiscal, nota fiscal ou comprovante de UMA compra única.
  · "outro" = qualquer outra coisa.
- banco: nome da instituição (ex: Nubank, Itaú, Bradesco, Inter, C6 Bank, BTG, Caixa, Banco do Brasil, Santander, Mercado Pago, PicPay, XP).
- identificacao: os números que identificam de onde o documento veio. É o campo MAIS IMPORTANTE para acertar a conta — preencha com cuidado:
  · agencia: número da agência, como aparece ("0001", "1", "00019"). Se não houver, "".
  · conta: número da conta com dígito, como aparece ("28942447-5", "13995672424", "5790299-2"). Se não houver, "".
  · finaisCartao: lista com os ÚLTIMOS 4 DÍGITOS de cada cartão citado no documento (uma fatura costuma listar vários: titular e adicionais). Ex: ["5909","1065"]. Se não houver, [].
  · cpfTitular: o CPF do titular do documento, como aparece — inclusive mascarado ("•••.311.687-••", "174.311.687-05"). Se não houver, "".
  · nomeTitular: nome completo do titular, como aparece no cabeçalho. Se não houver, "".
- contaId: o id da conta cadastrada que ESTE documento representa. Regras rígidas:
  · documento "fatura" só pode casar com uma conta de tipo "cartão de crédito";
  · documento "extrato" e "nota_corretagem" só podem casar com uma "conta bancária";
  · se alguma conta cadastrada tiver "numerosConhecidos" que batem com a identificacao acima, use ESSA — é a pista mais forte que existe;
  · senão case pelo nome do banco/apelido; se nenhuma servir, devolva "" (string vazia) — não invente id.
- periodoInicio / periodoFim: primeiro e último dia cobertos pelo documento, em AAAA-MM-DD.
- vencimento: para fatura, a data de vencimento; para nota de corretagem, a data de liquidação ("Líquido para"). Senão "".
- totalDocumento: para fatura, o "total a pagar"; para nota de corretagem, o valor "Líquido para"; para extrato, 0.
- confianca: 0 a 1, o quanto você tem certeza dessa identificação.
- observacao: uma frase curta em português explicando como você identificou o documento e a conta.

PASSO 2 — Extraia TODOS os lançamentos individuais, na ordem em que aparecem, sem pular nenhum e sem inventar nenhum. Para cada um:
- data: AAAA-MM-DD. Se a linha só tiver dia/mês, complete com o ano do período do documento. ATENÇÃO à virada de ano: numa fatura que cobre "26 DEZ a 27 JAN", as linhas de dezembro são do ano anterior às de janeiro.
- descricao: curta e limpa, sem códigos internos do banco nem número de operação, mas preservando o nome do estabelecimento ou da pessoa.
- valor: número POSITIVO em reais (ex: 150.5). O sinal nunca vai aqui — quem diz se entra ou sai é a "natureza".
- natureza, escolhida com muito critério:
  · "gasto" — despesa de verdade: compra, débito, tarifa, juros, IOF, anuidade, boleto pago, saque, emolumentos e taxas de corretagem. Em uma FATURA, toda compra do período é "gasto".
  · "ganho" — entrada de verdade: salário, PIX/TED recebido de TERCEIROS, rendimento/remuneração do saldo, cashback creditado, restituição, dividendos.
  · "investimento" — aplicação/aporte: CDB, tesouro, fundo, previdência, e cada COMPRA de ativo numa nota de corretagem. Resgate/venda NÃO é investimento (venda de ativo é "ganho").
  · "pagamento_fatura" — pagamento da fatura de um cartão de crédito. Num EXTRATO aparece como "PAGAMENTO CARTAO", "PAGTO FATURA", "DEB AUT CARTAO", "Pagamento de fatura", "Pagamento Cartão de crédito", ou como um Pix/QR pago a uma instituição que emite cartão ("NU PAGAMENTOS", "MERCADOPAGO", "BANCO INTER") quando o valor bate com uma fatura. Numa FATURA aparece como "PAGAMENTO RECEBIDO", "Pagamento recebido", "Pagamento da fatura de <mês>". ISSO NÃO É GASTO: é dinheiro saindo da conta e quitando o cartão.
  · "transferencia_saida" — dinheiro saindo desta conta para OUTRA CONTA DO PRÓPRIO USUÁRIO.
  · "transferencia_entrada" — o mesmo, mas entrando nesta conta.
  · "estorno" — estorno, devolução, cancelamento de compra, crédito de ajuste.
  · "ignorar" — tudo que NÃO é um lançamento individual: saldo inicial/anterior/do dia/final, saldo disponível, limite, "total de entradas", "total de saídas", "total a pagar", "total desta fatura", subtotais, "Resumo dos negócios", "Resumo financeiro", "Líquido para", cabeçalho, rodapé, número de página, avisos, propaganda, opções de parcelamento da fatura, simulações de juros.

COMO RECONHECER TRANSFERÊNCIA ENTRE CONTAS PRÓPRIAS (regra decisiva):
O documento diz no cabeçalho quem é o titular (nomeTitular/cpfTitular). Uma linha de Pix/TED é transferência entre contas do PRÓPRIO usuário quando o nome OU o CPF da contraparte é o MESMO do titular do documento — mesmo que o banco de destino seja outro. Compare ignorando maiúsculas/acentos, e aceite CPF mascarado (se "•••.311.687-••" bate com o titular, é a mesma pessoa). Exemplo: extrato de titular "Luís Gustavo Curty de Souza Azevedo" com a linha "Transferência enviada pelo Pix — Luis Gustavo Curty de Souza Azevedo — BANCO INTER" é "transferencia_saida", NÃO é gasto. Já Pix para qualquer outro nome/CPF é "gasto" (ou "ganho", se estiver entrando).

- categoria: escolha EXATAMENTE uma das opções abaixo, compatível com a natureza (para "gasto" use a lista de gasto; "ganho" e "estorno" usam a lista de ganho; "investimento" usa a lista de investimento; para pagamento_fatura e transferências use "").
${categoryList}
  Dica para nota de corretagem: FII/fundo imobiliário → "Fundos"; ação/unit/BDR → "Ações"; tesouro direto → "Tesouro"; CDB/LCI/LCA/debênture → "Renda Fixa"; cripto → "Cripto".
- contraparteId: quando a natureza for "pagamento_fatura" ou uma transferência, o id da OUTRA conta cadastrada envolvida (ex: num extrato, o pagamento da fatura do cartão Nubank aponta para o id do cartão Nubank). Se não der para identificar, "".
- parcelaAtual / parcelaTotal: se a linha indicar parcelamento ("Parcela 3/6", "Parcela 1 de 4", "03/10"), preencha os dois números; senão 0.
- confianca: 0 a 1.

PASSO 3 — Só para "nota_corretagem", preencha também "ativos" (senão devolva lista vazia), um item por linha de "Negócios realizados":
- ticker: o código do papel quando der para identificar (ex: "BTLG11", "KLBN11"); senão "".
- nome: a especificação como aparece na nota (ex: "FII BTLG", "KLABIN S/A").
- classe: uma de "Renda Fixa", "Renda Variável", "Fundos", "Cripto", "Tesouro", "Previdência", "Outros". FII → "Fundos"; ação/unit → "Renda Variável".
- operacao: "compra" ou "venda" (a coluna C/V).
- quantidade, precoUnitario, valorTotal: números.

REGRAS FINAIS:
- Nunca some linhas nem crie um lançamento "total".
- Numa nota de corretagem: cada compra de ativo vira um lançamento "investimento" separado, e as taxas (liquidação, registro, emolumentos, corretagem, transferência de ativos, ISS) viram UM único lançamento "gasto" com a soma delas, descrição "Taxas e emolumentos". A data de TODOS os lançamentos da nota é a data de liquidação ("Líquido para"), porque é nela que o dinheiro sai da conta — não a data do pregão.
- Numa fatura, a soma dos "gasto" deve bater aproximadamente com o total de compras do período.
- Se o documento for um recibo, devolva um único lançamento de natureza "gasto".
- Se não conseguir ler nada, devolva as listas vazias em vez de inventar.`;

  const schema = {
    type: "OBJECT",
    properties: {
      documento: {
        type: "OBJECT",
        properties: {
          tipo: { type:"STRING", enum: AI_DOC_TIPOS },
          banco: { type:"STRING" },
          contaId: { type:"STRING" },
          identificacao: {
            type: "OBJECT",
            properties: {
              agencia: { type:"STRING" },
              conta: { type:"STRING" },
              finaisCartao: { type:"ARRAY", items:{ type:"STRING" } },
              cpfTitular: { type:"STRING" },
              nomeTitular: { type:"STRING" },
            },
          },
          periodoInicio: { type:"STRING" },
          periodoFim: { type:"STRING" },
          vencimento: { type:"STRING" },
          totalDocumento: { type:"NUMBER" },
          confianca: { type:"NUMBER" },
          observacao: { type:"STRING" },
        },
        required: ["tipo","banco","contaId","confianca"],
      },
      lancamentos: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            data: { type:"STRING" },
            descricao: { type:"STRING" },
            valor: { type:"NUMBER" },
            natureza: { type:"STRING", enum: AI_NATUREZAS },
            categoria: { type:"STRING" },
            contraparteId: { type:"STRING" },
            parcelaAtual: { type:"NUMBER" },
            parcelaTotal: { type:"NUMBER" },
            confianca: { type:"NUMBER" },
          },
          required: ["data","descricao","valor","natureza"],
        },
      },
      ativos: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            ticker: { type:"STRING" },
            nome: { type:"STRING" },
            classe: { type:"STRING" },
            operacao: { type:"STRING", enum:["compra","venda"] },
            quantidade: { type:"NUMBER" },
            precoUnitario: { type:"NUMBER" },
            valorTotal: { type:"NUMBER" },
          },
          required: ["nome","valorTotal"],
        },
      },
    },
    required: ["documento","lancamentos"],
  };

  const text = await callGemini({
    prompt,
    inlineData: { mimeType: mimeType || "application/pdf", data: base64 },
    schema,
    model,
  });
  const parsed = JSON.parse(text);
  return {
    documento: parsed.documento || {},
    lancamentos: Array.isArray(parsed.lancamentos) ? parsed.lancamentos : [],
    ativos: Array.isArray(parsed.ativos) ? parsed.ativos : [],
  };
}

/* escolhe a conta que o documento representa, em ordem de confiabilidade:
   1) impressão digital (número de conta/cartão já aprendido de uma importação anterior) — não depende da IA;
   2) o id que a IA apontou, se existir e for do tipo coerente (fatura↔cartão, extrato/nota↔conta);
   3) a primeira conta cadastrada do tipo certo, como chute;
   4) "" — a pessoa escolhe na mão. */
function resolveDocAccount(documento, accounts){
  const wanted = documento.tipo==="fatura" ? "cartao"
    : (documento.tipo==="extrato"||documento.tipo==="nota_corretagem") ? "conta" : null;
  const keys = docFingerprints(documento.identificacao);
  const byFp = accountByFingerprint(keys, accounts);
  if(byFp && (!wanted || byFp.kind===wanted)) return { id:byFp.id, auto:true, via:"numero" };
  const guessed = accounts.find(a=>a.id===documento.contaId);
  if(guessed && (!wanted || guessed.kind===wanted)) return { id:guessed.id, auto:true, via:"ia" };
  const fallback = wanted ? accounts.find(a=>a.kind===wanted) : accounts[0];
  return { id: fallback ? fallback.id : "", auto:false, via:"chute" };
}

/* converte a resposta da IA para as linhas da tela de revisão.
   Aqui é onde "pagamento de fatura" e "transferência entre bancos" viram um lançamento de transferência
   com origem e destino — o resto do app já sabe lidar com esse par (não entra em Entradas/Saídas, só move saldo). */
function mapAiDocument({ documento, lancamentos, ativos }, accounts, docId){
  const docAcct = resolveDocAccount(documento||{}, accounts);
  const isCard = accounts.find(a=>a.id===docAcct.id)?.kind==="cartao";
  const rows = [];
  (lancamentos||[]).forEach(l=>{
    const natureza = AI_NATUREZAS.includes(l.natureza) ? l.natureza : "gasto";
    if(natureza==="ignorar") return;
    const cents = Math.max(0, Math.round((Number(l.valor)||0)*100));
    if(cents<=0) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(l.data||"") ? l.data : todayISO();
    const counterpart = accounts.find(a=>a.id===l.contraparteId)?.id || "";
    let desc = String(l.descricao||"").trim();
    const pAt = Math.round(Number(l.parcelaAtual)||0), pTot = Math.round(Number(l.parcelaTotal)||0);
    if(pAt>0 && pTot>1 && !/\d\s*\/\s*\d/.test(desc)) desc += ` (${pAt}/${pTot})`;

    let type, category = "", acctId = docAcct.id, toAcctId = "";
    if(natureza==="pagamento_fatura"){
      type = "transferencia";
      // no extrato da conta, o dinheiro sai da conta e entra no cartão; na fatura, é o contrário
      if(isCard){ toAcctId = docAcct.id; acctId = counterpart || accounts.find(a=>a.kind==="conta")?.id || ""; }
      else { acctId = docAcct.id; toAcctId = counterpart || (accounts.filter(a=>a.kind==="cartao").length===1 ? accounts.find(a=>a.kind==="cartao").id : ""); }
      if(!desc) desc = "Pagamento de fatura";
    } else if(natureza==="transferencia_saida" || natureza==="transferencia_entrada"){
      type = "transferencia";
      if(natureza==="transferencia_saida"){ acctId = docAcct.id; toAcctId = counterpart; }
      else { acctId = counterpart; toAcctId = docAcct.id; }
      if(!desc) desc = "Transferência entre contas";
    } else {
      type = natureza==="estorno" ? "ganho" : natureza;
      const validCats = CATS[type].map(c=>c[0]);
      const wanted = String(l.categoria||"").trim().toLowerCase();
      const match = validCats.find(c=>c.toLowerCase()===wanted);
      category = natureza==="estorno" ? (match||"Reembolso") : (match || validCats[validCats.length-1]);
      acctId = docAcct.id;
    }
    rows.push({
      id: uid(), docId, date, desc, cents, type, category, acctId, toAcctId,
      natureza,
      confidence: typeof l.confianca==="number" ? l.confianca : null,
      selected: true,
    });
  });
  const meta = {
    tipo: AI_DOC_TIPOS.includes(documento?.tipo) ? documento.tipo : "outro",
    banco: String(documento?.banco||"").trim(),
    contaId: docAcct.id,
    contaAuto: docAcct.auto,
    contaVia: docAcct.via,
    fingerprints: docFingerprints(documento?.identificacao),
    titular: String(documento?.identificacao?.nomeTitular||"").trim(),
    periodoInicio: /^\d{4}-\d{2}-\d{2}$/.test(documento?.periodoInicio||"") ? documento.periodoInicio : "",
    periodoFim: /^\d{4}-\d{2}-\d{2}$/.test(documento?.periodoFim||"") ? documento.periodoFim : "",
    vencimento: /^\d{4}-\d{2}-\d{2}$/.test(documento?.vencimento||"") ? documento.vencimento : "",
    totalDocumento: Math.max(0, Math.round((Number(documento?.totalDocumento)||0)*100)),
    confianca: typeof documento?.confianca==="number" ? documento.confianca : null,
    observacao: String(documento?.observacao||"").trim(),
    ativos: sanitizeAtivos(ativos),
    fonte: "ia",
  };
  return { meta, rows };
}

/* valida os ativos vindos de uma nota de corretagem, para poderem virar itens da carteira */
function sanitizeAtivos(ativos){
  return (ativos||[]).map(a=>{
    const valor = Math.max(0, Math.round((Number(a.valorTotal)||0)*100));
    if(valor<=0) return null;
    const nome = String(a.nome||"").trim();
    if(!nome) return null;
    const ticker = String(a.ticker||"").trim().toUpperCase();
    return {
      id: uid(),
      ticker,
      nome: ticker && !nome.toUpperCase().includes(ticker) ? `${nome} (${ticker})` : nome,
      cls: CLASSES.includes(a.classe) ? a.classe : "Outros",
      operacao: a.operacao==="venda" ? "venda" : "compra",
      quantidade: Math.max(0, Number(a.quantidade)||0),
      cents: valor,
      selected: a.operacao!=="venda", // venda não vira aporte na carteira; entra desmarcada
    };
  }).filter(Boolean);
}

/* leitura de fallback, sem IA: usa o pdf.js local + o parser por regex. Só reconhece gasto/ganho —
   é a rede de segurança para quando o /api/gemini não está disponível (offline, cota estourada, deploy sem chave). */
function localRowsFromText(text, docId, accounts){
  const def = accounts[0]?.id || "";
  return parseExtratoText(text).map(it=>({
    ...it, docId, acctId:def, toAcctId:"", natureza: it.type, confidence:null, selected:true,
  }));
}

/* memória de categorização: mapa descrição normalizada → categoria escolhida da última vez, alimentado a
   cada lançamento salvo. Consultada antes de chamar a IA — evita gasto de rede/latência quando a pessoa já
   categorizou essa mesma descrição (ou uma bem parecida) antes. */
function lookupCategoryMemory(memory, description){
  const norm = (description||"").trim().toLowerCase();
  if(!norm || !memory) return null;
  if(memory[norm]) return memory[norm];
  // variação comum: a descrição atual tem algo a mais (data, número da loja) mas contém uma já conhecida
  const key = Object.keys(memory).filter(k=>k.length>=3).find(k=>norm.includes(k));
  return key ? memory[key] : null;
}
/* sugere a categoria (dentro do type já escolhido) a partir da descrição digitada no formulário principal */
async function suggestCategoryWithAI(description, type){
  const cats = CATS[type].map(c=>c[0]);
  const prompt = `Descrição de um lançamento financeiro: "${description}". Tipo: ${TYPES[type].label}.
Qual das categorias abaixo melhor descreve esse lançamento? Responda com o nome exato de uma delas (sem o texto entre parênteses).
Opções: ${cats.map(catComDica).join("; ")}`;
  const schema = { type:"OBJECT", properties:{ category:{ type:"STRING", enum:cats } }, required:["category"] };
  const text = await callGemini({ prompt, schema });
  const parsed = JSON.parse(text);
  return cats.includes(parsed.category) ? parsed.category : null;
}

/* detecção puramente local (sem IA) de gastos recorrentes: agrupa por descrição, identifica cadência ~mensal
   e sinaliza candidatos que sumiram há muito tempo ou tiveram o valor mais recente muito fora do padrão */
function detectRecurringCandidates(txs, today){
  const groups={};
  txs.filter(t=>t.type==="gasto").forEach(t=>{
    const key=(t.description.trim()||t.category).toLowerCase();
    (groups[key]=groups[key]||{ label:t.description.trim()||t.category, category:t.category, items:[] }).items.push(t);
  });
  const candidates=[];
  Object.values(groups).forEach(g=>{
    if(g.items.length<2) return;
    const sorted=[...g.items].sort((a,b)=>a.date<b.date?-1:1);
    let monthlyGaps=0;
    for(let i=1;i<sorted.length;i++){
      const days=(new Date(sorted[i].date+"T00:00:00")-new Date(sorted[i-1].date+"T00:00:00"))/86400000;
      if(days>=24 && days<=40) monthlyGaps++;
    }
    if(monthlyGaps<Math.max(1,sorted.length-2)) return; // não parece ter cadência mensal consistente
    const last=sorted[sorted.length-1];
    const daysSinceLast=Math.round((today-new Date(last.date+"T00:00:00"))/86400000);
    const prevAvg=sorted.slice(0,-1).reduce((s,t)=>s+t.cents,0)/Math.max(1,sorted.length-1);
    const anomalyPct=prevAvg>0?Math.round(((last.cents-prevAvg)/prevAvg)*100):0;
    if(daysSinceLast>=45 || Math.abs(anomalyPct)>=25){
      candidates.push({
        descricao:g.label, categoria:g.category, ocorrencias:sorted.length,
        ultimoValor:(last.cents/100).toFixed(2), valorMedioAnterior:(prevAvg/100).toFixed(2),
        diasDesdeUltimaVez:daysSinceLast, variacaoPercentual:anomalyPct,
      });
    }
  });
  return candidates;
}

function buildMonthlyBriefing({ txs, accounts, monthDate, monthIndex, budgetRows }){
  const mkOf=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  const mk=mkOf(monthDate);
  const prevDate=new Date(monthDate.getFullYear(),monthDate.getMonth()-1,1);
  const prevMk=mkOf(prevDate);
  const nameOf=(id)=>accounts.find(a=>a.id===id)?.name||"—";
  // mesmo critério do resto do app: gasto no cartão pesa no mês em que a fatura vence
  const ofMonth=(key)=>txs.filter(t=>isRealized(t)&&txEffectiveMonth(t,accounts)===key);
  const cur=ofMonth(mk), prv=ofMonth(prevMk);
  const sumType=(arr,type)=>arr.filter(t=>t.type===type).reduce((s,t)=>s+t.cents,0);
  const curIn=sumType(cur,"ganho"), curOut=sumType(cur,"gasto"), curInv=sumType(cur,"investimento");
  const prvIn=sumType(prv,"ganho"), prvOut=sumType(prv,"gasto"), prvInv=sumType(prv,"investimento");

  const catSum=(arr)=>{ const m={}; arr.filter(t=>t.type==="gasto").forEach(t=>{ m[t.category]=(m[t.category]||0)+t.cents; }); return m; };
  const curCat=catSum(cur), prvCat=catSum(prv);
  const categorias=Object.entries(curCat).sort((a,b)=>b[1]-a[1]).map(([nome,c])=>({
    nome, valor:toReal(c),
    pctDoTotalDeGastos: curOut>0?Math.round((c/curOut)*100):0,
    mesAnterior: toReal(prvCat[nome]||0),
    variacaoPct: pctDiff(c, prvCat[nome]||0),
  }));
  // categoria que existia no mês passado e sumiu agora também é informação útil
  const categoriasQueSumiram=Object.entries(prvCat)
    .filter(([nome])=>!curCat[nome]).sort((a,b)=>b[1]-a[1]).slice(0,4)
    .map(([nome,c])=>({ nome, valorNoMesAnterior: toReal(c) }));

  const maioresGastos=cur.filter(t=>t.type==="gasto").sort((a,b)=>b.cents-a.cents).slice(0,8).map(t=>({
    data:t.date, descricao:(t.description||"").trim()||t.category, categoria:t.category, valor:toReal(t.cents), conta:nameOf(t.acctId),
  }));

  const cartoes=accounts.filter(a=>a.kind==="cartao").map(a=>{
    const inv=cardInvoiceNet(cur,a.id);
    return {
      nome:a.name, gastosNaFatura:toReal(inv.gasto), pagamentosRecebidos:toReal(inv.paid), emAberto:toReal(inv.net),
      limite:toReal(a.limit||0), pctDoLimiteUsado: a.limit>0?Math.round((inv.net/a.limit)*100):null,
    };
  }).filter(c=>c.gastosNaFatura>0||c.emAberto>0||c.pagamentosRecebidos>0);

  const contas=accounts.filter(a=>a.kind==="conta").map(a=>({
    nome:a.name,
    entrou: toReal(cur.filter(t=>t.type==="ganho"&&t.acctId===a.id).reduce((s,t)=>s+t.cents,0)),
    saiu: toReal(cur.filter(t=>t.type==="gasto"&&t.acctId===a.id).reduce((s,t)=>s+t.cents,0)),
  })).filter(c=>c.entrou>0||c.saiu>0);

  const trf=cur.filter(t=>t.type==="transferencia");
  const transferencias={
    quantidade: trf.length,
    volume: toReal(trf.reduce((s,t)=>s+t.cents,0)),
    pagamentosDeFatura: trf.filter(t=>accounts.find(a=>a.id===t.toAcctId)?.kind==="cartao")
      .map(t=>({ data:t.date, valor:toReal(t.cents), cartao:nameOf(t.toAcctId), origem:nameOf(t.acctId) })),
  };

  const previstos=txs.filter(t=>!isRealized(t)&&txEffectiveMonth(t,accounts)===mk);
  const aindaNaoPagos=previstos.filter(t=>t.type==="gasto").map(t=>({
    data:t.date, descricao:(t.description||"").trim()||t.category, valor:toReal(t.cents),
  })).sort((a,b)=>a.data<b.data?-1:1).slice(0,8);

  const orcamentos=(budgetRows||[]).filter(r=>r.limit>0).map(r=>({
    categoria:r.cat, limite:toReal(r.limit), gasto:toReal(r.spent), pctUsado:Math.round(r.pct*100),
    situacao: r.status==="over"?"estourado":r.status==="warn"?"perto do limite":"dentro do limite",
  }));

  // média dos 3 meses anteriores, para dizer se o mês foi fora da curva ou só normal
  const ultimos=[];
  for(let i=1;i<=6;i++){
    const d=new Date(monthDate.getFullYear(),monthDate.getMonth()-i,1);
    const b=(monthIndex||{})[mkOf(d)];
    if(b) ultimos.push({ mes:mkOf(d), entradas:toReal(b.entradas), saidas:toReal(b.saidas), investido:toReal(b.investido) });
  }
  const base=ultimos.slice(0,3);
  const mediaSaidas=base.length?base.reduce((s,m)=>s+m.saidas,0)/base.length:0;
  const mediaEntradas=base.length?base.reduce((s,m)=>s+m.entradas,0)/base.length:0;

  const diasNoMes=new Date(monthDate.getFullYear(),monthDate.getMonth()+1,0).getDate();
  const hojeNoMes=mkOf(new Date())===mk;
  const diasCorridos=hojeNoMes?new Date().getDate():diasNoMes;

  const recorrentes=detectRecurringCandidates(txs,new Date()).slice(0,6);

  return {
    mes: mk,
    mesAnterior: prevMk,
    mesEmAndamento: hojeNoMes,
    diasCorridos, diasNoMes,
    totais: {
      entradas: toReal(curIn), saidas: toReal(curOut), investido: toReal(curInv),
      saldo: toReal(curIn-curOut-curInv),
      taxaDePoupancaPct: curIn>0?Math.round(((curIn-curOut-curInv)/curIn)*100):null,
      gastoMedioPorDia: diasCorridos>0?toReal(Math.round(curOut/diasCorridos)):0,
      quantidadeDeLancamentos: cur.length,
    },
    comparacaoMesAnterior: {
      entradas: toReal(prvIn), saidas: toReal(prvOut), investido: toReal(prvInv),
      variacaoEntradasPct: pctDiff(curIn,prvIn),
      variacaoSaidasPct: pctDiff(curOut,prvOut),
      variacaoInvestidoPct: pctDiff(curInv,prvInv),
    },
    mediaTresMesesAnteriores: { entradas: Number(mediaEntradas.toFixed(2)), saidas: Number(mediaSaidas.toFixed(2)) },
    historicoRecente: ultimos,
    categorias, categoriasQueSumiram, maioresGastos, cartoes, contas, transferencias,
    orcamentos, aindaNaoPagos, recorrentesSuspeitos: recorrentes,
  };
}

/* instruções de estilo compartilhadas por resumo do mês e recaps — é o que separa um parágrafo
   genérico ("seus gastos aumentaram") de uma análise que cita a categoria, o valor e a causa. */
const AI_SUMMARY_STYLE = `Escreva em português do Brasil, na segunda pessoa ("você"), tom direto de quem entende de finanças pessoais e fala como gente — sem jargão, sem motivacional, sem emoji.

REGRAS:
- Use SOMENTE os números do JSON. Nunca invente valor, categoria ou lançamento que não esteja lá.
- Sempre que citar um número, dê o contexto: quanto foi, quanto era antes, quantos por cento mudou.
- Prefira a causa concreta ("Entretenimento subiu 62% por causa dos R$ 380 do dia 12") ao efeito genérico ("os gastos aumentaram").
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

export { fileToBase64, callGemini, AI_MODELS, aiModelId, AI_NATUREZAS, AI_DOC_TIPOS, docFingerprints, accountByFingerprint, accountsForPrompt, analyzeDocumentWithAI, resolveDocAccount, mapAiDocument, sanitizeAtivos, localRowsFromText, lookupCategoryMemory, suggestCategoryWithAI, detectRecurringCandidates, buildMonthlyBriefing, AI_SUMMARY_STYLE };
