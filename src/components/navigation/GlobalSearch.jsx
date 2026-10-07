/* components/navigation/GlobalSearch.jsx — busca global de movimentos, no cabeçalho (inspirada na busca do
   OTAMERICA Sentinel). No celular é um botão de lupa que abre a busca em tela cheia; no computador é um
   campo fixo no topo com a lista de resultados logo abaixo (atalho: tecla "/"). Tocar num resultado abre
   o movimento. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../common/Icon";
import { CAT_ICON } from "../../domain/categories";
import { TYPES } from "../../domain/types";
import { buscarMovimentos } from "../../utils/search";
import { brl, fmtDateBR } from "../../utils/formatters";

function GlobalSearch({ txs, accounts, onOpen }){
  const [q,setQ]=useState("");
  const [aberto,setAberto]=useState(false);
  const inputRef=useRef(null);
  const caixaRef=useRef(null);
  const { itens, total }=useMemo(()=>buscarMovimentos(txs, accounts, q, 40),[txs,accounts,q]);
  const nomeConta=(id)=>{ const a=(accounts||[]).find(x=>x.id===id); return a ? a.name : ""; };

  function abrir(){ setAberto(true); }
  function fechar(){ setAberto(false); setQ(""); if(inputRef.current) inputRef.current.blur(); }

  useEffect(()=>{
    const onKey=(e)=>{
      const digitando=/input|textarea|select/i.test((e.target&&e.target.tagName)||"") || (e.target&&e.target.isContentEditable);
      if(e.key==="/" && !digitando){ e.preventDefault(); abrir(); }
      else if(e.key==="Escape" && aberto){ fechar(); }
    };
    document.addEventListener("keydown",onKey);
    return ()=>document.removeEventListener("keydown",onKey);
  },[aberto]);

  // no computador, clicar fora fecha a lista
  useEffect(()=>{
    if(!aberto) return;
    const onDown=(e)=>{ if(caixaRef.current && !caixaRef.current.contains(e.target) && window.innerWidth>=1024) fechar(); };
    document.addEventListener("mousedown",onDown);
    return ()=>document.removeEventListener("mousedown",onDown);
  },[aberto]);

  // no celular a busca cobre a tela: a página de trás não rola
  useEffect(()=>{
    if(!aberto || window.innerWidth>=1024) return;
    const o=document.body.style.overflow; document.body.style.overflow="hidden";
    return ()=>{ document.body.style.overflow=o; };
  },[aberto]);

  function escolher(t){ fechar(); onOpen(t); }

  // no celular a busca aberta é desenhada direto na raiz do app: dentro do cabeçalho (que tem desfoque de
  // fundo) um elemento "fixo" fica preso ao cabeçalho em vez de cobrir a tela
  const [celular,setCelular]=useState(()=>typeof window!=="undefined" && window.innerWidth<1024);
  useEffect(()=>{ const f=()=>setCelular(window.innerWidth<1024); window.addEventListener("resize",f); return ()=>window.removeEventListener("resize",f); },[]);
  const raiz = celular && aberto && caixaRef.current ? caixaRef.current.closest(".rz") : null;
  // foco no campo depois que ele está na tela (no celular ele muda de lugar ao abrir)
  useEffect(()=>{ if(aberto && inputRef.current && document.activeElement!==inputRef.current) inputRef.current.focus(); },[aberto, raiz]);

  const painel=(
      <div className={"gspanel"+(raiz?" gsfull":"")} role="search">
        <div className="gsfield">
          <Icon name="buscar" size={17}/>
          <input ref={inputRef} type="search" inputMode="search" enterKeyHint="search" placeholder="Buscar descrição, categoria, conta ou valor…"
            aria-label="Buscar movimentos" value={q} onChange={e=>setQ(e.target.value)} onFocus={()=>setAberto(true)}
            onKeyDown={e=>{ if(e.key==="Enter" && itens[0]) escolher(itens[0]); }}/>
          <button className="gsclose" aria-label="Fechar busca" onClick={fechar}><Icon name="fechar" size={18}/></button>
        </div>
        {aberto && q.trim().length>=2 &&
          <div className="gsresults" role="listbox" aria-label="Resultados da busca">
            <div className="gscount">{total===0 ? "Nenhum movimento encontrado" : total>itens.length ? `${total} resultados · mostrando os ${itens.length} mais recentes` : `${total} resultado${total===1?"":"s"}`}</div>
            {itens.map(t=>{
              const tipo=TYPES[t.type]||TYPES.gasto;
              return (
                <button key={t.id} role="option" aria-selected="false" className="gsrow" onClick={()=>escolher(t)}>
                  <span className={"gsic "+tipo.cls}><Icon name={t.type==="transferencia"?"transferencia":(CAT_ICON[t.category]||"outros")} size={16}/></span>
                  <span className="gsinfo">
                    <b>{t.description||t.category||tipo.label}</b>
                    <small>{[t.type==="transferencia"?"Transferência":t.category, nomeConta(t.acctId), fmtDateBR(t.date)].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className={"gsval num "+tipo.cls}>{tipo.sign<0?"−":tipo.sign>0?"+":""}{brl(t.cents)}</span>
                </button>
              );
            })}
          </div>}
        {aberto && q.trim().length<2 &&
          <div className="gsresults gshint">Digite pelo menos 2 letras. Dá para buscar por valor também (ex.: 85,50).</div>}
      </div>
  );

  return (
    <div className={"gsearch"+(aberto?" open":"")} ref={caixaRef}>
      <button className="iconbtn gsbtn" aria-label="Buscar movimentos" onClick={abrir}><Icon name="buscar" size={18}/></button>
      {raiz ? createPortal(painel, raiz) : painel}
    </div>
  );
}

export { GlobalSearch };
