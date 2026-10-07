/* components/common/StatusDot.jsx — indicador de status do orçamento (OK, atenção, limite atingido). */
import React from "react";

function StatusDot({ status }){
  const cor = status==="over"?"var(--neg)":status==="warn"?"var(--warn)":status==="ok"?"var(--pos)":"var(--text-mut)";
  const rotulo = status==="over"?"Limite atingido":status==="warn"?"Atenção":status==="ok"?"OK":"Sem limite";
  return <span className="statusdot" title={rotulo}><i style={{background:cor}}/><span>{rotulo}</span></span>;
}

export { StatusDot };
