/* components/common/Feedback.jsx — avisos (toast), confirmação e escolha de escopo em séries — substituem alert()/confirm(). */
import React, { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Modal";
import { uid } from "../../utils/ids";

/* ---- toasts (substitui alert()) ---- */
let toastListener=null;
function toast(message, tone="default", opts){
  toastListener && toastListener({ id:uid(), message, tone, action:opts&&opts.action, duration:(opts&&opts.duration)||4000 });
}
function ToastHost(){
  const [items,setItems]=useState([]);
  useEffect(()=>{
    toastListener=(t)=>{ setItems(arr=>[...arr,t]); setTimeout(()=>setItems(arr=>arr.filter(x=>x.id!==t.id)),t.duration); };
    return ()=>{ toastListener=null; };
  },[]);
  if(items.length===0) return null;
  return (
    <div className="toasthost">
      {items.map(t=>(
        <div key={t.id} className={"toast "+t.tone}>
          <Icon name={t.tone==="error"?"alerta":t.tone==="success"?"check":"brilho"} size={16}/>
          <span style={{flex:1}}>{t.message}</span>
          {t.action && <button className="toastaction" onClick={()=>{ t.action.onClick(); setItems(arr=>arr.filter(x=>x.id!==t.id)); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

/* ---- diálogo de confirmação (substitui confirm()/exclusões silenciosas) ---- */
let confirmListener=null;
function askConfirm(opts){ confirmListener && confirmListener(opts); }
function ConfirmHost(){
  const [state,setState]=useState(null);
  useEffect(()=>{ confirmListener=setState; return ()=>{ confirmListener=null; }; },[]);
  const close=()=>setState(null);
  return (
    <Sheet open={!!state} onClose={close} title={state?state.title:""}>
      {state &&
        <React.Fragment>
          <p style={{fontSize:14,color:"var(--text-mut)",lineHeight:1.5,marginBottom:20}}>{state.message}</p>
          <div style={{display:"flex",gap:10}}>
            <button className="sbtn" style={{flex:1,justifyContent:"center"}} onClick={close}>Cancelar</button>
            <button className="sbtn danger" style={{flex:1,justifyContent:"center"}} onClick={()=>{ state.onConfirm(); close(); }}>{state.confirmLabel||"Excluir"}</button>
          </div>
        </React.Fragment>}
    </Sheet>
  );
}

// ids afetados por uma escolha de escopo numa série (recorrência/parcelamento): só este / este e os
// próximos (pelo índice na série) / todos. Sem seriesId, só o próprio item conta.
function seriesScopeIds(t, txs, choice){
  if(!t.seriesId || choice==="only") return [t.id];
  if(choice==="future") return txs.filter(x=>x.seriesId===t.seriesId && x.seriesIndex>=t.seriesIndex).map(x=>x.id);
  if(choice==="all") return txs.filter(x=>x.seriesId===t.seriesId).map(x=>x.id);
  return [t.id];
}
let seriesScopeListener=null;
function askSeriesScope(opts){ seriesScopeListener && seriesScopeListener(opts); } // opts: {tx, txs, action:"editar"|"excluir", onChoice(ids)}
function SeriesScopeHost(){
  const [state,setState]=useState(null);
  useEffect(()=>{ seriesScopeListener=setState; return ()=>{ seriesScopeListener=null; }; },[]);
  const close=()=>setState(null);
  function choose(choice){
    if(!state) return;
    state.onChoice(seriesScopeIds(state.tx, state.txs, choice), choice);
    close();
  }
  return (
    <Sheet open={!!state} onClose={close} title={state?`${state.action==="excluir"?"Excluir":"Editar"} lançamento recorrente`:""}>
      {state &&
        <React.Fragment>
          <p style={{fontSize:14,color:"var(--text-mut)",lineHeight:1.5,marginBottom:16}}>
            Este lançamento faz parte de uma série ({state.tx.seriesIndex+1}/{state.tx.seriesTotal}). O que você quer {state.action}?
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button className="sbtn" style={{justifyContent:"center"}} onClick={()=>choose("only")}>Só este</button>
            <button className="sbtn" style={{justifyContent:"center"}} onClick={()=>choose("future")}>Este e os próximos</button>
            <button className="sbtn danger" style={{justifyContent:"center"}} onClick={()=>choose("all")}>Todos</button>
          </div>
        </React.Fragment>}
    </Sheet>
  );
}

export { toastListener, toast, ToastHost, confirmListener, askConfirm, ConfirmHost, seriesScopeIds, seriesScopeListener, askSeriesScope, SeriesScopeHost };
