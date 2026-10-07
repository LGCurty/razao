/* utils/analytics.js — análise interativa do Panorama (inspirada no "Analytics interativo" do OTAMERICA
   Sentinel): filtros cruzados por categoria, conta e mês. Cada gráfico é calculado com todos os filtros
   MENOS o dele mesmo — tocar numa categoria não some com as outras do gráfico de categorias, mas recalcula
   os de conta e de mês. Só o realizado conta; gasto no cartão vale pelo mês da fatura (mesma régua do app). */
import { isRealized } from "../domain/types";
import { txEffectiveMonth } from "./calculations";

const PERIODOS = { "3m":3, "6m":6, "12m":12, tudo:null };

// lista de meses "AAAA-MM" dos últimos n meses até mesAtual (inclusive), do mais antigo ao mais novo
function ultimosMeses(mesAtual, n){
  const [y,m]=mesAtual.split("-").map(Number);
  const out=[];
  for(let i=n-1;i>=0;i--){ const d=new Date(y,m-1-i,1); out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
  return out;
}

function analisar(txs, accounts, { tipo="gasto", periodo="6m", categoria=null, conta=null, mes=null, mesAtual }){
  const n=PERIODOS[periodo];
  const janela = n ? new Set(ultimosMeses(mesAtual, n)) : null;
  const base=(txs||[]).filter(t=>t.type===tipo && isRealized(t)).map(t=>({ t, mk: tipo==="gasto" ? txEffectiveMonth(t,accounts) : String(t.date).slice(0,7) }))
    .filter(x=>!janela || janela.has(x.mk));
  const passa=(x, ignorar)=>(ignorar==="categoria" || !categoria || (x.t.category||"Outros")===categoria)
    && (ignorar==="conta" || conta==null || (x.t.acctId||"")===conta)
    && (ignorar==="mes" || !mes || x.mk===mes);
  const somar=(lista, chave)=>{
    const m=new Map();
    lista.forEach(x=>{ const k=chave(x); m.set(k,(m.get(k)||0)+x.t.cents); });
    return m;
  };
  const nomeConta=(id)=>{ const a=(accounts||[]).find(a=>a.id===id); return a ? a.name : "Sem conta"; };

  const catMap=somar(base.filter(x=>passa(x,"categoria")), x=>x.t.category||"Outros");
  const contaMap=somar(base.filter(x=>passa(x,"conta")), x=>x.t.acctId||"");
  const mesMap=somar(base.filter(x=>passa(x,"mes")), x=>x.mk);
  const filtrados=base.filter(x=>passa(x,null)).map(x=>x.t);

  const ord=(m)=>[...m.entries()].sort((a,b)=>b[1]-a[1]);
  const mesesEixo = n ? ultimosMeses(mesAtual, n) : [...mesMap.keys()].sort();
  const total=filtrados.reduce((s,t)=>s+t.cents,0);
  const maior=filtrados.reduce((m,t)=>!m||t.cents>m.cents?t:m,null);
  return {
    porCategoria: ord(catMap).map(([nome,cents])=>({ chave:nome, nome, cents })),
    porConta: ord(contaMap).map(([id,cents])=>({ chave:id, nome:nomeConta(id), cents })),
    porMes: mesesEixo.map(mk=>({ chave:mk, nome:mk, cents:mesMap.get(mk)||0 })),
    maiores: [...filtrados].sort((a,b)=>b.cents-a.cents).slice(0,5),
    kpis: { total, n:filtrados.length, media: filtrados.length ? Math.round(total/filtrados.length) : 0, maior },
    meses: mesesEixo,
  };
}

export { PERIODOS, ultimosMeses, analisar };
