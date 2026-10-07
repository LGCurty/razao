/* components/home/Panorama.jsx — Panorama completo (abaixo dos cartões da Home) e indicadores do Banco Central. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarGroups, Donut, Legend, ProgressBar } from "../common/Charts";
import { EmptyState } from "../common/EmptyState";
import { toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { RichAI } from "../common/RichAI";
import { HelpIcon } from "../help/HelpIcon";
import { goToTab, openHelp } from "../navigation/navEvents";
import { InteractiveAnalytics } from "./Analytics";
import { CAT_COLOR, QUALITATIVE } from "../../domain/categories";
import { TYPES, isRealized } from "../../domain/types";
import { fetchBcbIndicators } from "../../services/bcbService";
import { AI_SUMMARY_STYLE, aiModelId, buildMonthlyBriefing, callGemini, detectRecurringCandidates } from "../../services/geminiService";
import { cardInvoiceNet, financialIndependence, toReal } from "../../utils/calculations";
import { todayISO, weekStartISO } from "../../utils/dates";
import { brl, extractTags, fmtDateBR, shortMonthLabel } from "../../utils/formatters";

function BcbIndicators(){
  const [state,setState]=useState({status:"loading"});
  useEffect(()=>{
    let alive=true;
    fetchBcbIndicators().then(data=>{ if(alive) setState({status:"ok",data}); }).catch(err=>{ if(alive) setState({status:"err",error:err.message}); });
    return ()=>{ alive=false; };
  },[]);
  if(state.status==="err") return null;
  return (
    <div className="card g-6">
      <h3>Indicadores econômicos</h3>
      <div className="sub" style={{marginBottom:state.status==="loading"?0:14}}>Fonte: Banco Central (SGS) · cache diário.</div>
      {state.status==="loading" && <p className="hint">Carregando…</p>}
      {state.status==="ok" && <React.Fragment>
        {state.data.selic!=null && <div className="kv"><span className="kk">Selic (meta)</span><span className="vv">{state.data.selic.toFixed(2).replace(".",",")}% a.a.</span></div>}
        {state.data.cdi!=null && <div className="kv"><span className="kk">CDI (diário)</span><span className="vv">{state.data.cdi.toFixed(4).replace(".",",")}%</span></div>}
        {state.data.ipca12m!=null && <div className="kv"><span className="kk">IPCA (12 meses)</span><span className="vv">{state.data.ipca12m.toFixed(2).replace(".",",")}%</span></div>}
      </React.Fragment>}
    </div>
  );
}

/* ---------- PANORAMA GERAL (consolidado de todos os meses e todas as contas) ---------- */
function Geral({ txs, accounts, holdings, view, onSelectMonth, monthIndex, update, patrimonyHistory, recaps, aiModel, onOpenTx }){
  const EMPTY_BUCKET={entradas:0,saidas:0,investido:0,proventos:0,porCategoria:{},itens:[]};
  const monthBucket=(mk)=>monthIndex[mk]||EMPTY_BUCKET;
  // totais de todos os tempos: soma os baldes do índice em vez de re-varrer txs inteiro
  const totals=useMemo(()=>{
    let inc=0,exp=0,inv=0;
    Object.values(monthIndex).forEach(b=>{ inc+=b.entradas; exp+=b.saidas; inv+=b.investido; });
    return { inc, exp, inv, saldo: inc-exp-inv };
  },[monthIndex]);

  // saldo por conta: transferências são lançamento em par (debita a origem, credita o destino) em vez de usar o sinal fixo do tipo.
  // só o realizado conta (previsto ainda não aconteceu); soma o saldo inicial da conta por cima.
  // (dimensão por conta, não por mês — continua varrendo txs uma única vez, já é O(n) direto)
  const byAccount=useMemo(()=>{
    const m={};
    txs.filter(isRealized).forEach(t=>{
      if(t.type==="transferencia"){
        m[t.acctId]=(m[t.acctId]||0)-t.cents;
        m[t.toAcctId]=(m[t.toAcctId]||0)+t.cents;
      } else {
        m[t.acctId]=(m[t.acctId]||0)+t.cents*TYPES[t.type].sign;
      }
    });
    return accounts.map(a=>({ ...a, balance:(m[a.id]||0)+(a.openingBalance||0) }));
  },[txs,accounts]);

  // limite de cartão comprometido: gastos cuja fatura (fechamento/vencimento) cai no mês atual real,
  // menos transferências recebidas por aquele cartão no mesmo período (pagamento da fatura)
  const todayMk=useMemo(()=>{ const t=new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`; },[]);
  const cardCommitted=(acctId)=>cardInvoiceNet(monthBucket(todayMk).itens, acctId);

  const fi=useMemo(()=>financialIndependence(monthIndex,view),[monthIndex,view]);

  const totCur=holdings.reduce((s,h)=>s+h.current,0);
  const contasBalance=byAccount.filter(a=>a.kind==="conta").reduce((s,a)=>s+a.balance,0);
  const patrimonio=contasBalance+totCur;

  // snapshot mensal automático do patrimônio: atualiza o valor do mês corrente sempre que ele mudar (assim o mês
  // fica sempre em dia enquanto está em curso) e nunca mexe nos meses já fechados — isso é o "histórico".
  // Só grava quando o valor realmente muda, pra não gerar um save a cada render.
  const todayMkForSnapshot=useMemo(()=>todayISO().slice(0,7),[]);
  useEffect(()=>{
    if(accounts.length===0 && holdings.length===0) return;
    if((patrimonyHistory||{})[todayMkForSnapshot]===patrimonio) return;
    update(d=>({ patrimonyHistory:{ ...(d.patrimonyHistory||{}), [todayMkForSnapshot]:patrimonio } }));
  },[patrimonio,todayMkForSnapshot,patrimonyHistory,accounts.length,holdings.length]);
  const patrimonyEvo=useMemo(()=>{
    return Object.entries(patrimonyHistory||{}).sort(([a],[b])=>a<b?-1:1).slice(-12).map(([mk,cents])=>{
      const d=new Date(mk+"-01T00:00:00");
      return { name:shortMonthLabel(d), bars:[{v:cents/100,color:cents>=0?"var(--pos)":"var(--neg)"}] };
    });
  },[patrimonyHistory]);

  // contas a pagar / lembretes: lançamentos previstos (ainda não realizados) que vencem nos próximos 7 dias
  // ou já venceram — reaproveita o mesmo campo status:"previsto" já usado no resto do app, sem duplicar dado
  const lembretes=useMemo(()=>{
    const today=todayISO();
    const limitDate=new Date(); limitDate.setDate(limitDate.getDate()+7);
    const limitIso=new Date(limitDate.getTime()-limitDate.getTimezoneOffset()*60000).toISOString().slice(0,10);
    return txs.filter(t=>!isRealized(t) && t.type!=="transferencia" && t.date<=limitIso)
      .sort((a,b)=>a.date<b.date?-1:1);
  },[txs]);
  function marcarLembretePago(t){
    update(d=>({transactions:d.transactions.map(x=>x.id===t.id?{...x,status:"realizado"}:x)}));
    toast("Marcado como pago.","success");
  }

  // recap automático semanal/mensal por IA: ao abrir o Panorama, se a última semana e o último mês já
  // fechados ainda não têm recap gerado (e tiveram movimentação), gera um automaticamente e guarda —
  // não repete depois disso, e uma falha aqui é silenciosa (é um bônus, não deve incomodar ninguém)
  const autoRecapTried=useRef(false);
  useEffect(()=>{
    if(autoRecapTried.current) return;
    autoRecapTried.current=true;
    (async()=>{
      const today=todayISO();
      const lastWeekKey=weekStartISO(new Date(new Date(today+"T00:00:00").getTime()-7*86400000).toISOString().slice(0,10));
      const lastWeekEnd=new Date(new Date(lastWeekKey+"T00:00:00").getTime()+6*86400000).toISOString().slice(0,10);
      if(!(recaps?.weekly||{})[lastWeekKey]){
        const weekTxs=txs.filter(t=>isRealized(t)&&t.date>=lastWeekKey&&t.date<=lastWeekEnd);
        if(weekTxs.length>0){
          const inc=weekTxs.filter(t=>t.type==="ganho").reduce((s,t)=>s+t.cents,0);
          const exp=weekTxs.filter(t=>t.type==="gasto").reduce((s,t)=>s+t.cents,0);
          const inv=weekTxs.filter(t=>t.type==="investimento").reduce((s,t)=>s+t.cents,0);
          try{
            const porCat={}; weekTxs.filter(t=>t.type==="gasto").forEach(t=>{ porCat[t.category]=(porCat[t.category]||0)+t.cents; });
            const briefing={
              periodo:{ de:lastWeekKey, ate:lastWeekEnd },
              totais:{ entradas:toReal(inc), saidas:toReal(exp), investido:toReal(inv), saldo:toReal(inc-exp-inv), lancamentos:weekTxs.length },
              gastoPorCategoria: Object.entries(porCat).sort((a,b)=>b[1]-a[1]).map(([nome,c])=>({nome,valor:toReal(c)})),
              maioresGastos: weekTxs.filter(t=>t.type==="gasto").sort((a,b)=>b.cents-a.cents).slice(0,5)
                .map(t=>({data:t.date,descricao:(t.description||"").trim()||t.category,categoria:t.category,valor:toReal(t.cents)})),
              semanaAnterior: (()=>{
                const ini=new Date(new Date(lastWeekKey+"T00:00:00").getTime()-7*86400000).toISOString().slice(0,10);
                const fim=new Date(new Date(lastWeekKey+"T00:00:00").getTime()-86400000).toISOString().slice(0,10);
                const ant=txs.filter(t=>isRealized(t)&&t.date>=ini&&t.date<=fim);
                return { de:ini, ate:fim, entradas:toReal(ant.filter(t=>t.type==="ganho").reduce((s,t)=>s+t.cents,0)), saidas:toReal(ant.filter(t=>t.type==="gasto").reduce((s,t)=>s+t.cents,0)) };
              })(),
            };
            const prompt=`Dossiê da semana financeira encerrada, em JSON (valores em reais):\n\n${JSON.stringify(briefing)}\n\nEscreva um recap da semana em português do Brasil, na segunda pessoa, tom direto e sem jargão. Use SÓ os números do JSON, sem inventar nada. Estrutura: um primeiro parágrafo de 2 a 3 períodos com o veredito da semana (sobrou ou faltou e por quê, comparando com a semana anterior), seguido de 2 a 3 linhas começando com "- " apontando o que puxou o gasto e o que merece atenção na semana que começa. Cite valores no formato R$ 1.234,56.`;
            const text=(await callGemini({prompt})).trim();
            update(d=>({recaps:{...(d.recaps||{weekly:{},monthly:{}}), weekly:{...(d.recaps?.weekly||{}), [lastWeekKey]:{text,generatedAt:new Date().toISOString(),from:lastWeekKey,to:lastWeekEnd}}}}));
          }catch(_){ /* recap é um bônus automático — sem IA disponível, simplesmente não gera dessa vez */ }
        }
      }
      // referência: mês anterior ao mês corrente do calendário (sempre já fechado)
      const curMonthDate=new Date();
      const prevMk=new Date(curMonthDate.getFullYear(),curMonthDate.getMonth()-1,1);
      const prevMonthKey=`${prevMk.getFullYear()}-${String(prevMk.getMonth()+1).padStart(2,"0")}`;
      if(!(recaps?.monthly||{})[prevMonthKey]){
        const b=monthBucket(prevMonthKey);
        if(b.entradas>0||b.saidas>0||b.investido>0){
          try{
            const briefing=buildMonthlyBriefing({ txs, accounts, monthDate:prevMk, monthIndex });
            const prompt=`Você é o analista financeiro pessoal de quem usa este app. O mês ${prevMonthKey} acabou de fechar. Dossiê completo em JSON (valores em reais):\n\n${JSON.stringify(briefing)}\n\n${AI_SUMMARY_STYLE}`;
            const text=(await callGemini({prompt})).trim();
            update(d=>({recaps:{...(d.recaps||{weekly:{},monthly:{}}), monthly:{...(d.recaps?.monthly||{}), [prevMonthKey]:{text,generatedAt:new Date().toISOString()}}}}));
          }catch(_){ /* idem: sem IA disponível agora, tenta de novo na próxima vez que o Panorama abrir */ }
        }
      }
    })();
  },[]);
  const latestWeeklyRecap=useMemo(()=>{
    const keys=Object.keys(recaps?.weekly||{}).sort();
    return keys.length?{key:keys[keys.length-1],...recaps.weekly[keys[keys.length-1]]}:null;
  },[recaps]);
  const latestMonthlyRecap=useMemo(()=>{
    const keys=Object.keys(recaps?.monthly||{}).sort();
    return keys.length?{key:keys[keys.length-1],...recaps.monthly[keys[keys.length-1]]}:null;
  },[recaps]);

  const byCatAll=useMemo(()=>{
    const m={};
    Object.values(monthIndex).forEach(b=>{
      Object.entries(b.porCategoria).forEach(([cat,cents])=>{ m[cat]=(m[cat]||0)+cents; });
    });
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value,color:CAT_COLOR[name]||"var(--text-mut)"}));
  },[monthIndex]);

  // gasto por tag (tags de primeira classe): soma, em todo o histórico realizado, quanto foi gasto em
  // lançamentos marcados com cada #tag na descrição — igual ao "por categoria", só que por tag
  const byTagAll=useMemo(()=>{
    const m={};
    txs.filter(t=>isRealized(t)&&t.type==="gasto").forEach(t=>{
      extractTags(t.description).forEach(tg=>{ m[tg]=(m[tg]||0)+t.cents; });
    });
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value],i)=>({name:"#"+name,value,color:QUALITATIVE[i%QUALITATIVE.length]}));
  },[txs]);

  const EVO_CAP=24;
  const evoAll=useMemo(()=>{
    const months=Object.keys(monthIndex).sort();
    if(months.length===0) return { arr:[], truncated:false, total:0 };
    const [fy,fm]=months[0].split("-").map(Number);
    const [ly,lm]=months[months.length-1].split("-").map(Number);
    const total=(ly-fy)*12+(lm-fm)+1;
    const show=Math.min(total,EVO_CAP);
    const start=total-show;
    const arr=[];
    for(let i=start;i<total;i++){
      const d=new Date(fy,fm-1+i,1);
      const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const b=monthBucket(mk);
      arr.push({ name:shortMonthLabel(d), bars:[{v:b.entradas/100,color:"var(--pos)"},{v:b.saidas/100,color:"var(--neg)"}], date:d });
    }
    return { arr, truncated: total>EVO_CAP, total };
  },[monthIndex]);
  const activeEvoIdx=view?evoAll.arr.findIndex(e=>e.date.getFullYear()===view.getFullYear()&&e.date.getMonth()===view.getMonth()):-1;

  const [patternsResult,setPatternsResult]=useState("");
  const [patternsBusy,setPatternsBusy]=useState(false);
  const [patternsError,setPatternsError]=useState("");
  async function analyzePatterns(){
    setPatternsBusy(true); setPatternsError(""); setPatternsResult("");
    try{
      const candidates=detectRecurringCandidates(txs, new Date());
      if(candidates.length===0){
        setPatternsResult("Nenhum padrão fora do comum encontrado — seus gastos recorrentes estão regulares.");
        return;
      }
      const totalRecorrente=candidates.reduce((s,c)=>s+Number(c.ultimoValor||0),0);
      const prompt=`Padrões de gastos recorrentes detectados no histórico financeiro do usuário (JSON, valores em reais). "diasDesdeUltimaVez" alto sugere assinatura cancelada ou cobrança que sumiu; "variacaoPercentual" alto sugere reajuste ou cobrança fora do padrão. Soma dos últimos valores: R$ ${totalRecorrente.toFixed(2)}.

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
      const text=await callGemini({ prompt, model: aiModelId(aiModel) });
      setPatternsResult(text.trim());
    }catch(err){
      setPatternsError(err.message||"Não foi possível analisar os padrões.");
    }finally{
      setPatternsBusy(false);
    }
  }

  if(txs.length===0){
    return <EmptyState icon="panorama" title="Nenhum lançamento registrado ainda"
      text="O jeito mais rápido de começar: baixe os PDFs do mês no site do seu banco e do seu cartão e mande todos aqui de uma vez — a IA lê, classifica e você só confere."
      action={{label:"Importar extratos e faturas",icon:"brilho",onClick:()=>goToTab("extrato")}}
      secondary={{label:"Ver no manual",onClick:()=>openHelp("registrar-lancamentos")}}/>;
  }

  return (
    <React.Fragment>
      <div className="hero">
        <div className="herotop">
          <div>
            <div className="eyebrow">Saldo total acumulado (todos os meses)</div>
            <div className={"bal num "+(totals.saldo>=0?"pos":"neg")}>{brl(totals.saldo)}</div>
          </div>
        </div>
        <div className="stats">
          <div className="stat"><div className="k"><Icon name="baixar" size={12}/>Entradas</div><div className="v" style={{color:"var(--pos)"}}>{brl(totals.inc)}</div></div>
          <div className="stat"><div className="k"><Icon name="enviar" size={12}/>Saídas</div><div className="v" style={{color:"var(--neg)"}}>{brl(totals.exp)}</div></div>
          <div className="stat"><div className="k"><Icon name="investimentos" size={12}/>Investido</div><div className="v" style={{color:"var(--inv)"}}>{brl(totals.inv)}</div></div>
        </div>
      </div>

      <InteractiveAnalytics txs={txs} accounts={accounts} onOpenTx={onOpenTx}/>

      {(latestWeeklyRecap||latestMonthlyRecap) &&
        <div className="card g-12">
          <h3>Recap automático <Icon name="brilho" size={14} style={{color:"var(--accent)"}}/></h3>
          <div className="sub" style={{marginBottom:latestWeeklyRecap&&latestMonthlyRecap?10:0}}>Gerado por IA sozinho quando a semana ou o mês fecham — nenhum clique necessário.</div>
          {latestMonthlyRecap &&
            <div style={{marginBottom:latestWeeklyRecap?14:0}}>
              <div className="sub" style={{marginBottom:4}}>Mês de {latestMonthlyRecap.key}</div>
              <RichAI text={latestMonthlyRecap.text}/>
            </div>}
          {latestWeeklyRecap &&
            <div>
              <div className="sub" style={{marginBottom:4}}>Semana de {fmtDateBR(latestWeeklyRecap.from)} a {fmtDateBR(latestWeeklyRecap.to)}</div>
              <RichAI text={latestWeeklyRecap.text}/>
            </div>}
        </div>}

      <div className="card g-6">
        <h3>Saldo por conta <HelpIcon section="contas-cartoes"/></h3>
        <div className="sub">Soma de todos os lançamentos já registrados em cada conta, desde o início.</div>
        {byAccount.map(a=>{
          const committed=a.kind==="cartao"?cardCommitted(a.id):null;
          return (
          <div className="acct" key={a.id} style={{flexDirection:"column",alignItems:"stretch",gap:0}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div className="adot" style={{background:a.color}}><Icon name={a.kind==="cartao"?"cartao":"banco"} size={16}/></div>
              <div style={{flex:1}}>
                <div className="aname">{a.name}</div>
                <div className="akind">{a.kind==="cartao"?"Cartão":"Conta"}</div>
              </div>
              <span className="num" style={{fontSize:15,fontWeight:500,color:a.balance>=0?"var(--pos)":"var(--neg)"}}>{brl(a.balance)}</span>
            </div>
            {a.kind==="cartao" && a.limit>0 &&
              <div style={{marginTop:8,marginLeft:48}}>
                <ProgressBar spent={committed.net} limit={a.limit} status={committed.net>=a.limit?"over":committed.net/a.limit>=0.8?"warn":"ok"}/>
                <div className="mm">{Math.min(100,committed.net/a.limit*100).toFixed(0)}% do limite comprometido · {brl(committed.net)} de {brl(a.limit)}{committed.credit>0?` · você pagou ${brl(committed.credit)} a mais, que fica como saldo no cartão`:""}</div>
              </div>}
          </div>);})}
      </div>

      <div className="card g-6">
        <h3>Independência Financeira</h3>
        <div className="sub">Quanto os proventos médios dos últimos 6 meses cobririam dos seus gastos médios. Proventos são o que a sua carteira paga sozinha: dividendos, juros, aluguéis.</div>
        {fi.avgProv>0
          ? <React.Fragment>
              <div className="bal num" style={{fontSize:32,fontWeight:500,margin:"2px 0 4px",color:fi.pct>=100?"var(--pos)":"var(--text)"}}>{fi.pct.toFixed(1)}%</div>
              <ProgressBar spent={Math.min(fi.pct,100)} limit={100} status={fi.pct>=100?"ok":fi.pct>=50?"warn":"none"}/>
              <div className="mm">Meta: 100% · Proventos médios {brl(Math.round(fi.avgProv))}/mês · Gastos médios {brl(Math.round(fi.avgGasto))}/mês · calculado com base em {fi.monthsWithData} {fi.monthsWithData===1?"mês":"meses"}</div>
            </React.Fragment>
          : <p className="hint" style={{marginTop:0}}>
              Ainda não há proventos registrados, então este indicador fica em espera — não é um problema, é só o começo.
              Assim que você lançar um ganho na categoria "Proventos", ele passa a mostrar que parte dos seus gastos
              {fi.avgGasto>0?` (hoje ${brl(Math.round(fi.avgGasto))}/mês)`:""} a sua carteira já sustentaria sozinha.
            </p>}
      </div>

      <div className="card g-6">
        <h3>Patrimônio estimado <HelpIcon section="panorama-ajuda"/></h3>
        <div className="sub">Saldo das contas (sem cartões) + valor atual da carteira de investimentos.</div>
        <div className="kv"><span className="kk">Em contas</span><span className="vv">{brl(contasBalance)}</span></div>
        <div className="kv"><span className="kk">Em investimentos</span><span className="vv" style={{color:"var(--inv)"}}>{brl(totCur)}</span></div>
        <div className="kv"><span className="kk"><b>Total</b></span><span className="vv" style={{fontSize:18,fontWeight:600}}>{brl(patrimonio)}</span></div>
      </div>

      {lembretes.length>0 &&
        <div className="card g-6">
          <h3>Contas a pagar e lembretes</h3>
          <div className="sub">Lançamentos previstos que vencem nos próximos 7 dias ou já passaram do prazo.</div>
          {lembretes.map(t=>{
            const today=todayISO();
            const overdue=t.date<today;
            const days=Math.round((new Date(t.date+"T00:00:00")-new Date(today+"T00:00:00"))/86400000);
            return (
              <div className="kv" key={t.id}>
                <span className="kk">
                  {t.description||t.category||TYPES[t.type].label}
                  <span className={"tag "+(overdue?"over":days===0?"warn":"ok")} style={{marginLeft:8}}>
                    {overdue?`atrasado ${Math.abs(days)}d`:days===0?"hoje":`em ${days}d`}
                  </span>
                </span>
                <span style={{display:"flex",alignItems:"center",gap:8}}>
                  <span className="vv" style={{color:t.type==="ganho"?"var(--pos)":"var(--neg)"}}>{brl(t.cents)}</span>
                  <button className="sbtn iconsbtn" aria-label="Marcar como pago" onClick={()=>marcarLembretePago(t)}><Icon name="check" size={14}/></button>
                </span>
              </div>);
          })}
        </div>}

      {patrimonyEvo.length>=2 &&
        <div className="card g-6">
          <h3>Histórico de patrimônio</h3>
          <div className="sub" style={{marginBottom:0}}>Snapshot automático do patrimônio total ao final de cada mês.</div>
          <BarGroups data={patrimonyEvo}/>
        </div>}

      <BcbIndicators/>

      <div className="card g-6">
        <h3>Assinaturas e recorrências <button className="sbtn" onClick={analyzePatterns} disabled={patternsBusy}><Icon name="brilho" size={14}/>{patternsBusy?"Analisando…":"Analisar com IA"}</button></h3>
        <div className="sub">Encontra cobranças mensais que sumiram do seu extrato (assinatura esquecida ou já cancelada) e valores que fugiram do padrão de sempre.</div>
        {patternsBusy &&
          <div className="aithink">
            <div className="aiorb"><i/><i/><i/><span className="core"/></div>
            <div className="aibody">
              <div className="aititle"><span>Procurando padrões nas suas recorrências<span className="aidots"/></span></div>
              <div className="aiphase">Cadência mensal, cobranças que sumiram e valores fora da média.</div>
              <div className="aibar"><i style={{width:"100%",opacity:.25}}/><span/></div>
            </div>
          </div>}
        {patternsResult && <RichAI text={patternsResult}/>}
        {patternsError && <p className="hint" style={{color:"var(--neg)"}}>{patternsError}</p>}
        {!patternsResult && !patternsBusy && !patternsError && <p className="hint">A varredura é local e instantânea; a IA entra só para explicar o que encontrou e sugerir o que fazer.</p>}
      </div>

      {evoAll.arr.length>0 &&
        <div className="card g-12">
          <h3>Evolução completa</h3>
          <div className="sub" style={{marginBottom:0}}>
            {evoAll.truncated?`Mostrando os últimos ${EVO_CAP} de ${evoAll.total} meses. `:""}Clique em um mês para navegar até ele.
          </div>
          <div className="chlegend"><span><i style={{background:"var(--pos)"}}/>Entradas</span><span><i style={{background:"var(--neg)"}}/>Saídas</span></div>
          <BarGroups data={evoAll.arr} onSelect={onSelectMonth?(i)=>onSelectMonth(evoAll.arr[i].date):undefined} activeIndex={activeEvoIdx}/>
        </div>}

      {byCatAll.length>0 &&
        <div className="card g-12">
          <h3>Gastos por categoria (todo o período)</h3>
          <div className="sub" style={{marginBottom:0}}>Clique numa categoria pra ver os lançamentos em Gastos.</div>
          <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap"}}>
            <Donut data={byCatAll} centerLabel="gastos" onSelect={(name)=>goToTab("balanco",{category:name})}/>
            <div style={{flex:1,minWidth:180}}><Legend data={byCatAll} onSelect={(name)=>goToTab("balanco",{category:name})}/></div>
          </div>
        </div>}

      {byTagAll.length>0 &&
        <div className="card g-12">
          <h3>Gasto por tag (todo o período)</h3>
          <div className="sub" style={{marginBottom:0}}>Somado a partir das #tags usadas na descrição dos lançamentos. Clique numa tag pra ver os lançamentos em Gastos.</div>
          <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap"}}>
            <Donut data={byTagAll} centerLabel="gasto" onSelect={(name)=>goToTab("balanco",{tag:name.replace(/^#/,"")})}/>
            <div style={{flex:1,minWidth:180}}><Legend data={byTagAll} onSelect={(name)=>goToTab("balanco",{tag:name.replace(/^#/,"")})}/></div>
          </div>
        </div>}
    </React.Fragment>
  );
}
Geral = React.memo(Geral);

export { BcbIndicators, Geral };
