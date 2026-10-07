/* components/movements/MovementList.jsx — Gastos › Lançamentos: lista do mês, busca e filtros, gráficos e resumo por IA. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarGroups, Donut, Legend, MonthFlow, ProgressBar, Sparkline } from "../common/Charts";
import { EmptyState } from "../common/EmptyState";
import { askConfirm, askSeriesScope, toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Sheet } from "../common/Modal";
import { RichAI } from "../common/RichAI";
import { HelpIcon } from "../help/HelpIcon";
import { goToTab, openHelp } from "../navigation/navEvents";
import { CAT_COLOR, CAT_ICON } from "../../domain/categories";
import { TYPES, isRealized } from "../../domain/types";
import { AI_SUMMARY_STYLE, aiModelId, buildMonthlyBriefing, callGemini } from "../../services/geminiService";
import { txEffectiveMonth } from "../../utils/calculations";
import { monthKey } from "../../utils/dates";
import { brl, brlNum, extractTags, fmtDateBR, formatHours, shortMonthLabel } from "../../utils/formatters";

function Balanco({ grouped, monthLabel, totals, prevTotals, sparkline, plannedTotal, alerts, byCatChart, acctName, txs, view, accounts, onSelectMonth, update, isDesktop, onEditMobile, monthIndex, categoryMemory, hourlyWageCents, budgetRows, aiModel, pendingFilter, onConsumePendingFilter, onOpenTx }){
  // Fase 4: busca + filtros combináveis, unificando também os filtros por clique nos gráficos (categoria/tipo).
  // Passam a valer em todos os meses (não só o exibido) — exceto quando um intervalo de datas é definido.
  const [search,setSearch]=useState("");
  const [filters,setFilters]=useState({accounts:[],types:[],categories:[],tags:[],dateFrom:"",dateTo:"",status:"",valueMin:"",valueMax:""});
  const [filterSheetOpen,setFilterSheetOpen]=useState(false);
  // lista (agrupada por dia) ou cartões (estilo Sentinel); a escolha fica guardada neste aparelho
  const [modo,setModoState]=useState(()=>{ try{ return localStorage.getItem("razao_mov_modo")==="cartoes"?"cartoes":"lista"; }catch(e){ return "lista"; } });
  const setModo=(m)=>{ setModoState(m); try{ localStorage.setItem("razao_mov_modo",m); }catch(e){} };
  const [ordem,setOrdem]=useState("data"); // cartões: "data" (mais recentes) | "valor" (maiores)
  // filtro chegado de outra aba (ex: clique numa categoria no Panorama) — aplica uma vez e avisa o
  // App pra descartá-lo, senão reabrir o Balanço do zero reaplicaria o mesmo filtro de novo
  useEffect(()=>{
    if(!pendingFilter) return;
    if(pendingFilter.category) setFilters(f=>({...f,categories:[pendingFilter.category]}));
    else if(pendingFilter.tag) setFilters(f=>({...f,tags:[pendingFilter.tag]}));
    onConsumePendingFilter && onConsumePendingFilter();
  },[pendingFilter]);
  const [aiSummary,setAiSummary]=useState("");
  const [aiSummaryBusy,setAiSummaryBusy]=useState(false);
  const [aiSummaryError,setAiSummaryError]=useState("");
  useEffect(()=>{ setAiSummary(""); setAiSummaryError(""); },[monthLabel]);

  function requestEdit(t){
    function proceed(propagateIds){
      // celular e computador editam no mesmo modal do "novo movimento" (antes o computador editava num formulário fixo no topo)
      onEditMobile(t, propagateIds);
    }
    if(t.seriesId){
      askSeriesScope({ tx:t, txs, action:"editar", onChoice:(ids)=>proceed(ids.filter(id=>id!==t.id)) });
      return;
    }
    proceed([]);
  }

  // exclusão de lançamento: some da tela na hora (linha + totais do mês), com "Desfazer" por 6s antes de gravar de
  // verdade. Suporta excluir vários de uma vez (série de recorrência/parcelamento) com o mesmo mecanismo.
  const [pendingDeleteIds,setPendingDeleteIds]=useState(()=>new Set());
  const pendingTimers=useRef(new Map());
  const pendingTxs=useRef(new Map()); // id -> lançamento, só para recalcular os totais exibidos enquanto pendente
  useEffect(()=>()=>{ pendingTimers.current.forEach(t=>clearTimeout(t)); },[]);
  function doRequestDelete(ids, primaryTx){
    setPendingDeleteIds(prev=>{ const n=new Set(prev); ids.forEach(id=>n.add(id)); return n; });
    ids.forEach(id=>{ const found=txs.find(x=>x.id===id); if(found) pendingTxs.current.set(id, found); });
    const timer=setTimeout(()=>{
      update(d=>({ transactions:d.transactions.filter(x=>!ids.includes(x.id)) }));
      ids.forEach(id=>{ pendingTimers.current.delete(id); pendingTxs.current.delete(id); });
      setPendingDeleteIds(prev=>{ const n=new Set(prev); ids.forEach(id=>n.delete(id)); return n; });
    },6000);
    ids.forEach(id=>pendingTimers.current.set(id, timer));
    const label = ids.length>1 ? `${ids.length} lançamentos excluídos.` : `"${primaryTx.description||primaryTx.category||TYPES[primaryTx.type].label}" excluído.`;
    toast(label,"default",{
      duration:6000,
      action:{ label:"Desfazer", onClick:()=>{
        clearTimeout(timer);
        ids.forEach(id=>{ pendingTimers.current.delete(id); pendingTxs.current.delete(id); });
        setPendingDeleteIds(prev=>{ const n=new Set(prev); ids.forEach(id=>n.delete(id)); return n; });
      }},
    });
  }
  function requestDelete(t){
    if(t.seriesId){
      askSeriesScope({ tx:t, txs, action:"excluir", onChoice:(ids)=>doRequestDelete(ids, t) });
      return;
    }
    // confirma antes; e mesmo depois de confirmar ainda dá para desfazer pelo aviso por alguns segundos
    askConfirm({
      title:"Excluir movimento?",
      message:`"${t.description||t.category||TYPES[t.type].label}" de ${brl(t.cents)} em ${fmtDateBR(t.date)} será excluído.`,
      confirmLabel:"Excluir",
      onConfirm:()=>doRequestDelete([t.id], t),
    });
  }
  function markAsPaid(t){
    update(d=>({transactions:d.transactions.map(x=>x.id===t.id?{...x,status:"realizado"}:x)}));
    toast("Marcado como pago.","success");
  }

  async function generateSummary(){
    setAiSummaryBusy(true); setAiSummaryError(""); setAiSummary("");
    try{
      const briefing=buildMonthlyBriefing({ txs, accounts, monthDate:view, monthIndex, budgetRows });
      const prompt=`Você é o analista financeiro pessoal de quem usa este app. Abaixo está o dossiê COMPLETO do mês de ${monthLabel}, em JSON, já calculado a partir dos lançamentos reais (valores em reais).

${JSON.stringify(briefing)}

${AI_SUMMARY_STYLE}`;
      const text=await callGemini({ prompt, model: aiModelId(aiModel) });
      setAiSummary(text.trim());
    }catch(err){
      setAiSummaryError(err.message||"Não foi possível gerar o resumo.");
    }finally{
      setAiSummaryBusy(false);
    }
  }
  const evo=useMemo(()=>{
    const arr=[];
    for(let i=5;i>=0;i--){
      const d=new Date(view.getFullYear(),view.getMonth()-i,1);
      const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const b=monthIndex[mk]||{entradas:0,saidas:0};
      arr.push({name:d.toLocaleDateString("pt-BR",{month:"short"}).replace(".",""),bars:[{v:b.entradas/100,color:"var(--pos)"},{v:b.saidas/100,color:"var(--neg)"}],date:d});
    }
    return arr;
  },[monthIndex,view]);
  const hasEvo=evo.some(m=>m.bars.some(b=>b.v>0));
  const activeEvoIdx=evo.findIndex(e=>e.date.getFullYear()===view.getFullYear()&&e.date.getMonth()===view.getMonth());
  const typeOrder=["ganho","gasto","investimento"];
  const toggleInArray=(key,value)=>setFilters(f=>({...f,[key]:f[key].includes(value)?f[key].filter(v=>v!==value):[...f[key],value]}));
  const toggleCat=(name)=>toggleInArray("categories",name);
  const toggleType=(i)=>toggleInArray("types",typeOrder[i]);
  // clique no gráfico de barras só acende o destaque quando o filtro de tipo resultante é exatamente aquele
  const typeActiveIdx = filters.types.length===1 ? (typeOrder.indexOf(filters.types[0])===-1?null:typeOrder.indexOf(filters.types[0])) : null;
  const catSelected = filters.categories.length===1 ? filters.categories[0] : null;
  const allCategories = Object.keys(CAT_COLOR);
  const allTags=useMemo(()=>{ const set=new Set(); txs.forEach(t=>extractTags(t.description).forEach(tg=>set.add(tg))); return [...set].sort(); },[txs]);
  const hasActiveFilters = search.trim()!=="" || filters.accounts.length>0 || filters.types.length>0 || filters.categories.length>0 || filters.tags.length>0 || !!filters.dateFrom || !!filters.dateTo || !!filters.status || !!filters.valueMin || !!filters.valueMax;
  const activeFilterCount = filters.accounts.length + filters.types.length + filters.categories.length + filters.tags.length + (filters.dateFrom||filters.dateTo?1:0) + (filters.status?1:0) + (filters.valueMin||filters.valueMax?1:0);
  // busca/filtros valem pra todo o histórico (txs é a lista completa, não só o mês exibido)
  const searchResults=useMemo(()=>{
    if(!hasActiveFilters) return null;
    const q=search.trim().toLowerCase();
    const isTagQ=q.startsWith("#")&&q.length>1;
    const tagQ=isTagQ?q.slice(1):"";
    const minCents=filters.valueMin!==""?Math.round(parseFloat(filters.valueMin.replace(",","."))*100):null;
    const maxCents=filters.valueMax!==""?Math.round(parseFloat(filters.valueMax.replace(",","."))*100):null;
    return txs.filter(t=>{
      if(q){
        const desc=(t.description||"").toLowerCase();
        if(isTagQ){ if(!desc.includes("#"+tagQ)) return false; }
        else if(!desc.includes(q) && !(t.category||"").toLowerCase().includes(q)) return false;
      }
      if(filters.accounts.length && !filters.accounts.includes(t.acctId) && !(t.toAcctId&&filters.accounts.includes(t.toAcctId))) return false;
      if(filters.types.length && !filters.types.includes(t.type)) return false;
      if(filters.categories.length && !filters.categories.includes(t.category)) return false;
      if(filters.tags.length){ const tTags=extractTags(t.description); if(!filters.tags.some(tg=>tTags.includes(tg))) return false; }
      if(filters.dateFrom && t.date<filters.dateFrom) return false;
      if(filters.dateTo && t.date>filters.dateTo) return false;
      if(filters.status && (filters.status==="previsto"?isRealized(t):!isRealized(t))) return false;
      if(minCents!=null && !isNaN(minCents) && t.cents<minCents) return false;
      if(maxCents!=null && !isNaN(maxCents) && t.cents>maxCents) return false;
      return true;
    }).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:b.id.localeCompare(a.id));
  },[hasActiveFilters,search,filters,txs]);
  const searchSummary=useMemo(()=>{
    if(!searchResults) return null;
    let sum=0;
    searchResults.forEach(t=>{ sum+=t.cents*TYPES[t.type].sign; });
    return { count:searchResults.length, sum };
  },[searchResults]);
  const searchGrouped=useMemo(()=>{
    if(!searchResults) return null;
    const g={};
    searchResults.forEach(t=>{(g[t.date]=g[t.date]||[]).push(t);});
    return g;
  },[searchResults]);
  const baseGrouped = hasActiveFilters ? (searchGrouped||{}) : grouped;
  // versão exibida: some da tela imediatamente os lançamentos com exclusão pendente (janela de "Desfazer")
  const displayGrouped=useMemo(()=>{
    if(pendingDeleteIds.size===0) return baseGrouped;
    const out={};
    Object.entries(baseGrouped).forEach(([d,list])=>{
      const f=list.filter(t=>!pendingDeleteIds.has(t.id));
      if(f.length) out[d]=f;
    });
    return out;
  },[baseGrouped,pendingDeleteIds]);
  // os mesmos itens numa lista só (cartões), na ordem da lista por dia
  const listaPlana=useMemo(()=>Object.values(displayGrouped).flat(),[displayGrouped]);
  const displayTotals=useMemo(()=>{
    if(pendingDeleteIds.size===0) return totals;
    let { inc, exp, inv, previstoInc, previstoExp, previstoInv } = totals;
    pendingDeleteIds.forEach(id=>{
      const t=pendingTxs.current.get(id);
      if(!t) return;
      const real=isRealized(t);
      if(t.type==="ganho"){ if(real) inc-=t.cents; else previstoInc-=t.cents; }
      else if(t.type==="gasto"){ if(real) exp-=t.cents; else previstoExp-=t.cents; }
      else if(t.type==="investimento"){ if(real) inv-=t.cents; else previstoInv-=t.cents; }
    });
    return { inc, exp, inv, saldo: inc-exp-inv, previstoInc, previstoExp, previstoInv, previstoSaldo: previstoInc-previstoExp-previstoInv };
  },[totals,pendingDeleteIds]);
  // relatório de #tags dentro da categoria filtrada (soma gasta por tag, extraída da descrição) — só quando
  // exatamente uma categoria está selecionada, sempre com base no mês exibido (o gráfico é do mês)
  const tagBreakdown=useMemo(()=>{
    if(filters.categories.length!==1) return [];
    const catName=filters.categories[0];
    const sums={};
    Object.values(grouped).flat().forEach(t=>{
      if(t.type!=="gasto" || t.category!==catName) return;
      extractTags(t.description).forEach(tg=>{ sums[tg]=(sums[tg]||0)+t.cents; });
    });
    return Object.entries(sums).sort((a,b)=>b[1]-a[1]).map(([tag,cents])=>({tag,cents}));
  },[filters.categories,grouped]);
  // chips removíveis: uma entrada por dimensão de filtro ativa (inclusive as vindas de clique no gráfico)
  const activeChips=useMemo(()=>{
    const chips=[];
    if(search.trim()) chips.push({key:"q",label:`Busca: "${search.trim()}"`,onRemove:()=>setSearch("")});
    filters.accounts.forEach(id=>{
      const a=accounts.find(x=>x.id===id);
      chips.push({key:"acc"+id,label:a?a.name:"Conta",onRemove:()=>toggleInArray("accounts",id)});
    });
    filters.types.forEach(ty=>chips.push({key:"ty"+ty,label:TYPES[ty].label,onRemove:()=>toggleInArray("types",ty)}));
    filters.categories.forEach(c=>chips.push({key:"cat"+c,label:c,onRemove:()=>toggleInArray("categories",c)}));
    filters.tags.forEach(tg=>chips.push({key:"tag"+tg,label:"#"+tg,onRemove:()=>toggleInArray("tags",tg)}));
    if(filters.dateFrom||filters.dateTo){
      chips.push({key:"date",label:`${filters.dateFrom?fmtDateBR(filters.dateFrom):"início"} – ${filters.dateTo?fmtDateBR(filters.dateTo):"hoje"}`,onRemove:()=>setFilters(f=>({...f,dateFrom:"",dateTo:""}))});
    }
    if(filters.status) chips.push({key:"status",label:filters.status==="previsto"?"Previsto":"Realizado",onRemove:()=>setFilters(f=>({...f,status:""}))});
    if(filters.valueMin||filters.valueMax){
      chips.push({key:"value",label:`${filters.valueMin?"R$ "+filters.valueMin:"R$ 0"} – ${filters.valueMax?"R$ "+filters.valueMax:"∞"}`,onRemove:()=>setFilters(f=>({...f,valueMin:"",valueMax:""}))});
    }
    return chips;
  },[search,filters,accounts]);
  function clearAllFilters(){ setSearch(""); setFilters({accounts:[],types:[],categories:[],tags:[],dateFrom:"",dateTo:"",status:"",valueMin:"",valueMax:""}); }

  const pctChange = prevTotals.saldo!==0 ? ((displayTotals.saldo-prevTotals.saldo)/Math.abs(prevTotals.saldo))*100 : (displayTotals.saldo>0?100:0);

  return (
    <React.Fragment>
      <div className="dashtop">
        <div className="hero">
          <div className="herotop">
            <div>
              <div className="eyebrow">Saldo do mês</div>
              <div className={"bal num "+(displayTotals.saldo>=0?"pos":"neg")}>{brl(displayTotals.saldo)}</div>
              {(displayTotals.previstoInc!==0||displayTotals.previstoExp!==0||displayTotals.previstoInv!==0) &&
                <div className="num" style={{fontSize:12,color:"var(--text-mut)",marginTop:-12,marginBottom:4}}>
                  previsto: {brl(displayTotals.previstoSaldo)}
                </div>}
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
              <span className={"heropct "+(displayTotals.saldo>=prevTotals.saldo?"up":"down")}>
                <Icon name={displayTotals.saldo>=prevTotals.saldo?"seta-direita":"seta-esquerda"} size={11} style={{transform:displayTotals.saldo>=prevTotals.saldo?"rotate(-90deg)":"rotate(90deg)"}}/>
                {Math.abs(pctChange).toFixed(0)}% vs. mês anterior
              </span>
              <Sparkline data={sparkline}/>
            </div>
          </div>
          <div className="stats">
            <div className="stat"><div className="k"><Icon name="baixar" size={12}/>Entradas</div><div className="v" style={{color:"var(--pos)"}}>{brl(displayTotals.inc)}</div></div>
            <div className="stat"><div className="k"><Icon name="enviar" size={12}/>Saídas</div><div className="v" style={{color:"var(--neg)"}}>{brl(displayTotals.exp)}</div></div>
            <div className="stat"><div className="k"><Icon name="investimentos" size={12}/>Investido</div><div className="v" style={{color:"var(--inv)"}}>{brl(displayTotals.inv)}</div></div>
          </div>
        </div>

      </div>

      {(displayTotals.inc>0||displayTotals.exp>0||displayTotals.inv>0) &&
        <div className="card g-6">
          <h3>Análise do mês <button className="sbtn" onClick={generateSummary} disabled={aiSummaryBusy}><Icon name="brilho" size={14}/>{aiSummaryBusy?"Analisando…":aiSummary?"Refazer":"Gerar com IA"}</button></h3>
          {aiSummaryBusy &&
            <div className="aithink">
              <div className="aiorb"><i/><i/><i/><span className="core"/></div>
              <div className="aibody">
                <div className="aititle"><span>Cruzando os números do mês<span className="aidots"/></span></div>
                <div className="aiphase">Comparando com o mês anterior, categorias, cartões, orçamentos e contas previstas.</div>
                <div className="aibar"><i style={{width:"100%",opacity:.25}}/><span/></div>
              </div>
            </div>}
          {aiSummary && <RichAI text={aiSummary}/>}
          {aiSummaryError && <p className="hint" style={{color:"var(--neg)"}}>{aiSummaryError}</p>}
          {!aiSummary && !aiSummaryBusy && !aiSummaryError && <p className="hint">Uma análise completa do mês: para onde o dinheiro foi, o que mudou em relação ao mês passado, o que merece atenção e três ações concretas — tudo calculado a partir dos seus lançamentos, cartões e orçamentos.</p>}
        </div>}

      {plannedTotal>0 &&
        <div className="card g-6">
          <h3>Planejado × Realizado <span className="num" style={{fontSize:14,fontWeight:500}}>{brl(displayTotals.exp)} / {brl(plannedTotal)}</span></h3>
          <ProgressBar spent={displayTotals.exp} limit={plannedTotal} status={displayTotals.exp>plannedTotal?"over":"ok"}/>
        </div>}

      {alerts.length>0 &&
        <div style={{marginBottom:0,gridColumn:"1/-1"}}>
          {alerts.map(a=>(
            <div key={a.cat} className={"alert "+a.status}>
              <Icon name="alerta" size={16}/>
              <span>{a.status==="over"
                ? <>Você ultrapassou o orçamento de <b>{a.cat}</b> — {brl(a.spent)} de {brl(a.limit)}.</>
                : <>Já usou {Math.round(a.pct*100)}% do orçamento de <b>{a.cat}</b> ({brl(a.spent)} de {brl(a.limit)}).</>}</span>
            </div>
          ))}
        </div>}

      <div className="card g-12">
        <h3>Buscar e filtrar <HelpIcon section="busca-filtros"/></h3>
        <div className="searchbar">
          <div className="searchfield">
            <span className="searchicon"><Icon name="buscar" size={16}/></span>
            <input className="fld" placeholder="Buscar por descrição ou #tag…" value={search} onChange={e=>setSearch(e.target.value)}/>
            {search && <button className="clearbtn" aria-label="Limpar busca" onClick={()=>setSearch("")}><Icon name="fechar" size={14}/></button>}
          </div>
          <button className="sbtn" onClick={()=>setFilterSheetOpen(true)}><Icon name="filtro" size={14}/>Filtros{activeFilterCount>0?` (${activeFilterCount})`:""}</button>
        </div>
        {activeChips.length>0 &&
          <div className="chiprow">
            {activeChips.map(c=>(
              <div className="filterchip" key={c.key}>
                <span>{c.label}</span>
                <button aria-label="Remover filtro" onClick={c.onRemove}><Icon name="fechar" size={12}/></button>
              </div>
            ))}
            <button className="clearall" onClick={clearAllFilters}>Limpar tudo</button>
          </div>}
        {hasActiveFilters && searchSummary &&
          <div className="resultsum">{searchSummary.count} resultado{searchSummary.count!==1?"s":""} encontrado{searchSummary.count!==1?"s":""} · soma: <span className="num">{brl(searchSummary.sum)}</span></div>}
      </div>

      {listaPlana.length>0 &&
        <div className="listbar">
          <span className="listcount">{listaPlana.length} {listaPlana.length===1?"item":"itens"}</span>
          {modo==="cartoes" &&
            <div className="seg mini" role="group" aria-label="Ordenar">
              <button className={ordem==="data"?"on":""} aria-pressed={ordem==="data"} onClick={()=>setOrdem("data")}>Recentes</button>
              <button className={ordem==="valor"?"on":""} aria-pressed={ordem==="valor"} onClick={()=>setOrdem("valor")}>Maior valor</button>
            </div>}
          <div className="seg mini" role="group" aria-label="Visualização">
            <button className={modo==="lista"?"on":""} aria-pressed={modo==="lista"} aria-label="Ver em lista" onClick={()=>setModo("lista")}><Icon name="extrato" size={15}/><span className="segtxt">Lista</span></button>
            <button className={modo==="cartoes"?"on":""} aria-pressed={modo==="cartoes"} aria-label="Ver em cartões" onClick={()=>setModo("cartoes")}><Icon name="grafico" size={15}/><span className="segtxt">Cartões</span></button>
          </div>
        </div>}

      <Sheet open={filterSheetOpen} onClose={()=>setFilterSheetOpen(false)} title="Filtros">
        <div className="sub" style={{marginBottom:8}}>Conta</div>
        <div className="chips" style={{marginBottom:18}}>
          {accounts.map(a=>(
            <button key={a.id} type="button" className={"chip"+(filters.accounts.includes(a.id)?" on":"")} onClick={()=>toggleInArray("accounts",a.id)}>
              <span className="swatch" style={{background:a.color}}/>{a.name}
            </button>
          ))}
        </div>
        <div className="sub" style={{marginBottom:8}}>Tipo</div>
        <div className="chips" style={{marginBottom:18}}>
          {Object.entries(TYPES).map(([k,v])=>(
            <button key={k} type="button" className={"chip"+(filters.types.includes(k)?" on":"")} onClick={()=>toggleInArray("types",k)}>{v.label}</button>
          ))}
        </div>
        <div className="sub" style={{marginBottom:8}}>Categoria</div>
        <div className="chips" style={{marginBottom:18,maxHeight:180,overflowY:"auto"}}>
          {allCategories.map(c=>(
            <button key={c} type="button" className={"chip"+(filters.categories.includes(c)?" on":"")} onClick={()=>toggleInArray("categories",c)}>{c}</button>
          ))}
        </div>
        {allTags.length>0 &&
          <React.Fragment>
            <div className="sub" style={{marginBottom:8}}>Tags</div>
            <div className="chips" style={{marginBottom:18,maxHeight:140,overflowY:"auto"}}>
              {allTags.map(tg=>(
                <button key={tg} type="button" className={"chip"+(filters.tags.includes(tg)?" on":"")} onClick={()=>toggleInArray("tags",tg)}>#{tg}</button>
              ))}
            </div>
          </React.Fragment>}
        <div className="sub" style={{marginBottom:8}}>Status</div>
        <div className="chips" style={{marginBottom:18}}>
          <button type="button" className={"chip"+(filters.status===""?" on":"")} onClick={()=>setFilters(f=>({...f,status:""}))}>Todos</button>
          <button type="button" className={"chip"+(filters.status==="realizado"?" on":"")} onClick={()=>setFilters(f=>({...f,status:"realizado"}))}>Realizado</button>
          <button type="button" className={"chip"+(filters.status==="previsto"?" on":"")} onClick={()=>setFilters(f=>({...f,status:"previsto"}))}>Previsto</button>
        </div>
        <div className="sub" style={{marginBottom:8}}>Intervalo de datas</div>
        <div style={{display:"flex",gap:10,marginBottom:18}}>
          <input className="fld" type="date" value={filters.dateFrom} onChange={e=>setFilters(f=>({...f,dateFrom:e.target.value}))}/>
          <input className="fld" type="date" value={filters.dateTo} onChange={e=>setFilters(f=>({...f,dateTo:e.target.value}))}/>
        </div>
        <div className="sub" style={{marginBottom:8}}>Faixa de valor (R$)</div>
        <div style={{display:"flex",gap:10,marginBottom:20}}>
          <input className="fld" type="number" min="0" step="0.01" placeholder="Mínimo" value={filters.valueMin} onChange={e=>setFilters(f=>({...f,valueMin:e.target.value}))}/>
          <input className="fld" type="number" min="0" step="0.01" placeholder="Máximo" value={filters.valueMax} onChange={e=>setFilters(f=>({...f,valueMax:e.target.value}))}/>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button className="sbtn" style={{flex:1,justifyContent:"center"}} onClick={()=>setFilters({accounts:[],types:[],categories:[],tags:[],dateFrom:"",dateTo:"",status:"",valueMin:"",valueMax:""})}>Limpar filtros</button>
          <button className="sbtn primary" style={{flex:1,justifyContent:"center"}} onClick={()=>setFilterSheetOpen(false)}>Concluído</button>
        </div>
      </Sheet>

      {hasActiveFilters
        ? (Object.keys(displayGrouped).length===0 &&
            <EmptyState icon="filtro" title="Nenhum resultado" text="Nenhum lançamento corresponde à busca ou aos filtros aplicados." action={{label:"Ver no manual",onClick:()=>openHelp("busca-filtros")}}/>)
        : (Object.keys(grouped).length===0 &&
            <EmptyState icon="documento" title={`Nenhum lançamento em ${monthLabel}`}
              text={isDesktop
                ? "Use o botão \"Novo movimento\" no canto da tela para registrar um lançamento — ou mande de uma vez os PDFs do banco e do cartão e deixe a IA preencher tudo."
                : "Toque no botão + para registrar um lançamento — ou mande de uma vez os PDFs do banco e do cartão e deixe a IA preencher tudo."}
              action={{label:"Importar extratos e faturas",icon:"brilho",onClick:()=>goToTab("extrato")}}
              secondary={{label:"Ver no manual",onClick:()=>openHelp("registrar-lancamentos")}}/>)}

      {modo==="cartoes" && listaPlana.length>0 &&
        <div className="txgrid">
          {(ordem==="valor" ? [...listaPlana].sort((a,b)=>b.cents-a.cents) : listaPlana).map(t=>
            <TxCard key={t.id} t={t} acc={acctName(t.acctId)} acctName={acctName} accounts={accounts} onOpen={()=>onOpenTx && onOpenTx(t)}/>)}
        </div>}

      {modo==="lista" && Object.entries(displayGrouped).map(([d,list])=>{
        const dayTotal=list.reduce((s,t)=>s+t.cents*TYPES[t.type].sign,0);
        return (
          <div className="daygroup" key={d}>
            <div className="dayhead">
              <span>{new Date(d+"T00:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short",...(hasActiveFilters?{year:"2-digit"}:{})})}</span>
              <span className="num">{dayTotal>=0?"+":"−"} {brlNum(Math.abs(dayTotal))}</span>
            </div>
            {list.map(t=>{const cls=TYPES[t.type].cls,acc=acctName(t.acctId);
              const isTrf=t.type==="transferencia";
              const flowMk=txEffectiveMonth(t,accounts), shifted=t.type==="gasto"&&flowMk!==monthKey(t.date);
              const flowLabel=shifted?shortMonthLabel(new Date(flowMk+"-01T00:00:00")):null;
              return(
              <TxRow key={t.id} t={t} cls={cls} acc={acc} isTrf={isTrf} shifted={shifted} flowLabel={flowLabel} acctName={acctName} hourlyWageCents={hourlyWageCents}
                onEdit={()=>requestEdit(t)} onDelete={()=>requestDelete(t)} onMarkPaid={()=>markAsPaid(t)} onTagClick={(tg)=>toggleInArray("tags",tg)}
                onOpen={onOpenTx?()=>onOpenTx(t):undefined}/>);})}
          </div>);
      })}

      {hasEvo &&
        <div className="card g-6">
          <h3>Evolução (6 meses)</h3>
          <div className="sub" style={{marginBottom:0}}>Clique em um mês para navegar até ele.</div>
          <div className="chlegend"><span><i style={{background:"var(--pos)"}}/>Entradas</span><span><i style={{background:"var(--neg)"}}/>Saídas</span></div>
          <BarGroups data={evo} onSelect={onSelectMonth?(i)=>onSelectMonth(evo[i].date):undefined} activeIndex={activeEvoIdx}/>
        </div>}

      {(totals.inc>0||totals.exp>0||totals.inv>0) &&
        <div className="card g-6">
          <h3>Entradas × Saídas × Investido</h3>
          <div className="sub" style={{marginBottom:0}}>Clique em uma barra para filtrar o mês por tipo.</div>
          <BarGroups data={[
            {name:"Entradas",bars:[{v:totals.inc/100,color:"var(--pos)"}]},
            {name:"Saídas",bars:[{v:totals.exp/100,color:"var(--neg)"}]},
            {name:"Investido",bars:[{v:totals.inv/100,color:"var(--inv)"}]},
          ]} onSelect={toggleType} activeIndex={typeActiveIdx}/>
        </div>}

      {byCatChart.length>0 &&
        <div className="card g-12">
          <h3>Gastos por categoria</h3>
          <div className="sub" style={{marginBottom:0}}>Clique numa categoria para filtrar os lançamentos do mês.</div>
          <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap"}}>
            <Donut data={byCatChart} onSelect={toggleCat} selected={catSelected} centerLabel="gastos"/>
            <div style={{flex:1,minWidth:180}}><Legend data={byCatChart} onSelect={toggleCat} selected={catSelected}/></div>
          </div>
          {tagBreakdown.length>0 &&
            <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--surface-2)"}}>
              <div className="sub" style={{marginBottom:6}}>#tags dentro de {filters.categories[0]} em {monthLabel}</div>
              {tagBreakdown.map(tg=>(
                <div className="kv" key={tg.tag}><span className="kk">#{tg.tag}</span><span className="vv">{brl(tg.cents)}</span></div>
              ))}
            </div>}
        </div>}

      {totals.inc>0 &&
        <div className="card g-12">
          <h3>Fluxo do mês</h3>
          <MonthFlow totals={totals} byCatChart={byCatChart} monthLabel={monthLabel}/>
        </div>}
    </React.Fragment>
  );
}
Balanco = React.memo(Balanco); // evita re-renderizar a aba inteira quando o App re-renderiza por motivo alheio (tema, menu, scroll…)

function TxRow({ t, cls, acc, isTrf, shifted, flowLabel, acctName, onEdit, onDelete, onMarkPaid, onTagClick, hourlyWageCents, onOpen }){
  const [swiped,setSwiped]=useState(false);
  const startX=useRef(null);
  function onTouchStart(e){ startX.current=e.touches[0].clientX; }
  function onTouchEnd(e){
    if(startX.current==null) return;
    const dx=e.changedTouches[0].clientX-startX.current;
    if(dx<-40) setSwiped(true); else if(dx>40) setSwiped(false);
    startX.current=null;
  }
  const previsto = !isRealized(t);
  const inSeries = t.seriesTotal>1;
  const tags = useMemo(()=>extractTags(t.description),[t.description]);
  // tocar na linha abre a ficha completa; com as ações reveladas pelo deslize, o toque só as recolhe
  function onClick(e){
    if(e.target.closest("button")) return;
    if(swiped){ setSwiped(false); return; }
    if(onOpen) onOpen();
  }
  return (
    <div className={"tx"+(swiped?" swiped":"")+(previsto?" previsto":"")+(onOpen?" clicavel":"")} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      onClick={onClick} {...(onOpen?{role:"button",tabIndex:0,"aria-label":`Ver detalhes: ${t.description||t.category||TYPES[t.type].label}`,onKeyDown:(e)=>{ if((e.key==="Enter"||e.key===" ") && e.target===e.currentTarget){ e.preventDefault(); onOpen(); } }}:{})}>
      <div className={"emo "+cls}><Icon name={isTrf?"transferencia":(CAT_ICON[t.category]||"outros")} size={17}/></div>
      <div className="info">
        <div className="t1">{t.description||(isTrf?"Transferência":t.category)}{previsto && <span className="tag warn" style={{marginLeft:6}}>previsto</span>}</div>
        <div className="t2">
          {isTrf
            ? <span>De {acctName(t.acctId)?.name||"?"} → {acctName(t.toAcctId)?.name||"?"}</span>
            : <><span>{t.description?t.category:TYPES[t.type].label}</span>{acc && <span className="acc"><i className="dot" style={{background:acc.color}}/>{acc.name}</span>}{shifted && <span style={{color:"var(--warn)"}}>· fatura {flowLabel}</span>}{inSeries && <span>· {t.seriesIndex+1}/{t.seriesTotal}</span>}</>}
        </div>
        {tags.length>0 &&
          <div className="tagrow">
            {tags.map(tg=>onTagClick
              ? <button type="button" className="tagchip clickable" key={tg} onClick={(e)=>{e.stopPropagation();onTagClick(tg);}}>#{tg}</button>
              : <span className="tagchip" key={tg}>#{tg}</span>)}
          </div>}
      </div>
      <div className={"val "+cls}>
        {isTrf?<>↔ {brlNum(t.cents)}</>:<>{TYPES[t.type].sign>0?"+":"−"} {brlNum(t.cents)}</>}
        {formatHours(t.cents,hourlyWageCents) && <div className="mm" style={{marginTop:2,textAlign:"right"}}>≈ {formatHours(t.cents,hourlyWageCents)}</div>}
      </div>
      <div className="acts">
        {previsto && <button aria-label="Marcar como pago" onClick={onMarkPaid}><Icon name="check" size={16}/></button>}
        <button aria-label="Editar" onClick={onEdit}><Icon name="editar" size={16}/></button>
        <button aria-label="Excluir" onClick={onDelete}><Icon name="excluir" size={16}/></button>
      </div>
    </div>
  );
}

/* cartão de movimento (estilo dos cartões do OTAMERICA Sentinel): faixa colorida pelo tipo no topo,
   "PREVISTO" em âmbar quando ainda não aconteceu, categoria, descrição, conta, data e valor. Toque abre a ficha. */
function TxCard({ t, acc, acctName, onOpen }){
  const tipo=TYPES[t.type]||TYPES.gasto;
  const trf=t.type==="transferencia";
  const previsto=!isRealized(t);
  const destino=trf ? acctName(t.toAcctId) : null;
  return (
    <button type="button" className={"txcard "+(previsto?"warn":tipo.cls)} onClick={onOpen} aria-label={`Ver detalhes: ${t.description||t.category||tipo.label}`}>
      <span className="tcrow">
        <span className="tccat mono">{trf ? "TRANSFERÊNCIA" : String(t.category||tipo.label).toUpperCase()}</span>
        <span className={"tcbadge "+(previsto?"warn":tipo.cls)}>{previsto ? "PREVISTO" : tipo.label.toUpperCase()}</span>
      </span>
      <span className="tcdesc">{t.description||(trf?"Transferência":t.category)}</span>
      <span className="tcmeta"><Icon name={trf?"transferencia":(CAT_ICON[t.category]||"outros")} size={13}/>{trf ? `${acc?.name||"?"} → ${destino?.name||"?"}` : (acc?.name||"Sem conta")}</span>
      <span className="tcmeta"><Icon name="calendario" size={13}/>{fmtDateBR(t.date)}{t.seriesTotal>1?` · ${(t.seriesIndex||0)+1}/${t.seriesTotal}`:""}</span>
      <span className={"tcval num "+tipo.cls}>{trf?"↔":tipo.sign>0?"+":"−"} {brlNum(t.cents)}</span>
    </button>
  );
}

export { Balanco, TxRow, TxCard };
