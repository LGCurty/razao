/* components/investments/Investments.jsx — Investimentos › Carteira. */
import React, { useMemo, useState } from "react";
import { BarGroups, Donut, Legend, ProgressBar } from "../common/Charts";
import { askConfirm, toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Money } from "../common/Input";
import { HelpIcon } from "../help/HelpIcon";
import { CLASSES, CLASS_COLOR } from "../../domain/categories";
import { financialIndependence } from "../../utils/calculations";
import { brl, brlNum } from "../../utils/formatters";
import { uid } from "../../utils/ids";

/* ---------- INVESTIMENTOS ---------- */
function Investimentos({ holdings, update, monthIndex, monthLabel, txs, view, onSelectMonth }){
  const [form,setForm]=useState(null);
  const [classFilter,setClassFilter]=useState(null);
  const EMPTY_BUCKET={entradas:0,saidas:0,investido:0,proventos:0,porCategoria:{},itens:[]};
  const monthBucket=(mk)=>monthIndex[mk]||EMPTY_BUCKET;
  const vKey=`${view.getFullYear()}-${String(view.getMonth()+1).padStart(2,"0")}`;
  const blank={name:"",cls:CLASSES[0],invested:0,current:0};
  const save=()=>{if(!form.name.trim())return;update(d=>({holdings: form.id?d.holdings.map(x=>x.id===form.id?form:x):[...d.holdings,{...form,id:uid()}]}));setForm(null);toast("Ativo salvo.","success");};
  const remove=(h)=>askConfirm({title:"Excluir ativo?",message:`"${h.name}" será removido da sua carteira.`,onConfirm:()=>{update(d=>({holdings:d.holdings.filter(x=>x.id!==h.id)}));toast("Ativo excluído.","success");}});
  const totInv=holdings.reduce((s,h)=>s+h.invested,0);
  const totCur=holdings.reduce((s,h)=>s+h.current,0);
  const rend=totCur-totInv;
  const byClass=useMemo(()=>{const m={};holdings.forEach(h=>{m[h.cls]=(m[h.cls]||0)+h.current;});return Object.entries(m).filter(([,v])=>v>0).map(([name,value])=>({name,value,color:CLASS_COLOR[name]||"var(--text-mut)"}));},[holdings]);
  const aportesMes=monthBucket(vKey).investido;
  const proventosMes=monthBucket(vKey).proventos;
  const proventosTotal=useMemo(()=>Object.values(monthIndex).reduce((s,b)=>s+b.proventos,0),[monthIndex]);
  const proventosEvo=useMemo(()=>{
    const arr=[];
    for(let i=5;i>=0;i--){
      const d=new Date(view.getFullYear(),view.getMonth()-i,1);
      const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const b=monthBucket(mk);
      arr.push({name:d.toLocaleDateString("pt-BR",{month:"short"}).replace(".",""),bars:[{v:b.investido/100,color:"var(--inv)"},{v:b.proventos/100,color:"var(--pos)"}],date:d});
    }
    return arr;
  },[monthIndex,view]);
  const hasProventosEvo=proventosEvo.some(m=>m.bars.some(b=>b.v>0));
  const activeProvIdx=proventosEvo.findIndex(e=>e.date.getFullYear()===view.getFullYear()&&e.date.getMonth()===view.getMonth());
  const fi=useMemo(()=>financialIndependence(monthIndex,view),[monthIndex,view]);
  const toggleClass=(name)=>setClassFilter(f=>f===name?null:name);
  const visibleHoldings=classFilter?holdings.filter(h=>h.cls===classFilter):holdings;
  return (
    <React.Fragment>
      <div className="card g-6">
        <h3>Carteira consolidada <HelpIcon section="investimentos-ajuda"/></h3>
        <div className="kv"><span className="kk">Total aplicado</span><span className="vv" style={{color:"var(--inv)"}}>{brl(totInv)}</span></div>
        <div className="kv"><span className="kk">Valor atual</span><span className="vv">{brl(totCur)}</span></div>
        <div className="kv"><span className="kk">Rendimento</span><span className="vv" style={{color:rend>=0?"var(--pos)":"var(--neg)"}}>{rend>=0?"+":"−"} {brlNum(Math.abs(rend))}{totInv>0 && <span style={{fontSize:13,opacity:.8}}>{"  ("}{(rend/totInv*100).toFixed(1)}%{")"}</span>}</span></div>
        <div className="kv"><span className="kk">Aportes em {monthLabel}</span><span className="vv" style={{color:"var(--inv)"}}>{brl(aportesMes)}</span></div>
      </div>
      <div className="card g-6">
        <h3>Proventos recebidos</h3>
        <div className="sub">Dividendos e renda passiva, separados do capital aportado.</div>
        <div className="kv"><span className="kk">Recebido em {monthLabel}</span><span className="vv" style={{color:"var(--pos)"}}>{brl(proventosMes)}</span></div>
        <div className="kv"><span className="kk">Total acumulado</span><span className="vv" style={{color:"var(--pos)"}}>{brl(proventosTotal)}</span></div>
        {hasProventosEvo &&
          <React.Fragment>
            <div className="chlegend" style={{marginTop:8}}><span><i style={{background:"var(--inv)"}}/>Aportes</span><span><i style={{background:"var(--pos)"}}/>Proventos</span></div>
            <BarGroups data={proventosEvo} onSelect={onSelectMonth?(i)=>onSelectMonth(proventosEvo[i].date):undefined} activeIndex={activeProvIdx}/>
          </React.Fragment>}
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

      {byClass.length>0 &&
        <div className="card g-6">
          <h3>Composição por classe</h3>
          <div className="sub" style={{marginBottom:0}}>Clique numa classe para filtrar seus ativos.</div>
          <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap"}}>
            <Donut data={byClass} size={150} onSelect={toggleClass} selected={classFilter} centerLabel="carteira"/>
            <div style={{flex:1,minWidth:160}}><Legend data={byClass} onSelect={toggleClass} selected={classFilter}/></div>
          </div>
        </div>}
      <div className="card g-12">
        <h3>Seus ativos <button className="sbtn" onClick={()=>setForm(blank)}><Icon name="adicionar" size={14}/> Adicionar</button></h3>
        {classFilter &&
          <div className="filterchip">
            <span>Filtrando: {classFilter}</span>
            <button aria-label="Limpar filtro" onClick={()=>setClassFilter(null)}><Icon name="fechar" size={12}/></button>
          </div>}
        {form &&
          <div className="miniform">
            <input className="fld" placeholder="Nome (ex: Tesouro Selic 2029, PETR4)" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={{marginBottom:10}}/>
            <select className="fld" value={form.cls} onChange={e=>setForm({...form,cls:e.target.value})} style={{marginBottom:10}}>{CLASSES.map(c=><option key={c}>{c}</option>)}</select>
            <div className="row2">
              <div style={{flex:1}}><div className="sub" style={{marginBottom:4}}>Valor aplicado</div><Money cents={form.invested} onChange={v=>setForm({...form,invested:v})} small/></div>
              <div style={{flex:1}}><div className="sub" style={{marginBottom:4}}>Valor atual</div><Money cents={form.current} onChange={v=>setForm({...form,current:v})} small/></div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:12}}><button className="sbtn primary" onClick={save}>Salvar</button><button className="sbtn" onClick={()=>setForm(null)}>Cancelar</button></div>
          </div>}
        {holdings.length===0 && !form && <p className="hint">Cadastre seus investimentos para acompanhar a carteira e o rendimento em um só lugar.</p>}
        {holdings.length>0 && visibleHoldings.length===0 && <p className="hint">Nenhum ativo na classe {classFilter}.</p>}
        {visibleHoldings.map(h=>{const r=h.current-h.invested;return(
          <div className="kv" key={h.id}>
            <span className="kk" style={{color:"var(--text)"}}>{h.name}<span style={{color:"var(--text-mut)",fontSize:12}}>  ·  {h.cls}</span></span>
            <span style={{display:"flex",alignItems:"center",gap:10}}>
              <span className="vv">{brl(h.current)}</span>
              <span className="num" style={{fontSize:12,color:r>=0?"var(--pos)":"var(--neg)"}}>{r>=0?"+":"−"}{brlNum(Math.abs(r))}</span>
              <button className="sbtn iconsbtn" aria-label="Editar" onClick={()=>setForm(h)}><Icon name="editar" size={14}/></button>
              <button className="sbtn iconsbtn" aria-label="Excluir" onClick={()=>remove(h)}><Icon name="excluir" size={14}/></button>
            </span>
          </div>);})}
        <p className="hint">Dica: atualize o "valor atual" de tempos em tempos para ver o rendimento real.</p>
      </div>
    </React.Fragment>
  );
}
Investimentos = React.memo(Investimentos);

export { Investimentos };
