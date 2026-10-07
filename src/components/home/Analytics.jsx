/* components/home/Analytics.jsx — "Análise interativa" no topo do Panorama (inspirada no Analytics interativo
   do OTAMERICA Sentinel). Feita para o celular: barras horizontais grandes de tocar, uma embaixo da outra.
   Tocar numa barra filtra os outros gráficos; a barra "Filtros ativos" mostra e desfaz cada filtro. */
import React, { useMemo, useState } from "react";
import { Icon } from "../common/Icon";
import { goToTab } from "../navigation/navEvents";
import { CAT_COLOR, CAT_ICON } from "../../domain/categories";
import { analisar } from "../../utils/analytics";
import { todayISO } from "../../utils/dates";
import { brl, capFirst, fmtDateBR } from "../../utils/formatters";

const nomeMes=(mk, longo)=>{ const d=new Date(mk+"-01T00:00:00"); return capFirst(d.toLocaleDateString("pt-BR", longo?{month:"long",year:"numeric"}:{month:"short"}).replace(".","")); };
const ultimoDia=(mk)=>{ const [y,m]=mk.split("-").map(Number); return `${mk}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`; };

function Barras({ titulo, itens, sel, onSel, corDe, iconeDe, limite=6 }){
  const [todas,setTodas]=useState(false);
  const max=Math.max(1,...itens.map(i=>i.cents));
  const visiveis = todas ? itens : itens.slice(0,limite);
  return (
    <div className="card ancard">
      <h3>{titulo}</h3>
      {itens.length===0 && <p className="hint">Nada neste filtro.</p>}
      <div className="anbars" role="group" aria-label={titulo}>
        {visiveis.map(i=>{
          const on=sel===i.chave, apagado=sel && !on;
          return (
            <button type="button" key={i.chave} className={"anrow"+(on?" on":"")+(apagado?" off":"")} aria-pressed={on} onClick={()=>onSel(on?null:i.chave)}>
              <span className="anlbl">{iconeDe && <Icon name={iconeDe(i)} size={14}/>}<span>{i.nome}</span></span>
              <span className="anval num">{brl(i.cents)}</span>
              <span className="antrack"><i style={{width:`${Math.max(2,i.cents/max*100)}%`,background:corDe?corDe(i):"var(--accent)"}}/></span>
            </button>
          );
        })}
      </div>
      {itens.length>limite &&
        <button type="button" className="linkbtn anmore" onClick={()=>setTodas(v=>!v)}>{todas?"Mostrar menos":`Mostrar todas (${itens.length})`}</button>}
    </div>
  );
}

function InteractiveAnalytics({ txs, accounts, onOpenTx }){
  const [tipo,setTipo]=useState("gasto");
  const [periodo,setPeriodo]=useState("6m");
  const [categoria,setCategoria]=useState(null);
  const [conta,setConta]=useState(null);
  const [mes,setMes]=useState(null);
  const mesAtual=todayISO().slice(0,7);
  const r=useMemo(()=>analisar(txs, accounts, { tipo, periodo, categoria, conta, mes, mesAtual }),[txs,accounts,tipo,periodo,categoria,conta,mes,mesAtual]);
  const nomeConta=(id)=>{ const a=(accounts||[]).find(a=>a.id===id); return a ? a.name : "Sem conta"; };
  const corConta=(id)=>{ const a=(accounts||[]).find(a=>a.id===id); return (a && a.color) || "var(--accent)"; };

  const ativos=[
    categoria && { k:"cat", label:`Categoria: ${categoria}`, limpar:()=>setCategoria(null) },
    conta!==null && { k:"conta", label:`Conta: ${nomeConta(conta)}`, limpar:()=>setConta(null) },
    mes && { k:"mes", label:`Mês: ${nomeMes(mes,true)}`, limpar:()=>setMes(null) },
  ].filter(Boolean);
  const limparTudo=()=>{ setCategoria(null); setConta(null); setMes(null); };
  function trocarTipo(t){ setTipo(t); setCategoria(null); }

  // abre a lista de Lançamentos com os mesmos filtros (o mês vira um intervalo de datas)
  function verLancamentos(){
    const f={ types:[tipo] };
    if(categoria) f.categories=[categoria];
    if(conta) f.accounts=[conta];
    if(mes){ f.dateFrom=`${mes}-01`; f.dateTo=ultimoDia(mes); }
    else if(r.meses.length){ f.dateFrom=`${r.meses[0]}-01`; f.dateTo=ultimoDia(r.meses[r.meses.length-1]); }
    goToTab("balanco",{ filters:f });
  }

  const maxMes=Math.max(1,...r.porMes.map(m=>m.cents));
  const cor = tipo==="gasto" ? "var(--neg)" : "var(--pos)";
  return (
    <React.Fragment>
      <div className="card g-12 anhead">
        <h3>Análise interativa</h3>
        <div className="sub">Toque nas barras para filtrar. Só o que já aconteceu entra; gasto no cartão conta no mês da fatura.</div>
        <div className="anctrl">
          <div className="seg mini" role="group" aria-label="Tipo">
            <button className={tipo==="gasto"?"on":""} aria-pressed={tipo==="gasto"} onClick={()=>trocarTipo("gasto")}>Gastos</button>
            <button className={tipo==="ganho"?"on":""} aria-pressed={tipo==="ganho"} onClick={()=>trocarTipo("ganho")}>Renda</button>
          </div>
          <div className="seg mini" role="group" aria-label="Período">
            {[["3m","3 meses"],["6m","6 meses"],["12m","12 meses"],["tudo","Tudo"]].map(([k,l])=>
              <button key={k} className={periodo===k?"on":""} aria-pressed={periodo===k} onClick={()=>{ setPeriodo(k); setMes(null); }}>{l}</button>)}
          </div>
        </div>
        <div className={"anfiltros"+(ativos.length?" on":"")} aria-live="polite">
          <b>Filtros ativos:</b>
          {ativos.length===0
            ? <span className="anvazio">Nenhum filtro selecionado. Toque nos gráficos para interagir.</span>
            : <React.Fragment>
                {ativos.map(a=>(
                  <span className="filterchip" key={a.k}><span>{a.label}</span><button aria-label={"Remover "+a.label} onClick={a.limpar}><Icon name="fechar" size={12}/></button></span>
                ))}
                <button className="clearall" onClick={limparTudo}>Limpar</button>
              </React.Fragment>}
        </div>
        <div className="ankpis">
          <div><small>Total</small><b className="num" style={{color:cor}}>{brl(r.kpis.total)}</b></div>
          <div><small>Lançamentos</small><b className="num">{r.kpis.n}</b></div>
          <div><small>Média por lançamento</small><b className="num">{brl(r.kpis.media)}</b></div>
          <div><small>Maior</small><b className="num">{r.kpis.maior ? brl(r.kpis.maior.cents) : "—"}</b></div>
        </div>
        {r.kpis.n>0 && <button className="sbtn primary anver" onClick={verLancamentos}><Icon name="filtro" size={14}/> Ver os {r.kpis.n} lançamentos</button>}
      </div>

      <div className="card g-12 ancard">
        <h3>Por mês</h3>
        <div className="anmeses" role="group" aria-label="Por mês">
          {r.porMes.map(m=>{
            const on=mes===m.chave, apagado=mes && !on;
            return (
              <button type="button" key={m.chave} className={"anmes"+(on?" on":"")+(apagado?" off":"")} aria-pressed={on}
                aria-label={`${nomeMes(m.chave,true)}: ${brl(m.cents)}`} onClick={()=>setMes(on?null:m.chave)}>
                <span className="anmesbar"><i style={{height:`${m.cents>0?Math.max(4,m.cents/maxMes*100):0}%`,background:cor}}/></span>
                <span className="anmeslbl">{nomeMes(m.chave)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="g-6 anwrap">
        <Barras titulo={tipo==="gasto"?"Por categoria":"Por origem da renda"} itens={r.porCategoria} sel={categoria} onSel={setCategoria}
          corDe={(i)=>CAT_COLOR[i.nome]||"var(--accent)"} iconeDe={(i)=>CAT_ICON[i.nome]||"outros"}/>
      </div>
      <div className="g-6 anwrap">
        <Barras titulo="Por conta" itens={r.porConta} sel={conta} onSel={setConta} corDe={(i)=>corConta(i.chave)} iconeDe={()=>"banco"}/>
      </div>

      {r.maiores.length>0 &&
        <div className="card g-12 ancard">
          <h3>Maiores {tipo==="gasto"?"gastos":"entradas"} do filtro</h3>
          {r.maiores.map(t=>(
            <button type="button" key={t.id} className="catmov" onClick={()=>onOpenTx && onOpenTx(t)}>
              <span className="mono">{fmtDateBR(t.date).slice(0,5)}</span>
              <b>{t.description||t.category}</b>
              <span className="num">{brl(t.cents)}</span>
            </button>
          ))}
        </div>}
    </React.Fragment>
  );
}

export { InteractiveAnalytics };
