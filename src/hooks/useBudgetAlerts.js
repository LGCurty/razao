/* hooks/useBudgetAlerts.js — hook dos alertas de orçamento (80% e 100%, uma vez por nível em cada mês). */
import React, { useEffect } from "react";
import { toast } from "../components/common/Feedback";
import { ALERTAS_KEY, notificarAparelho } from "../services/notificationService";
import { brl } from "../utils/formatters";

function useBudgetAlerts({ rows, mk, ativo, notificar }){
  useEffect(()=>{
    if(!ativo) return;
    let marcados={};
    try{ marcados=JSON.parse(localStorage.getItem(ALERTAS_KEY)||"{}")||{}; }catch(_){ marcados={}; }
    const doMes={...(marcados[mk]||{})};
    const novos=[];
    rows.forEach(r=>{
      if(!(r.limit>0)) return;
      const nivel=r.pct>=1?100:r.pct>=0.8?80:0;
      if(nivel && (doMes[r.cat]||0)<nivel){ novos.push({ r, nivel }); doMes[r.cat]=nivel; }
    });
    if(!novos.length) return;
    try{ localStorage.setItem(ALERTAS_KEY, JSON.stringify({ [mk]:doMes })); }catch(_){}
    novos.forEach(({ r, nivel })=>{
      const titulo = nivel>=100 ? `Orçamento de ${r.cat} estourado` : `${r.cat}: ${Math.round(r.pct*100)}% do orçamento`;
      const corpo = `${brl(r.spent)} de ${brl(r.limit)} este mês.`;
      toast(`${titulo} — ${corpo}`, nivel>=100?"error":"default");
      if(notificar) notificarAparelho(titulo, corpo, "orcamento-"+r.cat);
    });
  },[rows, mk, ativo, notificar]);
}

export { useBudgetAlerts };
