/* components/common/Modal.jsx — Sheet: modal centralizado no computador e folha deslizante no celular. */
import React, { useEffect, useRef } from "react";
import { Icon } from "./Icon";

/* ---- bottom sheet / modal genérico: forms, menus e diálogo de confirmação ---- */
function Sheet({ open, onClose, title, children, returnFocusRef }){
  const ref=useRef(null);
  useEffect(()=>{
    if(!open) return;
    const prevOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const onKey=(e)=>{ if(e.key==="Escape") onClose(); };
    document.addEventListener("keydown",onKey);
    const t=setTimeout(()=>{ ref.current?.querySelector("input,button,select,textarea")?.focus(); },50);
    return ()=>{
      document.body.style.overflow=prevOverflow;
      document.removeEventListener("keydown",onKey);
      clearTimeout(t);
      if(returnFocusRef && returnFocusRef.current) returnFocusRef.current.focus();
    };
  },[open]);
  if(!open) return null;
  return (
    <div className="sheetbackdrop" onClick={onClose}>
      <div className="sheet" ref={ref} role="dialog" aria-modal="true" aria-label={title||"Diálogo"} onClick={e=>e.stopPropagation()}>
        <div className="sheethandle"/>
        {title &&
          <div className="sheettitle">
            {title}
            <button className="sheetclose" aria-label="Fechar" onClick={onClose}><Icon name="fechar" size={16}/></button>
          </div>}
        <div className="sheetbody">{children}</div>
      </div>
    </div>
  );
}

export { Sheet };
