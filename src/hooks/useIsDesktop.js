/* hooks/useIsDesktop.js — hook de breakpoint (computador × celular). */
import React, { useEffect, useState } from "react";

/* hook simples de breakpoint: só usado onde o comportamento (não só o visual) muda entre mobile e desktop */
function useIsDesktop(){
  const [d,setD]=useState(()=> typeof window!=="undefined" && window.matchMedia("(min-width:1024px)").matches);
  useEffect(()=>{
    const mq=window.matchMedia("(min-width:1024px)");
    const fn=()=>setD(mq.matches);
    mq.addEventListener("change",fn);
    return ()=>mq.removeEventListener("change",fn);
  },[]);
  return d;
}

export { useIsDesktop };
