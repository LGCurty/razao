/* utils/dates.js — datas em formato ISO (AAAA-MM-DD), mês de referência, semanas e soma de meses. */
const todayISO = ()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
const monthKey = (d)=>d.slice(0,7);
// segunda-feira da semana que contém essa data ISO — usada como chave de "semana" pro recap automático
// (não é o número de semana ISO-8601 oficial, só um agrupamento estável de 7 em 7 dias, mais simples de calcular)
const weekStartISO = (iso)=>{ const d=new Date(iso+"T00:00:00"); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
// soma n meses a uma data ISO, ajustando o dia se o mês de destino for mais curto (ex: 31/01 + 1 mês = 28 ou 29/02)
const addMonthsISO = (iso, n)=>{
  const [y,m,d] = iso.split("-").map(Number);
  const first = new Date(y, m-1+n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth()+1, 0).getDate();
  const dt = new Date(first.getFullYear(), first.getMonth(), Math.min(d, lastDay));
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
};
const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const monthsFromToday=(dateIso)=>{ const d=new Date(dateIso+"T00:00:00"),n=new Date(); return Math.max(0,(d.getFullYear()-n.getFullYear())*12+(d.getMonth()-n.getMonth())); };
const daysApart = (a,b)=>Math.abs((new Date(a+"T00:00:00")-new Date(b+"T00:00:00"))/86400000);

export { todayISO, monthKey, weekStartISO, addMonthsISO, MONTH_NAMES, monthsFromToday, daysApart };
