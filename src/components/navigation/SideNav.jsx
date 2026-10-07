/* components/navigation/SideNav.jsx — menu lateral em grupos (inspirado no OTAMERICA Sentinel).
   No celular é um painel que abre pelo botão ☰ do topo (com fundo escurecido, fecha com Esc, toque fora ou
   ao escolher um item); no computador fica fixo à esquerda. Mesmo conteúdo nos dois. */
import React, { useEffect, useRef } from "react";
import { Icon } from "../common/Icon";
import { Logo } from "../common/Logo";
import { NAV_GROUPS } from "./sections";

function SideNav({ tab, budgetFiltro, counts, onGo, onAction, session, theme, version, modo, aberto, onClose }){
  const painelRef=useRef(null);
  const drawer = modo==="drawer";

  // painel do celular: foco entra no painel ao abrir, Esc fecha, e a página de trás não rola
  useEffect(()=>{
    if(!drawer || !aberto) return;
    const anterior=document.activeElement;
    const primeiro=painelRef.current && painelRef.current.querySelector("button.navitem.on, button.navitem");
    if(primeiro) primeiro.focus();
    const onKey=(e)=>{ if(e.key==="Escape") onClose(); };
    document.addEventListener("keydown",onKey);
    const overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return ()=>{
      document.removeEventListener("keydown",onKey);
      document.body.style.overflow=overflow;
      if(anterior && anterior.focus) anterior.focus();
    };
  },[drawer, aberto]);

  const ativo=(it)=> it.view===tab && (it.view!=="orcamento" || (it.filtro||null)===(budgetFiltro||null));
  function escolher(it){
    if(it.action) onAction(it.action);
    else onGo(it.view, it.filtro);
    if(drawer) onClose();
  }

  const conteudo=(
    <nav ref={painelRef} className={"sidenav"+(drawer?" drawer":"")} aria-label="Menu principal"
      {...(drawer?{role:"dialog","aria-modal":"true"}:{})}>
      <div className="snhead">
        <Logo variant="horizontal" theme={theme} height={58}/>
        {drawer && <button className="sbtn iconsbtn snclose" aria-label="Fechar menu" onClick={onClose}><Icon name="fechar" size={18}/></button>}
      </div>
      <div className="snscroll">
        {NAV_GROUPS.map(g=>(
          <div className="sngroup" key={g.label}>
            <div className="snlabel">{g.label}</div>
            {g.items.map(it=>{
              const on=ativo(it);
              const n = it.count ? counts[it.count] : undefined;
              // contador de alerta (tone "over") só aparece quando há algo a resolver
              const mostrar = n!==undefined && (it.tone!=="over" || n>0 || it.filtro);
              return (
                <button key={it.label} className={"navitem"+(on?" on":"")} aria-current={on?"page":undefined} onClick={()=>escolher(it)}>
                  <Icon name={it.icon} size={18}/>
                  <span className="snitem">{it.label}</span>
                  {mostrar && <span className={"snbadge"+(it.tone?" "+it.tone:"")+(n===0?" zero":"")}>{n}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="snfoot">
        <span className="navavatar">{session?String(session.user.email||"?")[0].toUpperCase():<Icon name="contas" size={14}/>}</span>
        <span className="snwho">
          <b>{session?String(session.user.email||"").split("@")[0]:"Modo local"}</b>
          <small>{session?"Conta conectada":"Somente neste aparelho"} · versão {version}</small>
        </span>
      </div>
    </nav>
  );

  if(!drawer) return conteudo;
  return (
    <div className={"snoverlay"+(aberto?" open":"")} aria-hidden={!aberto} onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose(); }}>
      {aberto && conteudo}
    </div>
  );
}

export { SideNav };
