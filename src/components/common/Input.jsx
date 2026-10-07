/* components/common/Input.jsx — campo de valor em reais (digitando só números). */
import React from "react";
import { brlNum } from "../../utils/formatters";

/* money input */
function Money({ cents, onChange, placeholder="0,00", small, onEnter, onFocus, autoFocus }){
  return (
    <div className={"amount"+(small?" small":"")}>
      <span className="cur">R$</span>
      <input inputMode="decimal" placeholder={placeholder} autoFocus={autoFocus}
        value={cents===0?"":brlNum(cents)}
        onChange={(e)=>onChange(parseInt(e.target.value.replace(/\D/g,"")||"0",10))}
        onKeyDown={(e)=>{ if(e.key==="Enter"&&onEnter) onEnter(); }}
        onFocus={onFocus} />
    </div>
  );
}

export { Money };
