/* utils/formatters.js — formatação para exibição: moeda (R$), horas de trabalho, datas, tempo relativo, tamanho de arquivo e #tags. */
/* ---- helpers ---- */
const brl = (c)=>(c/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const brlNum = (c)=>(c/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
// preço em horas de trabalho (opcional, configurável em "Mais"): converte um valor pro tempo de trabalho
// que ele equivale, dado o valor da hora configurado. hourlyWageCents=0 (padrão) desliga o recurso inteiro.
const formatHours = (cents, hourlyWageCents)=>{ if(!hourlyWageCents) return null; const h=cents/hourlyWageCents; return h<10 ? h.toFixed(1).replace(".",",")+"h" : Math.round(h)+"h"; };
const abbrevBRL = (cents)=>{
  const v=Math.abs(cents/100);
  if(v>=1000000) return (cents<0?"-":"")+(v/1000000).toLocaleString("pt-BR",{maximumFractionDigits:1})+" mi";
  if(v>=1000) return (cents<0?"-":"")+(v/1000).toLocaleString("pt-BR",{maximumFractionDigits:1})+" mil";
  return (cents<0?"-":"")+v.toLocaleString("pt-BR",{maximumFractionDigits:0});
};
// tags de primeira classe: extraídas da descrição (#tag), únicas e em minúsculas — usada por chips na
// linha, filtro (Fase 4), visão "gasto por tag" e autocompletar no formulário
const extractTags = (description)=>{ const m=(description||"").match(/#(\w+)/g); return m ? [...new Set(m.map(s=>s.slice(1).toLowerCase()))] : []; };
const fmtDateBR = (iso)=>new Date(iso+"T00:00:00").toLocaleDateString("pt-BR");
// "julho de 2026" → "Julho de 2026". O CSS text-transform:capitalize maiusculiza TODA palavra e
// devolvia "Julho De 2026"/"Jun. De 26", que em português está errado — só a primeira letra sobe.
const capFirst = (t)=>{ const s=String(t||""); return s.charAt(0).toUpperCase()+s.slice(1); };
// rótulo curto de mês para gráficos: "jun. de 26" → "jun 26"
const shortMonthLabel = (d)=>d.toLocaleDateString("pt-BR",{month:"short",year:"2-digit"}).replace(/\./g,"").replace(" de ", " ");
/* ================================================================================
   HOME — o que importa de relance: saldo total, o mês em números, o orçamento mais apertado e os
   últimos movimentos. O Panorama completo (patrimônio, evolução, indicadores…) continua logo abaixo.
   ================================================================================ */
// "há 3 min", "há 2 h", "há 4 dias" — para dizer quando foi a última sincronização
function tempoDesde(iso){
  if(!iso) return "";
  const s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);
  if(s<60) return "agora";
  if(s<3600) return `há ${Math.round(s/60)} min`;
  if(s<86400) return `há ${Math.round(s/3600)} h`;
  const d=Math.round(s/86400);
  return `há ${d} dia${d===1?"":"s"}`;
}
const fmtBytes = (b)=>{ if(!b) return ""; if(b<1024) return b+" B"; if(b<1024*1024) return (b/1024).toFixed(0)+" KB"; return (b/1024/1024).toFixed(1)+" MB"; };

export { brl, brlNum, formatHours, abbrevBRL, extractTags, fmtDateBR, capFirst, shortMonthLabel, tempoDesde, fmtBytes };
