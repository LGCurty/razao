/* components/budget/Budget.jsx — Orçamento: tabela, edição dos limites, alertas, comprometimento da renda e simulador. */
import React, { useMemo, useState } from "react";
import { ProgressBar } from "../common/Charts";
import { toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Money } from "../common/Input";
import { Sheet } from "../common/Modal";
import { StatusDot } from "../common/StatusDot";
import { HelpIcon } from "../help/HelpIcon";
import { goToTab } from "../navigation/navEvents";
import { CATS, CAT_HINT, CAT_ICON } from "../../domain/categories";
import { isRealized } from "../../domain/types";
import { notificarAparelho } from "../../services/notificationService";
import { txEffectiveMonth } from "../../utils/calculations";
import { monthKey } from "../../utils/dates";
import { brl, capFirst, fmtDateBR } from "../../utils/formatters";

/* ---------- ORÇAMENTO ---------- */
function Orcamento({ onOpenTx, budgetFiltro, onBudgetFiltro, budgetRows, budgets, budgetExceptions, update, plannedTotal, totalSpent, monthLabel, txs, view, accounts, budgetNotify }){
  const allCats=CATS.gasto.map(c=>c[0]);
  const vKey=`${view.getFullYear()}-${String(view.getMonth()+1).padStart(2,"0")}`;

  const setBudgetDefault=(c,cents)=>{update(d=>{const b={...d.budgets};if(cents>0)b[c]=cents;else delete b[c];return {budgets:b};});};
  const setBudgetException=(c,cents)=>{
    update(d=>{
      const monthMap={...(d.budgetExceptions[vKey]||{})};
      if(cents>0) monthMap[c]=cents; else delete monthMap[c];
      const next={...d.budgetExceptions};
      if(Object.keys(monthMap).length) next[vKey]=monthMap; else delete next[vKey];
      return {budgetExceptions:next};
    });
  };
  // "Editar orçamentos": todas as categorias de uma vez, valendo para todos os meses (padrão) ou só para o mês aberto
  const [editando,setEditando]=useState(false);
  // ficha da categoria: toque no nome da categoria na tabela
  const [fichaCat,setFichaCat]=useState(null);
  const fichaRow = fichaCat ? budgetRows.find(r=>r.cat===fichaCat) : null;
  const fichaTxs = useMemo(()=>!fichaCat ? [] : txs
    .filter(t=>t.type==="gasto" && t.category===fichaCat && isRealized(t) && txEffectiveMonth(t,accounts)===vKey)
    .sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0),[fichaCat,txs,accounts,vKey]);
  // filtro escolhido no menu lateral ou nos botões acima da tabela
  const linhasVisiveis = budgetFiltro ? budgetRows.filter(r=>r.status===budgetFiltro) : budgetRows;
  const [escopo,setEscopo]=useState("default");
  const [rascunho,setRascunho]=useState({});
  const valoresDo=(esc)=>Object.fromEntries(allCats.map(c=>[c, esc==="month" ? ((budgetExceptions[vKey]||{})[c] ?? (budgets[c]||0)) : (budgets[c]||0)]));
  function abrirEditor(){ setEscopo("default"); setRascunho(valoresDo("default")); setEditando(true); }
  function trocarEscopo(esc){ setEscopo(esc); setRascunho(valoresDo(esc)); }
  function salvarEditor(){
    if(escopo==="default"){
      update(d=>{
        const b={...d.budgets};
        allCats.forEach(c=>{ const v=rascunho[c]||0; if(v>0) b[c]=v; else delete b[c]; });
        return { budgets:b };
      });
    } else {
      update(d=>{
        const mapa={...((d.budgetExceptions||{})[vKey]||{})};
        allCats.forEach(c=>{ const v=rascunho[c]||0; if(v===((d.budgets||{})[c]||0)) delete mapa[c]; else mapa[c]=v; });
        const next={...d.budgetExceptions};
        if(Object.keys(mapa).length) next[vKey]=mapa; else delete next[vKey];
        return { budgetExceptions:next };
      });
    }
    setEditando(false);
    toast("Orçamentos salvos.","success");
  }
  const [notifPerm,setNotifPerm]=useState(()=> (typeof window!=="undefined" && "Notification" in window) ? Notification.permission : "unsupported");
  async function ativarNotificacoes(){
    try{
      const r=await Notification.requestPermission();
      setNotifPerm(r);
      if(r==="granted"){
        update(d=>({settings:{...d.settings,budgetNotify:true}}));
        notificarAparelho("Alertas de orçamento ligados","Você vai receber um aviso quando uma categoria passar de 80% do limite.","orcamento-teste");
      } else toast("Sem permissão, os avisos continuam aparecendo só na tela.","default");
    }catch(_){ toast("Este navegador não deixou ativar as notificações.","error"); }
  }

  // mesma base do restante do orçamento: gasto conta no mês da fatura do cartão, não no mês da compra
  const prevSpentByCat=useMemo(()=>{
    const d=new Date(view.getFullYear(),view.getMonth()-1,1);
    const pk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const m={};
    txs.filter(t=>t.type==="gasto"&&txEffectiveMonth(t,accounts)===pk).forEach(t=>{m[t.category]=(m[t.category]||0)+t.cents;});
    return m;
  },[txs,view,accounts]);

  // comprometimento das próximas rendas: quanto do que já está lançado (realizado + previsto) pro mês
  // consome a renda esperada dele — olha os 3 próximos meses (o atual e os dois seguintes)
  const commitment=useMemo(()=>{
    const now=new Date();
    return [0,1,2].map(i=>{
      const d=new Date(now.getFullYear(),now.getMonth()+i,1);
      const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      let ganho=0,gasto=0;
      txs.forEach(t=>{
        if(t.type==="transferencia") return;
        const flowMk = t.type==="gasto" ? txEffectiveMonth(t,accounts) : monthKey(t.date);
        if(flowMk!==mk) return;
        if(t.type==="ganho") ganho+=t.cents; else if(t.type==="gasto") gasto+=t.cents;
      });
      const pct = ganho>0 ? gasto/ganho*100 : (gasto>0?100:0);
      return { mk, label:capFirst(d.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})), ganho, gasto, pct, status: ganho===0?"none":pct>=100?"over":pct>=80?"warn":"ok" };
    });
  },[txs,accounts]);

  // simulador "e se" — totalmente local, sem IA: usa a média mensal real dos últimos 6 meses como base
  // e aplica a mudança hipotética na hora, sem gravar nada
  const [simCat,setSimCat]=useState("");
  const [simPct,setSimPct]=useState(0);
  const [simExtraType,setSimExtraType]=useState("gasto");
  const [simExtraValue,setSimExtraValue]=useState(0);
  const avgMonthly=useMemo(()=>{
    const m={};
    txs.filter(isRealized).forEach(t=>{
      if(t.type==="transferencia") return;
      const mk = t.type==="gasto" ? txEffectiveMonth(t,accounts) : monthKey(t.date);
      m[mk]=m[mk]||{ganho:0,gasto:0,inv:0};
      if(t.type==="ganho") m[mk].ganho+=t.cents;
      else if(t.type==="gasto") m[mk].gasto+=t.cents;
      else if(t.type==="investimento") m[mk].inv+=t.cents;
    });
    const keys=Object.keys(m).sort().slice(-6);
    if(keys.length===0) return {ganho:0,gasto:0,inv:0,months:0};
    const sum=keys.reduce((s,k)=>({ganho:s.ganho+m[k].ganho,gasto:s.gasto+m[k].gasto,inv:s.inv+m[k].inv}),{ganho:0,gasto:0,inv:0});
    return { ganho:Math.round(sum.ganho/keys.length), gasto:Math.round(sum.gasto/keys.length), inv:Math.round(sum.inv/keys.length), months:keys.length };
  },[txs,accounts]);
  const avgByCat=useMemo(()=>{
    const m={};
    txs.filter(t=>isRealized(t)&&t.type==="gasto").forEach(t=>{
      const mk=txEffectiveMonth(t,accounts);
      (m[t.category]=m[t.category]||{})[mk]=(m[t.category][mk]||0)+t.cents;
    });
    const out={};
    Object.entries(m).forEach(([cat,byMonth])=>{
      const keys=Object.keys(byMonth).sort().slice(-6);
      out[cat]=Math.round(keys.reduce((s,k)=>s+byMonth[k],0)/Math.max(1,keys.length));
    });
    return out;
  },[txs,accounts]);
  const simResult=useMemo(()=>{
    const catAvg=simCat?(avgByCat[simCat]||0):0;
    const reduction=Math.round(catAvg*(simPct/100));
    const novoGasto=Math.max(0,avgMonthly.gasto-reduction+(simExtraType==="gasto"?simExtraValue:0));
    const novoGanho=avgMonthly.ganho+(simExtraType==="ganho"?simExtraValue:0);
    const saldoAtual=avgMonthly.ganho-avgMonthly.gasto-avgMonthly.inv;
    const novoSaldo=novoGanho-novoGasto-avgMonthly.inv;
    return { reduction, saldoAtual, novoSaldo, delta:novoSaldo-saldoAtual };
  },[avgMonthly,avgByCat,simCat,simPct,simExtraType,simExtraValue]);

  return (
    <React.Fragment>
      <div className="card g-12">
        <h3>
          <span>Orçamento de {monthLabel} <span className="num" style={{fontSize:14,fontWeight:500,color:totalSpent>plannedTotal&&plannedTotal>0?"var(--neg)":"var(--text-mut)"}}>{brl(totalSpent)} / {brl(plannedTotal)}</span></span>
          <span style={{display:"flex",alignItems:"center",gap:6}}>
            {!editando && <button className="sbtn" onClick={abrirEditor}><Icon name="editar" size={14}/> Editar orçamentos</button>}
            <HelpIcon section="orcamento-ajuda"/>
          </span>
        </h3>
        <div className="sub">Os limites valem todo mês e o gasto recomeça do zero no dia 1 — cada mês é medido separado. Gastos no cartão contam no mês da fatura, não no mês da compra.</div>

        {editando
          ? <div className="budedit">
              <div className="seg" style={{marginBottom:12}}>
                <button className={escopo==="default"?"on in":""} onClick={()=>trocarEscopo("default")}>Todos os meses</button>
                <button className={escopo==="month"?"on inv":""} onClick={()=>trocarEscopo("month")}>Só {monthLabel}</button>
              </div>
              <div className="hint" style={{marginTop:-4,marginBottom:10}}>{escopo==="default"
                ? "Limite padrão de cada categoria. Deixe em R$ 0,00 para não ter limite."
                : `Limite só para ${monthLabel} (ex.: dezembro com presentes). O que ficar igual ao padrão não vira exceção.`}</div>
              {allCats.map(c=>(
                <div className="budeditrow" key={c}>
                  <span className="bname"><Icon name={CAT_ICON[c]||"outros"} size={15}/> {c}{CAT_HINT[c] && <small>{CAT_HINT[c]}</small>}</span>
                  <Money cents={rascunho[c]||0} onChange={v=>setRascunho(m=>({...m,[c]:v}))} small/>
                </div>
              ))}
              <div className="formactions" style={{marginTop:12}}>
                <button className="sbtn" onClick={()=>setEditando(false)}>Cancelar</button>
                <button className="submit" onClick={salvarEditor}>Salvar orçamentos</button>
              </div>
            </div>
          : <React.Fragment>
              {budgetRows.length===0 && <p className="hint">Nenhuma categoria com orçamento ou gasto ainda. Toque em "Editar orçamentos" para definir os limites — o histórico de quanto você costuma gastar aparece aqui assim que houver lançamentos.</p>}
              {budgetRows.length>0 &&
                <div className="fchips" role="group" aria-label="Filtrar por status">
                  {[[null,"Todos",budgetRows.length],["ok","Dentro do limite",budgetRows.filter(r=>r.status==="ok").length],["warn","Atenção",budgetRows.filter(r=>r.status==="warn").length],["over","Estourados",budgetRows.filter(r=>r.status==="over").length]].map(([k,l,n])=>
                    <button key={l} className={"fchip"+(k?" "+k:"")+((budgetFiltro||null)===k?" on":"")} aria-pressed={(budgetFiltro||null)===k} onClick={()=>onBudgetFiltro && onBudgetFiltro(k)}>{l} <span>{n}</span></button>)}
                </div>}
              {budgetRows.length>0 && linhasVisiveis.length===0 &&
                <p className="hint">Nenhuma categoria com esse status em {monthLabel}.</p>}
              {linhasVisiveis.length>0 &&
                <div className="budtable" role="table" aria-label={`Orçamento de ${monthLabel}`}>
                  <div className="budtr budth" role="row">
                    <span role="columnheader">Categoria</span><span role="columnheader">Orçado</span><span role="columnheader">Gasto</span><span role="columnheader">%</span><span role="columnheader">Status</span>
                  </div>
                  {linhasVisiveis.map(r=>{
                    const rollover=r.limit>0?r.limit-(prevSpentByCat[r.cat]||0):0;
                    return (
                      <div className={"budtrwrap st-"+r.status} key={r.cat} role="rowgroup">
                        <div className="budtr" role="row">
                          <span className="bname" role="cell"><button type="button" className="bopen" onClick={()=>setFichaCat(r.cat)} aria-label={`Ver detalhes de ${r.cat}`}><Icon name={CAT_ICON[r.cat]||"outros"} size={15}/> {r.cat}<Icon name="seta-direita" size={13}/></button></span>
                          <span className="num" role="cell" data-l="Orçado">{r.limit>0?brl(r.limit):"—"}</span>
                          <span className="num" role="cell" data-l="Gasto">{brl(r.spent)}</span>
                          <span className="num" role="cell" data-l="%">{r.limit>0?`${Math.round(r.pct*100)}%`:"—"}</span>
                          <span role="cell"><StatusDot status={r.status}/></span>
                        </div>
                        <ProgressBar spent={r.spent} limit={r.limit} status={r.status}/>
                        <div className="mm">
                          {r.hist?<>Histórico: mín {brl(r.hist.min)} · média {brl(r.hist.avg)} · máx {brl(r.hist.max)}</>:"Sem histórico ainda"}
                          {r.isException && <> · <span style={{color:"var(--inv)"}}>limite específico de {monthLabel}</span> · <button className="linkbtn" onClick={()=>setBudgetException(r.cat,0)}>remover exceção</button></>}
                        </div>
                        {rollover>0 && <div className="mm" style={{color:"var(--pos)"}}>Sobrou {brl(rollover)} do mês passado nesta categoria — dá para remanejar para este mês ou para investimentos.</div>}
                      </div>);
                  })}
                </div>}
              <div className="budalerts">
                <span><Icon name="alerta" size={14}/> Alertas: aviso quando uma categoria passa de 80% e de 100% do limite.</span>
                {typeof window!=="undefined" && "Notification" in window
                  ? (notifPerm==="granted" && budgetNotify
                      ? <button className="linkbtn" onClick={()=>update(d=>({settings:{...d.settings,budgetNotify:false}}))}>Notificações do aparelho ligadas · desligar</button>
                      : notifPerm==="denied"
                        ? <span className="mm">Notificações bloqueadas no navegador — libere nas permissões do site para receber.</span>
                        : <button className="sbtn" onClick={ativarNotificacoes}><Icon name="brilho" size={14}/> Ativar notificações no aparelho</button>)
                  : <span className="mm">Este navegador não oferece notificações; os avisos aparecem na tela.</span>}
              </div>
            </React.Fragment>}
      </div>

      <div className="card g-12">
        <h3>Comprometimento das próximas rendas</h3>
        <div className="sub" style={{marginBottom:0}}>Quanto do que já está lançado (realizado + previsto) consome a renda esperada em cada mês.</div>
        {commitment.map(c=>(
          <div key={c.mk} style={{marginTop:14}}>
            <div className="bh">
              <span className="bname">{c.label}
                {c.status==="over" && <span className="tag over">comprometido</span>}
                {c.status==="warn" && <span className="tag warn">atenção</span>}
                {c.status==="ok" && <span className="tag ok">tranquilo</span>}
              </span>
              <span className="bval">{brl(c.gasto)}{c.ganho>0 && <span style={{color:"var(--text-mut)"}}> / {brl(c.ganho)}</span>}</span>
            </div>
            {c.ganho>0
              ? <ProgressBar spent={c.gasto} limit={c.ganho} status={c.status}/>
              : <p className="hint" style={{marginTop:4}}>{c.gasto>0?"Gastos lançados sem nenhuma renda prevista para o mês.":"Nada lançado ainda para este mês."}</p>}
          </div>
        ))}
      </div>

      <div className="card g-12">
        <h3>Simulador "e se"</h3>
        <div className="sub">Local, sem IA — {avgMonthly.months>0
          ? `usa a média real dos seus últimos ${avgMonthly.months} ${avgMonthly.months===1?"mês":"meses"} como base e recalcula na hora.`
          : "assim que houver pelo menos um mês fechado, simula aqui o efeito de cortar um gasto ou assumir um novo."}</div>
        {avgMonthly.months===0
          ? <p className="hint">Sem histórico suficiente ainda para simular.</p>
          : <React.Fragment>
              <div className="row2">
                <select className="fld" value={simCat} onChange={e=>setSimCat(e.target.value)}>
                  <option value="">Reduzir uma categoria (opcional)…</option>
                  {allCats.map(c=><option key={c} value={c}>{c} (média {brl(avgByCat[c]||0)}/mês)</option>)}
                </select>
                <input className="fld" type="number" min="0" max="100" placeholder="% de redução" value={simPct||""} onChange={e=>setSimPct(Math.min(100,Math.max(0,parseInt(e.target.value,10)||0)))} disabled={!simCat} style={{flex:"0 0 auto",maxWidth:160}}/>
              </div>
              <div className="row2">
                <select className="fld" value={simExtraType} onChange={e=>setSimExtraType(e.target.value)} style={{flex:"0 0 auto",maxWidth:200}}>
                  <option value="gasto">Novo gasto mensal (opcional)</option>
                  <option value="ganho">Novo ganho mensal (opcional)</option>
                </select>
                <Money cents={simExtraValue} onChange={setSimExtraValue} small/>
              </div>
              <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--surface-2)"}}>
                <div className="kv"><span className="kk">Saldo médio mensal atual</span><span className="vv">{brl(simResult.saldoAtual)}</span></div>
                <div className="kv"><span className="kk"><b>Saldo médio mensal projetado</b></span><span className="vv" style={{fontSize:16,fontWeight:600,color:simResult.novoSaldo>=simResult.saldoAtual?"var(--pos)":"var(--neg)"}}>{brl(simResult.novoSaldo)}</span></div>
                <div className="mm">{simResult.delta>=0?"+":""}{brl(simResult.delta)} por mês em relação ao atual{simResult.reduction>0?` (redução de ${brl(simResult.reduction)} em ${simCat})`:""}</div>
              </div>
            </React.Fragment>}
      </div>

      <Sheet open={!!fichaRow} onClose={()=>setFichaCat(null)} title={fichaRow?`${fichaRow.cat} · ${monthLabel}`:""}>
        {fichaRow &&
          <div className="mvsheet">
            <div className="mvhead">
              <span className={"mvic "+(fichaRow.status==="over"?"out":fichaRow.status==="warn"?"warnic":"in")}><Icon name={CAT_ICON[fichaRow.cat]||"outros"} size={20}/></span>
              <div className="mvtitle"><b>{fichaRow.cat}</b><span className="mono">{CAT_HINT[fichaRow.cat]||"Orçamento do mês"}</span></div>
            </div>
            <div className={"mvstatus "+(fichaRow.status==="over"?"out":fichaRow.status==="warn"?"warn":fichaRow.status==="ok"?"in":"")}>
              <div>
                <div className="mvlabel">Gasto em {monthLabel}</div>
                <div className="mvvalor num">{brl(fichaRow.spent)}</div>
              </div>
              <StatusDot status={fichaRow.status}/>
            </div>
            <div className="mvboxes">
              <div className="mvbox"><small>Orçado</small><b>{fichaRow.limit>0?brl(fichaRow.limit):"Sem limite"}</b></div>
              <div className="mvbox"><small>{fichaRow.limit>0 && fichaRow.spent>fichaRow.limit?"Passou do limite":"Disponível"}</small>
                <b style={{color:fichaRow.limit>0&&fichaRow.spent>fichaRow.limit?"var(--neg)":undefined}}>{fichaRow.limit>0?brl(Math.abs(fichaRow.limit-fichaRow.spent)):"—"}</b></div>
            </div>
            {fichaRow.limit>0 && <ProgressBar spent={fichaRow.spent} limit={fichaRow.limit} status={fichaRow.status}/>}
            <div className="mvspecs">
              <div className="mvspecstitle">Histórico mensal</div>
              <div className="mvspec"><span>Mínimo</span><b>{fichaRow.hist?brl(fichaRow.hist.min):"—"}</b></div>
              <div className="mvspec"><span>Média</span><b>{fichaRow.hist?brl(fichaRow.hist.avg):"—"}</b></div>
              <div className="mvspec"><span>Máximo</span><b>{fichaRow.hist?brl(fichaRow.hist.max):"—"}</b></div>
              <div className="mvspec"><span>% do limite</span><b>{fichaRow.limit>0?`${Math.round(fichaRow.pct*100)}%`:"—"}</b></div>
            </div>
            <div>
              <div className="mvspecstitle">Lançamentos em {monthLabel} ({fichaTxs.length})</div>
              {fichaTxs.length===0 && <p className="hint">Nenhum gasto nesta categoria no mês.</p>}
              {fichaTxs.slice(0,8).map(t=>(
                <button type="button" key={t.id} className="catmov" onClick={()=>{ setFichaCat(null); if(onOpenTx) setTimeout(()=>onOpenTx(t),60); }}>
                  <span className="mono">{fmtDateBR(t.date).slice(0,5)}</span>
                  <b>{t.description||t.category}</b>
                  <span className="num">{brl(t.cents)}</span>
                </button>
              ))}
            </div>
            <div className="mvacts">
              <button className="sbtn" onClick={()=>{ const c=fichaRow.cat; setFichaCat(null); goToTab("balanco",{category:c}); }}><Icon name="filtro" size={15}/> Ver lançamentos</button>
              <button className="sbtn" onClick={()=>{ setFichaCat(null); abrirEditor(); }}><Icon name="editar" size={15}/> Editar limites</button>
            </div>
          </div>}
      </Sheet>
    </React.Fragment>
  );
}
Orcamento = React.memo(Orcamento);

export { Orcamento };
