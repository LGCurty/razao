/* components/help/HelpIcon.jsx — ícone de ajuda contextual que abre o manual na seção certa. */
import React from "react";
import { Icon } from "../common/Icon";
import { openHelp } from "../navigation/navEvents";

/* ícone discreto de ajuda contextual, usado no cabeçalho dos cartões principais — abre o manual
   direto na seção correspondente, via o mesmo pub-sub de openHelp() */
function HelpIcon({ section }){
  return <button type="button" className="helpicon" aria-label="Ajuda sobre esta seção" onClick={()=>openHelp(section)}><Icon name="ajuda" size={13}/></button>;
}

export { HelpIcon };
