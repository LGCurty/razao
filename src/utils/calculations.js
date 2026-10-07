/* utils/calculations.js — regras de cálculo: mês da fatura do cartão, saldos por conta, orçamento do mês, independência financeira, fluxo do mês. */
import { TYPES, isRealized } from "../domain/types";
import { monthKey } from "./dates";

// divide um total em n parcelas inteiras (centavos) sem perder nem sobrar 1 centavo no arredondamento
const splitCents = (total, n)=>{
  const base = Math.floor(total/n);
  const remainder = total - base*n;
  return Array.from({length:n}, (_,i)=> base + (i<remainder?1:0));
};
// para gastos em cartão com dia de fechamento/vencimento configurados, devolve o mês da fatura em que o gasto pesa no fluxo de caixa
const txEffectiveMonth = (t, accounts)=>{
  if(t.type==="gasto"){
    const acc=accounts.find(a=>a.id===t.acctId);
    if(acc && acc.kind==="cartao" && acc.closingDay && acc.dueDay){
      const d=new Date(t.date+"T00:00:00");
      let y=d.getFullYear(), m=d.getMonth();
      if(d.getDate()>acc.closingDay) m+=1;
      if(acc.dueDay<=acc.closingDay) m+=1;
      y+=Math.floor(m/12); m=((m%12)+12)%12;
      return `${y}-${String(m+1).padStart(2,"0")}`;
    }
  }
  return monthKey(t.date);
};
// grau de independência financeira: média de proventos ÷ média de gastos totais, nos últimos 6 meses até "view".
// a média divide só pelos meses que realmente têm algum lançamento (não pelos 6 fixos), pra não subestimar
// o indicador logo no começo do uso do app, quando ainda não há 6 meses de histórico.
// recebe o índice único por mês (App) em vez de txs cru — evita re-varrer todo o histórico a cada chamada
const financialIndependence = (monthIndex, view)=>{
  let provSum=0, gastoSum=0, monthsWithData=0;
  for(let i=0;i<6;i++){
    const d=new Date(view.getFullYear(), view.getMonth()-i, 1);
    const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const b=monthIndex[mk];
    if(b && (b.entradas||b.saidas||b.investido)){
      provSum+=b.proventos;
      gastoSum+=b.saidas;
      monthsWithData++;
    }
  }
  const n = monthsWithData||1;
  const avgProv=provSum/n, avgGasto=gastoSum/n;
  const pct = avgGasto>0 ? (avgProv/avgGasto)*100 : (avgProv>0 ? 100 : 0);
  return { pct, avgProv, avgGasto, monthsWithData };
};
// fatura líquida de um cartão num período: gastos do período menos transferências recebidas por ele no
// mesmo período (pagamento da fatura) — nunca fica negativa; o excedente vira crédito restante.
// "items" já deve vir filtrado para o período certo (ex: flowTx do mês, que respeita txEffectiveMonth).
// previsto não entra: um gasto ou pagamento que ainda não aconteceu não compromete a fatura de verdade ainda.
const cardInvoiceNet = (items, acctId)=>{
  const gasto = items.filter(t=>t.type==="gasto" && t.acctId===acctId && isRealized(t)).reduce((s,t)=>s+t.cents,0);
  const paid = items.filter(t=>t.type==="transferencia" && t.toAcctId===acctId && isRealized(t)).reduce((s,t)=>s+t.cents,0);
  return { gasto, paid, net: Math.max(0, gasto-paid), credit: Math.max(0, paid-gasto) };
};

/* dados do "fluxo do mês": as entradas se dividindo em gastos por categoria, investimento e sobra — a
   mesma informação de "Gastos por categoria", só lida de ponta a ponta em vez de fatia isolada. Sobra
   negativa (gastou mais do que entrou) não vira nó do fluxo — largura de faixa não pode ser negativa —,
   fica de fora do desenho e é avisada à parte, pra a geometria nunca quebrar. */
function buildMonthFlow(totals, byCatChart){
  if(!totals || totals.inc<=0) return null;
  const CAP=5; // categorias de sobra viram "Outros gastos" — mantém o desenho legível (Fase de design: teto de série)
  const nodes = byCatChart.slice(0,CAP).map(c=>({ name:c.name, value:c.value, color:c.color }));
  const restValue = byCatChart.slice(CAP).reduce((s,c)=>s+c.value,0);
  if(restValue>0) nodes.push({ name:"Outros gastos", value:restValue, color:"var(--text-mut)" });
  if(totals.inv>0) nodes.push({ name:"Investido", value:totals.inv, color:"var(--inv)" });
  if(totals.saldo>0) nodes.push({ name:"Sobrou", value:totals.saldo, color:"var(--pos)" });
  const shown = nodes.reduce((s,n)=>s+n.value,0);
  if(shown<=0) return null;
  return { inc:totals.inc, nodes, deficit: totals.saldo<0 ? -totals.saldo : 0, shown };
}

/* =========================== APP =========================== */
/* linhas do orçamento de um mês: limite (exceção do mês, se houver, senão o padrão), gasto no mês da
   fatura e status — "warn" a partir de 80%, "over" a partir de 100% */
function budgetRowsFor(budgets, budgetExceptions, mk, spentByCat, catHistory){
  const exceptionsThisMonth=(budgetExceptions||{})[mk]||{};
  const cats=new Set([...Object.keys(budgets||{}),...Object.keys(spentByCat||{}),...Object.keys(exceptionsThisMonth)]);
  return [...cats].map(c=>{
    const isException=Object.prototype.hasOwnProperty.call(exceptionsThisMonth,c);
    const limit=isException?exceptionsThisMonth[c]:((budgets||{})[c]||0);
    const spent=(spentByCat||{})[c]||0,pct=limit>0?spent/limit:0;
    const status=limit===0?"none":pct>=1?"over":pct>=0.8?"warn":"ok";
    return{cat:c,limit,spent,pct,status,hist:(catHistory||{})[c],isException};
  }).sort((a,b)=>b.spent-a.spent);
}

const toReal = (c)=>Number((c/100).toFixed(2));
const pctDiff = (atual, anterior)=> anterior>0 ? Math.round(((atual-anterior)/anterior)*100) : null;

// saldo de cada conta pelo que foi lançado (mesma regra do Panorama: transferência é par débito/crédito,
// só o realizado conta, soma o saldo inicial). Conta ligada ao banco usa o saldo informado pelo banco.
function saldosPorConta(txs, accounts){
  const m={};
  txs.filter(isRealized).forEach(t=>{
    if(t.type==="transferencia"){ m[t.acctId]=(m[t.acctId]||0)-t.cents; m[t.toAcctId]=(m[t.toAcctId]||0)+t.cents; }
    else m[t.acctId]=(m[t.acctId]||0)+t.cents*TYPES[t.type].sign;
  });
  return accounts.map(a=>{
    const calculado=(m[a.id]||0)+(a.openingBalance||0);
    const doBanco = a.kind==="conta" && typeof a.bankBalance==="number";
    return { ...a, calculado, saldo: doBanco ? a.bankBalance : calculado, doBanco };
  });
}
/* ---------- CONTAS ---------- */
// parcelado (não "fixo"/recorrente) sempre carrega o sufixo "(i/n)" no fim da descrição, gerado no submit()
// do formulário — é o único jeito de diferenciar os dois sem guardar um campo novo no lançamento
function isInstallmentSeries(t){
  return t.seriesTotal>1 && new RegExp(`\\(${t.seriesIndex+1}\\/${t.seriesTotal}\\)$`).test(t.description||"");
}

export { splitCents, txEffectiveMonth, financialIndependence, cardInvoiceNet, buildMonthFlow, budgetRowsFor, toReal, pctDiff, saldosPorConta, isInstallmentSeries };
