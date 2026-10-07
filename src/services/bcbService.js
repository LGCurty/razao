/* services/bcbService.js — indicadores do Banco Central (Selic, CDI, IPCA) com cache diário. */
import { todayISO } from "../utils/dates";

/* ---- indicadores do Banco Central (Selic, CDI, IPCA) via API pública do SGS, com cache diário em
   localStorage (dado de mercado, não é dado do usuário — não precisa ir pro backup/Supabase). Uma falha de
   rede aqui não deve incomodar ninguém: o card some silenciosamente em vez de mostrar erro. ---- */
const BCB_CACHE_KEY="razao_bcb_cache";
async function fetchBcbSeries(code, n){
  const res=await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${n}?formato=json`);
  if(!res.ok) throw new Error("BCB indisponível");
  return res.json();
}
async function fetchBcbIndicators(){
  const today=todayISO();
  let cached=null;
  try{ cached=JSON.parse(localStorage.getItem(BCB_CACHE_KEY)||"null"); }catch(_){}
  if(cached && cached.date===today) return cached.data;
  const [selic,cdi,ipca]=await Promise.all([fetchBcbSeries(432,1),fetchBcbSeries(12,1),fetchBcbSeries(433,12)]);
  const num=(v)=>parseFloat(String(v).replace(",","."));
  const data={
    selic: selic[0] ? num(selic[0].valor) : null,
    cdi: cdi[0] ? num(cdi[0].valor) : null,
    ipca12m: ipca.length ? ipca.reduce((s,x)=>s+num(x.valor),0) : null,
  };
  localStorage.setItem(BCB_CACHE_KEY, JSON.stringify({date:today,data}));
  return data;
}

export { BCB_CACHE_KEY, fetchBcbSeries, fetchBcbIndicators };
