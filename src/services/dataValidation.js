/* services/dataValidation.js — modelo de dados: estrutura inicial (SEED) e migrate(), que leva qualquer versão anterior (inclusive backups antigos) até a atual. */
import { bancoDoNome } from "../domain/banks";
import { novaCategoria } from "../domain/categories";
import { COLOR_THEME_MAP } from "../domain/themes";
import { AI_MODELS } from "./geminiService";

const SEED = {
  schemaVersion:7, theme:"dark", transactions:[],
  accounts:[{id:"a1",name:"Conta principal",kind:"conta",color:"#3B63C4"},{id:"c1",name:"Cartão de crédito",kind:"cartao",color:"#A57BE0"}],
  budgets:{}, budgetExceptions:{}, goals:[], holdings:[],
  categoryMemory:{}, patrimonyHistory:{}, recaps:{weekly:{},monthly:{}},
  pluggy:{items:[]},
  settings:{hourlyWageCents:0, aiModel:"rapido", colorTheme:"razao", pluggyReview:false},
};
const SCHEMA_VERSION = 7;
/* migrate() é idempotente: leva qualquer versão anterior (inclusive dados sem o campo schemaVersion,
   como um backup .json exportado antes desta mudança) até a atual. Nenhum campo existente é renomeado
   ou removido — só acrescentado, com um padrão seguro, só onde ainda não existir. Rodar duas vezes
   sobre o mesmo dado não muda nada (é seguro chamar tanto no carregamento quanto na importação). */
function migrate(data){
  const d = { ...SEED, ...data };
  // 2.3 — previsto × realizado: lançamentos antigos, sem o campo, sempre foram tratados como já ocorridos
  d.transactions = (d.transactions||[]).map(t=>({ status:"realizado", ...t }));
  // 2.2 — saldo inicial por conta
  // 4.3 — matchKeys: números de conta/cartão aprendidos ao importar documentos, usados para casar
  // documento↔conta sozinho nas próximas importações (ver docFingerprints/resolveDocAccount)
  d.accounts = (d.accounts||[]).map(a=>({ openingBalance:0, openingDate:"", matchKeys:[], ...a }));
  // 3.0 — memória de categorização, histórico de patrimônio e recaps automáticos (Fase 5)
  d.categoryMemory = d.categoryMemory || {};
  d.patrimonyHistory = d.patrimonyHistory || {};
  d.recaps = { weekly:{}, monthly:{}, ...(d.recaps||{}) };
  // 3.0 — meta pode opcionalmente ser ligada a uma categoria real, contando lançamentos daquela categoria
  d.goals = (d.goals||[]).map(g=>({ linkedCategory:null, ...g }));
  // 5.0 — Open Finance: bancos conectados pelo Pluggy. Só guardamos o id da conexão (itemId), o nome do
  // banco e quando foi a última busca — nenhuma credencial passa por aqui, nem fica no navegador.
  d.pluggy = { items:[], ...(d.pluggy||{}) };
  d.pluggy.items = (d.pluggy.items||[])
    .filter(i=>i && typeof i.id==="string" && i.id)
    .map(i=>({ connectorName:"Banco", connectorImage:"", createdAt:"", lastSyncAt:"", lastStatus:"", ...i }));
  // 4.0 — preço em horas de trabalho (opcional): 0 = recurso desligado, não aparece em lugar nenhum
  // 4.1 — escolha do motor de IA usada na leitura de documentos ("rapido" | "cuidadoso")
  // 4.2 — cor de marca escolhível (Configurações > Personalização); "aco" é o padrão de fábrica
  // 6.0 — Open Finance: "revisar antes de salvar" desligado = sincroniza sozinho e grava direto
  d.settings = { hourlyWageCents:0, aiModel:"rapido", colorTheme:"razao", pluggyReview:false, budgetAlerts:true, budgetNotify:false, emailSummary:false, ...(d.settings||{}) };
  if(!AI_MODELS[d.settings.aiModel]) d.settings.aiModel = "rapido";
  // 7.0 — logo nova (grafite + âmbar): quem estava no "aco", o padrão de fábrica anterior, passa para o
  // tema da logo; quem tinha escolhido outra cor continua com ela
  if((Number(data&&data.schemaVersion)||0)<7 && d.settings.colorTheme==="aco") d.settings.colorTheme = "razao";
  if(!COLOR_THEME_MAP[d.settings.colorTheme]) d.settings.colorTheme = "razao";
  // 6.0 — categorias da planilha: converte nomes antigos (lançamentos, orçamentos, exceções do mês,
  // memória de categorização e metas ligadas). Orçamentos de categorias que viraram uma só somam o limite.
  d.transactions = d.transactions.map(t=>{
    const c=novaCategoria(t.type, t.category);
    return c===t.category ? t : { ...t, category:c };
  });
  const fundirOrcamento=(mapa)=>{
    const out={};
    Object.entries(mapa||{}).forEach(([cat,v])=>{ const n=novaCategoria("gasto",cat); out[n]=(out[n]||0)+(Number(v)||0); });
    return out;
  };
  d.budgets = fundirOrcamento(d.budgets);
  d.budgetExceptions = Object.fromEntries(Object.entries(d.budgetExceptions||{}).map(([mk,m])=>[mk,fundirOrcamento(m)]));
  d.categoryMemory = Object.fromEntries(Object.entries(d.categoryMemory||{}).map(([k,v])=>[k, novaCategoria("ganho", novaCategoria("gasto", v))]));
  d.goals = d.goals.map(g=> g.linkedCategory ? { ...g, linkedCategory: novaCategoria("ganho", g.linkedCategory) } : g);
  // 6.0 — banco de cada conta (BTG, Nubank…): deduz do nome quando der; o resto fica em branco até a pessoa escolher
  d.accounts = d.accounts.map(a=> a.bank!==undefined ? a : { ...a, bank: bancoDoNome(a.name) });
  d.schemaVersion = SCHEMA_VERSION;
  return d;
}

export { SEED, SCHEMA_VERSION, migrate };
