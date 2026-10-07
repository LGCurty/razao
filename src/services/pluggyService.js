/* services/pluggyService.js — Open Finance (Pluggy via /api/pluggy e /api/sync): conexão, contas automáticas, conversão de lançamentos e sincronização de uma conexão. */
import { bancoDoNome } from "../domain/banks";
import { CATS } from "../domain/categories";
import { accountByFingerprint } from "./geminiService";
import { sb } from "./supabaseService";
import { todayISO } from "../utils/dates";
import { uid } from "../utils/ids";
import { DATE_RE, fpNorm, soDigitos } from "../utils/validators";

/* =======================================================================
   OPEN FINANCE (Pluggy) — o banco manda os lançamentos direto, sem PDF

   É o mesmo destino da leitura por IA, só que sem arquivo no meio: a pessoa conecta o banco uma vez
   pela tela do Pluggy Connect (que roda no domínio do Pluggy, o app nunca vê senha nem token do banco)
   e depois é só "Atualizar". O que sai daqui são exatamente as mesmas linhas que mapAiDocument produz,
   então revisão, detecção de duplicata, ações em massa e importação são reaproveitadas inteiras.

   Segurança: CLIENT_ID e CLIENT_SECRET ficam só na função serverless (api/pluggy.js). O navegador
   recebe no máximo um Connect Token de 30 minutos, que só serve para abrir a tela de conexão.
   ======================================================================= */
// "latest" é o caminho oficial do próprio CDN do Pluggy e não deveria mudar; a versão fixa é só uma
// segunda tentativa, caso o alias alguma vez fique fora do ar sem viver instável para sempre.
const PLUGGY_CONNECT_SRCS = [
  "https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js",
  "https://cdn.pluggy.ai/pluggy-connect/v2.7.0/pluggy-connect.js",
];
let pluggyConnectPromise = null;
function carregarScript(src){
  return new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src=src;
    s.onload=()=> window.PluggyConnect ? resolve(window.PluggyConnect) : reject(new Error("vazio"));
    s.onerror=()=>reject(new Error("falhou"));
    document.head.appendChild(s);
  });
}
async function loadPluggyConnect(){
  if(window.PluggyConnect) return window.PluggyConnect;
  if(pluggyConnectPromise) return pluggyConnectPromise;
  pluggyConnectPromise = (async ()=>{
    for(let i=0;i<PLUGGY_CONNECT_SRCS.length;i++){
      try{ return await carregarScript(PLUGGY_CONNECT_SRCS[i]); }
      catch(e){ if(i===PLUGGY_CONNECT_SRCS.length-1){ pluggyConnectPromise=null; throw new Error("Não foi possível carregar a tela de conexão com o banco. Verifique sua conexão e tente de novo."); } }
    }
  })();
  return pluggyConnectPromise;
}

async function tokenDeLogin(){
  if(!sb) return "";
  try{ const { data }=await sb.auth.getSession(); return data?.session?.access_token||""; }catch(e){ return ""; }
}

/* toda conversa com o Pluggy passa pela nossa função serverless, sempre assinada com o token de login */
async function pluggyApi(action, payload){
  const token=await tokenDeLogin();
  let r;
  try{
    r=await fetch("/api/pluggy",{
      method:"POST",
      headers:{ "Content-Type":"application/json", ...(token?{Authorization:"Bearer "+token}:{}) },
      body:JSON.stringify({ action, ...(payload||{}) }),
    });
  }catch(err){ const e=new Error("Sem conexão com o servidor do app. Tente de novo em instantes."); e.offline=true; throw e; }
  const data=await r.json().catch(()=>({}));
  // guarda o status HTTP no próprio erro: quem chama decide a mensagem amigável pelo código, não
  // tentando adivinhar pelo texto — o Pluggy responde em inglês ("item not found"), então procurar
  // "404" ou "não encontrad" no texto deixava esse erro específico passar cru para a tela
  if(!r.ok){ const e=new Error(data.error || "Não foi possível falar com o Open Finance agora."); e.status=r.status; throw e; }
  return data;
}

/* sincronização de uma conexão inteira numa chamada só (api/sync.js: novas tentativas no servidor e
   status success/partial/error por conta). Devolve null se o endpoint não existir (ex.: `npm run dev`
   sem `vercel dev`, ou um deploy antigo) — aí quem chama cai no caminho de várias chamadas avulsas. */
async function pluggySyncApi(payload){
  const token=await tokenDeLogin();
  let r;
  try{
    r=await fetch("/api/sync",{
      method:"POST",
      headers:{ "Content-Type":"application/json", ...(token?{Authorization:"Bearer "+token}:{}) },
      body:JSON.stringify(payload||{}),
    });
  }catch(err){ const e=new Error("Sem conexão com o servidor do app. Tente de novo em instantes."); e.offline=true; throw e; }
  const data=await r.json().catch(()=>null);
  if(r.status===404 && !(data && data.status)) return null;
  if(!r.ok){ const e=new Error((data&&data.error) || "Não foi possível falar com o Open Finance agora."); e.status=r.status; throw e; }
  return data;
}

/* abre o Pluggy Connect: sem itemId cria uma conexão nova; com itemId reabre a existente (senha trocada,
   consentimento vencido, MFA). onSuccess recebe a conexão já no formato guardado em data.pluggy.items. */
async function abrirPluggyConnect({ itemId, onSuccess, onError }){
  const [{ accessToken },Widget]=await Promise.all([
    pluggyApi("connect_token", itemId?{itemId}:{}),
    loadPluggyConnect(),
  ]);
  const widget=new Widget({
    connectToken: accessToken,
    includeSandbox: false,
    onSuccess: (payload)=>{
      const item=payload?.item||{};
      if(item.id) onSuccess(conexaoDoItem(item));
    },
    onError: (e)=>{ if(onError) onError(e?.message||"O banco recusou a conexão. Tente de novo."); },
  });
  widget.init();
}
const conexaoDoItem=(item)=>({
  id:item.id,
  connectorName:item.connector?.name||"Banco",
  connectorImage:item.connector?.imageUrl||"",
  createdAt:new Date().toISOString(),
  lastSyncAt:"", lastStatus:item.status||"", lastError:"",
});
/* lista de conexões com esta incluída: conexão nova entra no fim; reconectada mantém o histórico
   (criação, última sincronização) e só troca o status e limpa o erro */
function comConexao(items, nova){
  const atual=(items||[]).find(i=>i.id===nova.id);
  if(!atual) return [...(items||[]), nova];
  return items.map(i=>i.id===nova.id ? {...i, connectorName:nova.connectorName||i.connectorName,
    connectorImage:nova.connectorImage||i.connectorImage, lastStatus:nova.lastStatus, lastError:""} : i);
}

/* Sem duplicatas entre o que veio do banco e o que já estava aqui: lançamento novo do Pluggy que bate com
   um lançamento lançado à mão ou lido de PDF (mesma conta, mesmo valor, mesma data, mesmo tipo, e ainda sem
   id do banco) não é criado de novo — o existente "adota" o id do banco e fica vinculado. Cada existente
   adota no máximo um. Devolve a lista final e quantos foram vinculados. */
function adotarExistentes(existentes, novos){
  const livres=new Map();
  existentes.forEach((t,i)=>{
    if(t.pluggyId || t.type==="transferencia") return;
    const k=`${t.acctId}|${t.cents}|${t.date}|${t.type}`;
    if(!livres.has(k)) livres.set(k,[]);
    livres.get(k).push(i);
  });
  const lista=[...existentes];
  const add=[];
  let vinculados=0;
  novos.forEach(n=>{
    const k=`${n.acctId}|${n.cents}|${n.date}|${n.type}`;
    const fila=n.pluggyId && n.type!=="transferencia" ? livres.get(k) : null;
    if(fila && fila.length){
      const i=fila.shift();
      lista[i]={...lista[i], pluggyId:n.pluggyId};
      vinculados++;
    } else add.push(n);
  });
  return { transactions:[...add,...lista], adicionados:add.length, vinculados };
}

const PLUGGY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLUGGY_SUBTIPO = {
  CHECKING_ACCOUNT:"Conta corrente", SAVINGS_ACCOUNT:"Poupança", CREDIT_CARD:"Cartão de crédito",
};
/* o que cada estado de uma conexão significa para quem está olhando a tela */
const PLUGGY_ITEM_STATUS = {
  UPDATED:            { ok:true,  label:"Atualizado" },
  UPDATING:           { ok:false, label:"O banco ainda está enviando os dados. Tente atualizar de novo em um minuto." },
  LOGIN_ERROR:        { ok:false, label:"O banco recusou o acesso (senha trocada ou consentimento vencido). Reconecte.", reconectar:true },
  WAITING_USER_INPUT: { ok:false, label:"O banco está pedindo uma confirmação sua. Reconecte para responder.", reconectar:true },
  OUTDATED:           { ok:false, label:"A última atualização falhou. Tente de novo ou reconecte.", reconectar:true },
  ERROR:              { ok:false, label:"O banco devolveu um erro na última atualização. Tente de novo mais tarde." },
};
const pluggyKind = (c)=> (String(c?.type||"").toUpperCase()==="CREDIT" || c?.subtype==="CREDIT_CARD") ? "cartao" : "conta";
/* impressão digital da conta do banco, no MESMO formato aprendido pela leitura de PDF (matchKeys):
   conectar o banco pelo Open Finance já ensina o app a reconhecer o extrato em PDF desse banco. */
function pluggyFingerprints(c){
  const num=fpNorm(c?.number);
  if(pluggyKind(c)==="cartao") return num.length>=4 ? ["cartao:"+num.slice(-4)] : [];
  return num.length>=5 ? ["conta:"+num] : [];
}

/* casa a conta que veio do banco com uma conta cadastrada aqui: primeiro pelo número (sem ambiguidade),
   depois pelo nome do banco, e só então chuta a primeira conta do tipo certo. */
function matchPluggyAccount(c, accounts){
  const keys=pluggyFingerprints(c);
  const kind=pluggyKind(c);
  const byFp=accountByFingerprint(keys,accounts);
  if(byFp && byFp.kind===kind) return { id:byFp.id, auto:true, via:"numero", keys };
  const banco=fpNorm(c?.connectorName||c?.marketingName||"");
  const byName = banco.length>=3
    ? accounts.find(a=>{ const n=fpNorm(a.name); return a.kind===kind && n.length>=3 && (n.includes(banco)||banco.includes(n)); })
    : null;
  if(byName) return { id:byName.id, auto:true, via:"nome", keys };
  // sem casamento nenhum: NÃO chuta uma conta qualquer do mesmo tipo (podia ser a conta errada, de
  // outro banco) — quem chama decide criar uma conta nova pra essa conexão (ver garantirContasPluggy)
  return { id:"", auto:false, via:"nova", keys };
}

/* garante que toda conta do Pluggy que não casou com nenhuma cadastrada ganhe uma conta nova aqui —
   com o nome do banco, cor da paleta e a impressão digital já preenchida (então casa sozinha nas
   próximas sincronizações, sem precisar mais deste passo). Devolve a lista de contas já com as novas
   incluídas, pronta para mapPluggyDocs, e separadamente só as que foram criadas agora (para avisar). */
const CONTA_COLORS = ["#3B63C4","#E05A2B","#12805F","#C2382F","#B87C10","#A57BE0","#46B7C7","#8C93A8"];
function nomeContaAutomatica(c, connectorName, existentes){
  const rotulo = PLUGGY_SUBTIPO[c.subtype] || (pluggyKind(c)==="cartao" ? "Cartão de crédito" : "Conta");
  // o nome de marketing da PRÓPRIA conta/cartão (ex: "Banco Santander", "SANTANDER ELITE VISA")
  // identifica o banco de verdade mesmo quando o conector da conexão é genérico — é exatamente o caso
  // de quem vincula pelo Meu Pluggy: ali várias contas de bancos diferentes vêm todas sob um único
  // conector chamado "MeuPluggy", então usar connectorName criaria toda conta com esse mesmo nome
  const marketing = String(c?.marketingName||"").trim();
  const nomeProprio = String(c?.name||"").trim();
  const base = marketing || (pluggyKind(c)==="cartao" ? `${connectorName} Cartão` : connectorName) || nomeProprio || "Conta";
  const usados = new Set(existentes.map(a=>a.name.trim().toLowerCase()));
  if(!usados.has(base.trim().toLowerCase())) return base;
  const comRotulo = `${base} (${rotulo})`;
  if(!usados.has(comRotulo.trim().toLowerCase())) return comRotulo;
  let n=2; while(usados.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}
function garantirContasPluggy(contas, accountsAtuais, connectorName){
  const novas=[];
  let atual=accountsAtuais;
  contas.forEach(c=>{
    const achou=matchPluggyAccount(c,atual);
    if(achou.id) return;
    const nova={
      id:uid(), name:nomeContaAutomatica(c,connectorName,atual), kind:pluggyKind(c), bank:bancoDoNome(connectorName)||bancoDoNome(c.marketingName)||"Outro",
      color:CONTA_COLORS[atual.length%CONTA_COLORS.length],
      openingBalance:0, openingDate:"", matchKeys:achou.keys,
    };
    novas.push(nova);
    atual=[...atual,nova];
  });
  return { accounts:atual, novas };
}

/* O Pluggy devolve a categoria em inglês e com uma árvore própria; aqui ela vira uma das categorias
   que já existem no app. O que não casar cai em "Outros" e a pessoa ajusta na revisão. */
const PLUGGY_CAT_GASTO = [
  [/tax|insurance|bank fee|fees|interest charge|late payment|educat|school|university|course|tuition/i, "Obrigações"],
  [/food|drink|restaurant|supermarket|groceri|delivery|bakery|bar\b|shop|cloth|electronic|online|store|marketplace|department|\bpet|veterin|personal care|beauty/i, "Vida Diária"],
  [/transport|uber|taxi|ride|fuel|gas station|parking|toll|public transport|vehicle/i, "Transporte"],
  [/rent|housing|mortgage|condo|home improvement|utilit|electric|water|internet|telecom|phone|mobile|bill/i, "Moradia"],
  [/health|pharmac|medic|dental|hospital|doctor|gym|fitness|wellness/i, "Saúde"],
  [/leisure|entertain|cinema|movie|game|hobby|sport|ticket|event|subscription|streaming|software|digital service|travel|airline|flight|hotel|lodging/i, "Entretenimento"],
];
const PLUGGY_CAT_GANHO = [
  [/salary|payroll|wage|paycheck/i, "Salário Mensal"],
  [/dividend|proceeds|interest|yield|investment income/i, "Proventos"],
  [/freelanc|self.?employ|cashback|rewards|sale/i, "Renda extra"],
];
function pluggyCategoria(tipo, catPluggy, desc, categoryMemory){
  const validas=CATS[tipo].map(c=>c[0]);
  // o que a pessoa já corrigiu antes vale mais que qualquer palpite
  const memoria=(categoryMemory||{})[String(desc||"").trim().toLowerCase()];
  if(memoria && validas.includes(memoria)) return memoria;
  const alvo=`${catPluggy||""}`;
  const tabela = tipo==="ganho" ? PLUGGY_CAT_GANHO : tipo==="gasto" ? PLUGGY_CAT_GASTO : [];
  const achou=tabela.find(([re])=>re.test(alvo));
  if(achou && validas.includes(achou[1])) return achou[1];
  return validas[validas.length-1]; // "Outros"
}

/* visto de dentro do cartão, qualquer dinheiro entrando com cara de pagamento é pagamento de fatura */
const RE_PAGTO_NO_CARTAO = /pagamento|pagto|pgto|payment received|credit card payment|fatura/i;
/* visto do lado da conta corrente é preciso ser mais exigente: sem citar fatura ou cartão, um
   "pagamento de boleto" qualquer viraria transferência por engano */
const RE_PAGTO_DE_FATURA = /(pagamento|pagto|pgto|debito autom|débito autom)[\s\S]{0,25}(fatura|cart[ãa]o)|fatura[\s\S]{0,15}cart[ãa]o|credit card payment/i;
const ehPagamentoDeFatura = (desc, catPluggy)=>RE_PAGTO_DE_FATURA.test(desc) || /credit card payment/i.test(String(catPluggy||""));
/* uma conta é "minha" quando o CPF/CNPJ da contraparte é o mesmo do titular — é assim que um PIX entre
   os próprios bancos deixa de virar gasto e vira transferência. */
function contrapartePropria(parte, cpfTitular){
  const doc=soDigitos(parte?.documentNumber?.value);
  return cpfTitular.length>=11 && doc.length>=11 && doc===cpfTitular;
}

/* Converte um lote de contas + lançamentos do Pluggy nas MESMAS estruturas da leitura por IA:
   um "documento" por conta do banco e uma linha por lançamento, prontos para a tela de revisão.

   Sinal do valor: o Pluggy marca cada lançamento com type DEBIT (saiu) ou CREDIT (entrou). Em conta
   corrente o valor também vem negativo na saída, mas no cartão de crédito vários conectores invertem
   esse sinal — por isso quem manda é o `type`, e o sinal só desempata quando ele não vem. */
function mapPluggyDocs({ contas, txPorConta, accounts, categoryMemory, conexao, jaImportados, criadasAgora }){
  const conhecidos = jaImportados instanceof Set ? jaImportados : new Set();
  const novasNesteLote = criadasAgora instanceof Set ? criadasAgora : new Set();
  let ignorados = 0;
  // a conta recém-criada por garantirContasPluggy já casa por número aqui dentro (a impressão digital
  // foi preenchida na hora de criar) — só que "reconhecida pelo número" soaria estranho pra uma conta
  // que não existia há 2 segundos, então essa marca vira "nova" mesmo com o casamento por fingerprint
  const resolvidas=contas.map(c=>{
    const r={ pluggy:c, ...matchPluggyAccount(c,accounts) };
    if(novasNesteLote.has(r.id)) r.via="nova";
    return r;
  });
  // números das próprias contas conectadas, para achar o outro lado de uma transferência interna
  const proprias=resolvidas.filter(r=>r.id && soDigitos(r.pluggy.number).length>=4)
    .map(r=>({ acctId:r.id, num:soDigitos(r.pluggy.number) }));
  const acharPropria=(numero)=>{
    const n=soDigitos(numero);
    if(n.length<4) return "";
    const hit=proprias.find(p=>p.num.endsWith(n)||n.endsWith(p.num));
    return hit?hit.acctId:"";
  };
  /* para onde vai um "pagamento de fatura" saindo da conta corrente: o cartão da própria conexão,
     se houver um só; senão o único cartão cadastrado; senão fica em branco para a pessoa escolher */
  const cartoesDaConexao=resolvidas.filter(x=>x.id && pluggyKind(x.pluggy)==="cartao").map(x=>x.id);
  const cartoesCadastrados=accounts.filter(a=>a.kind==="cartao");
  const cartaoDestino = cartoesDaConexao.length===1 ? cartoesDaConexao[0]
    : cartoesCadastrados.length===1 ? cartoesCadastrados[0].id : "";

  const docs=[], rows=[];
  resolvidas.forEach(r=>{
    const c=r.pluggy;
    const isCard=pluggyKind(c)==="cartao";
    const cpfTitular=soDigitos(c.taxNumber);
    const docId="of_"+c.id;
    const lista=txPorConta[c.id]||[];
    let minData="", maxData="";

    lista.forEach(t=>{
      const bruto=Number(t.amount)||0;
      const cents=Math.round(Math.abs(bruto)*100);
      if(cents<=0) return;
      // o id do lançamento no Pluggy é a defesa exata contra reimportar o mesmo mês duas vezes —
      // não depende de data, valor nem descrição baterem, então sobrevive a uma descrição que o
      // banco reescreve depois de efetivar. O casamento por data+valor+descrição continua valendo
      // como segunda camada, para o que veio de PDF e não tem id.
      const pluggyId = String(t.id||"").trim();
      if(pluggyId && conhecidos.has(pluggyId)){ ignorados++; return; }
      const tipoPluggy=String(t.type||"").toUpperCase();
      const saida = tipoPluggy==="DEBIT" ? true : tipoPluggy==="CREDIT" ? false : (isCard ? bruto>0 : bruto<0);
      const date=DATE_RE.test(String(t.date||"").slice(0,10)) ? String(t.date).slice(0,10) : todayISO();
      if(!minData||date<minData) minData=date;
      if(!maxData||date>maxData) maxData=date;

      let desc=String(t.description||t.descriptionRaw||t.merchant?.name||"").trim() || "Lançamento";
      const pAt=Math.round(Number(t.creditCardMetadata?.installmentNumber)||0);
      const pTot=Math.round(Number(t.creditCardMetadata?.totalInstallments)||0);
      if(pAt>0 && pTot>1 && !/\d\s*\/\s*\d/.test(desc)) desc+=` (${pAt}/${pTot})`;

      let type, natureza, category="", acctId=r.id, toAcctId="";
      if(isCard){
        if(saida){ type="gasto"; natureza="gasto"; category=pluggyCategoria("gasto",t.category,desc,categoryMemory); }
        else if(RE_PAGTO_NO_CARTAO.test(desc)){
          // dinheiro entrando no cartão é pagamento de fatura: sai de alguma conta, entra no cartão
          type="transferencia"; natureza="pagamento_fatura"; acctId=""; toAcctId=r.id;
          if(!desc) desc="Pagamento de fatura";
        } else { type="ganho"; natureza="estorno"; category="Reembolso"; }
      } else {
        const parte = saida ? t.paymentData?.receiver : t.paymentData?.payer;
        const propria = contrapartePropria(parte, cpfTitular);
        const outraConta = propria ? acharPropria(parte?.accountNumber) : "";
        if(propria){
          type="transferencia";
          natureza = saida ? "transferencia_saida" : "transferencia_entrada";
          acctId = saida ? r.id : outraConta;
          toAcctId = saida ? outraConta : r.id;
        } else if(saida && ehPagamentoDeFatura(desc,t.category)){
          // o mesmo pagamento aparece nos dois documentos (extrato e fatura) — a revisão marca a
          // segunda cópia como duplicata sozinha, então dá para deixar as duas visíveis
          type="transferencia"; natureza="pagamento_fatura"; acctId=r.id; toAcctId=cartaoDestino;
        } else if(saida){
          type="gasto"; natureza="gasto"; category=pluggyCategoria("gasto",t.category,desc,categoryMemory);
        } else {
          type="ganho"; natureza="ganho"; category=pluggyCategoria("ganho",t.category,desc,categoryMemory);
        }
      }

      rows.push({
        id:uid(), docId, date, desc, cents, type, category, acctId, toAcctId, natureza, pluggyId,
        // lançamento ainda não efetivado no banco pode mudar de valor ou sumir: marcar com confiança
        // baixa faz a etiqueta "conferir" aparecer na revisão
        confidence: String(t.status||"").toUpperCase()==="PENDING" ? 0.4 : null,
        pendente: String(t.status||"").toUpperCase()==="PENDING",
        selected:true,
      });
    });

    // conta cujos lançamentos já tinham sido importados não vira um documento vazio na revisão
    if(rows.every(x=>x.docId!==docId)) return;
    const rotulo=PLUGGY_SUBTIPO[c.subtype] || (isCard?"Cartão de crédito":"Conta");
    docs.push({
      id:docId,
      name:`${c.marketingName||conexao?.connectorName||"Banco"} · ${c.name||rotulo}`,
      size:0, file:null, status:"pronto", progress:1, error:"", aviso:"",
      count: rows.filter(x=>x.docId===docId).length,
      meta:{
        tipo: isCard?"fatura":"extrato",
        banco: `${c.marketingName||conexao?.connectorName||"Banco"} · ${c.name||rotulo}`,
        contaId: r.id, contaAuto: r.auto, contaVia: r.via,
        fingerprints: r.keys,
        titular:"", periodoInicio:minData, periodoFim:maxData, vencimento:"",
        totalDocumento:0, confianca:null,
        observacao: soDigitos(c.number).length>=4 ? `${isCard?"Cartão final":"Conta final"} ${soDigitos(c.number).slice(-4)}` : "",
        ativos:[], fonte:"pluggy", pluggyAccountId:c.id, pluggyItemId:conexao?.id||"",
      },
    });
  });
  return { docs, rows, ignorados };
}

/* janela de busca de uma conexão: desde a última sincronização (com folga de 5 dias, porque o banco
   às vezes efetiva um lançamento com data retroativa), no mínimo 7 dias; primeira vez, 90 dias */
function diasDesdeUltimaSync(conexao){
  return conexao?.lastSyncAt ? Math.max(7,Math.ceil((Date.now()-new Date(conexao.lastSyncAt).getTime())/86400000)+5) : 90;
}

/* núcleo da sincronização de UMA conexão do Open Finance, sem mexer no estado do app: confere o status
   da conexão, lista as contas e busca os lançamentos no Pluggy, e devolve tudo já convertido. Quem chama
   decide o destino — a tela "Importar do banco" manda para a revisão; a sincronização automática grava
   direto. Erro de conexão que pede ação da pessoa (senha trocada, consentimento vencido) volta com
   err.reconectar=true, para não ficar tentando de novo à toa. */
async function syncPluggyConnection({ conexao, accounts, categoryMemory, jaImportados, dias, onEtapa }){
  const etapa=onEtapa||(()=>{});
  const hoje=new Date();
  const ini=new Date(hoje.getTime()-(dias||diasDesdeUltimaSync(conexao))*86400000);
  const from=new Date(ini.getTime()-ini.getTimezoneOffset()*60000).toISOString().slice(0,10), to=todayISO();

  let status, aviso="", contas, txPorConta, erros=[];
  etapa(`Sincronizando ${conexao.connectorName}…`,0.1);
  const via=await pluggySyncApi({ itemId:conexao.id, from, to });
  if(via){
    status=String(via.itemStatus||"").toUpperCase();
    if(via.status==="reconectar"){ const e=new Error(via.error||"Reconecte o banco."); e.reconectar=true; e.itemStatus=status||"LOGIN_ERROR"; throw e; }
    if(via.status==="error"){ const e=new Error(via.error||"Não foi possível buscar os dados do banco."); e.itemStatus=status; throw e; }
    aviso=via.aviso||"";
    contas=via.contas||[];
    txPorConta=via.transacoes||{};
    erros=via.erros||[];
  } else {
    // caminho antigo, em várias chamadas avulsas a api/pluggy.js
    const info=await pluggyApi("item",{itemId:conexao.id});
    status=String(info.status||"").toUpperCase();
    const st=PLUGGY_ITEM_STATUS[status];
    if(st && st.reconectar){ const e=new Error(st.label); e.reconectar=true; e.itemStatus=status; throw e; }
    aviso = st && !st.ok ? st.label : "";
    etapa("Listando as contas…",0.15);
    ({ results:contas=[] }=await pluggyApi("accounts",{itemId:conexao.id}));
    if(contas.length===0){ const e=new Error("O banco não devolveu nenhuma conta nesta conexão."); e.itemStatus=status; throw e; }
    txPorConta={};
    for(let i=0;i<contas.length;i++){
      const c=contas[i];
      etapa(`Buscando os lançamentos de ${c.name||"conta"}…`,0.2+0.75*(i/contas.length));
      try{ txPorConta[c.id]=(await pluggyApi("transactions",{ accountId:c.id, from, to })).results||[]; }
      catch(err){ erros.push({ accountId:c.id, nome:c.name||"Conta", error:err.message }); }
    }
    if(erros.length===contas.length){ const e=new Error(erros[0].error||"Não foi possível buscar os lançamentos."); e.itemStatus=status; throw e; }
  }
  // conta/cartão que a conexão traz e ainda não existe aqui é criado na hora (ver garantirContasPluggy)
  const { accounts:accountsComNovas, novas } = garantirContasPluggy(contas, accounts, conexao.connectorName);
  etapa("Organizando os lançamentos…",0.97);
  const { docs,rows,ignorados }=mapPluggyDocs({
    contas, txPorConta, accounts:accountsComNovas, categoryMemory, jaImportados,
    criadasAgora:new Set(novas.map(a=>a.id)),
    conexao:{ id:conexao.id, connectorName:conexao.connectorName },
  });
  // saldo informado pelo próprio banco, por conta do app: é o que a Home usa como "saldo total" das contas
  // conectadas (o saldo calculado só pelos lançamentos importados não enxerga o que veio antes da janela)
  const saldos={}, contasDaConexao=[];
  contas.forEach(c=>{
    const m=matchPluggyAccount(c,accountsComNovas);
    if(m && m.id) contasDaConexao.push(m.id);
    if(m && m.id && pluggyKind(c)==="conta" && typeof c.balance==="number") saldos[m.id]=Math.round(c.balance*100);
  });
  // sincronização parcial: o que veio é aproveitado, e as contas que falharam são nomeadas no aviso
  const parcial=erros.length>0;
  if(parcial) aviso=`Não deu para buscar ${erros.map(x=>x.nome).join(", ")} agora (${erros[0].error}). As outras contas foram atualizadas; nova tentativa em instantes.`;
  return { status, aviso, parcial, erros, contas, novas, accountsComNovas, docs, rows, ignorados, saldos, contasDaConexao };
}

/* linha de revisão (mesmo formato da leitura de PDF) → lançamento do app, como a revisão faz ao aprovar.
   Só entra o que está completo: conta definida e, em transferência, destino diferente da origem. */
function pluggyRowToTx(it){
  const base={ id:uid(), type:it.type, cents:it.cents, category:it.type==="transferencia"?"":it.category,
    description:it.desc, date:it.date, acctId:it.acctId, status: it.date>todayISO()?"previsto":"realizado", source:"pluggy_sync" };
  if(it.type==="transferencia") base.toAcctId=it.toAcctId;
  if(it.pluggyId) base.pluggyId=it.pluggyId;
  return base;
}
const pluggyRowCompleta=(it)=>Boolean(it.acctId && it.cents>0 && (it.type!=="transferencia"||(it.toAcctId&&it.toAcctId!==it.acctId)));

export { PLUGGY_CONNECT_SRCS, pluggyConnectPromise, carregarScript, loadPluggyConnect, pluggyApi, pluggySyncApi, abrirPluggyConnect, conexaoDoItem, comConexao, adotarExistentes, PLUGGY_UUID, PLUGGY_SUBTIPO, PLUGGY_ITEM_STATUS, pluggyKind, pluggyFingerprints, matchPluggyAccount, CONTA_COLORS, nomeContaAutomatica, garantirContasPluggy, PLUGGY_CAT_GASTO, PLUGGY_CAT_GANHO, pluggyCategoria, RE_PAGTO_NO_CARTAO, RE_PAGTO_DE_FATURA, ehPagamentoDeFatura, contrapartePropria, mapPluggyDocs, diasDesdeUltimaSync, syncPluggyConnection, pluggyRowToTx, pluggyRowCompleta };
