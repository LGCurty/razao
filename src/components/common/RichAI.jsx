/* components/common/RichAI.jsx — exibição do texto gerado pela IA. */
import React from "react";

/* ---------- BALANÇO ---------- */
/* =======================================================================
   BRIEFING PARA A IA — o resumo do mês só fica bom se a IA receber mais do
   que quatro totais. Esta função monta o dossiê completo do mês (comparação
   com o mês anterior e com a média recente, categorias com variação, maiores
   gastos, cartões, orçamentos, recorrentes, previstos ainda não pagos) para
   que o texto gerado possa citar fato, número e causa em vez de generalidade.
   ======================================================================= */
/* formatação leve do texto que a IA devolve: "## título", "- item" e **negrito**. Não é markdown
   completo — é só o suficiente para o resumo elaborado ficar legível em vez de virar um bloco só. */
function aiInline(text, kp){
  return String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part,i)=>
    part.startsWith("**")&&part.endsWith("**")
      ? <b key={kp+i}>{part.slice(2,-2)}</b>
      : <React.Fragment key={kp+i}>{part}</React.Fragment>);
}
function RichAI({ text }){
  const blocks=[];
  String(text||"").split("\n").forEach(raw=>{
    const line=raw.trim();
    if(!line) return;
    if(/^#{1,4}\s/.test(line)) blocks.push({k:"h",t:line.replace(/^#{1,4}\s*/,"").replace(/\*\*/g,"")});
    else if(/^[-*•]\s+/.test(line)) blocks.push({k:"li",t:line.replace(/^[-*•]\s+/,"")});
    else if(/^\d+[.)]\s+/.test(line)) blocks.push({k:"li",t:line.replace(/^\d+[.)]\s*/,"")});
    else blocks.push({k:"p",t:line});
  });
  const out=[]; let bucket=null;
  blocks.forEach(b=>{
    if(b.k==="li"){ if(!bucket){ bucket=[]; out.push({k:"ul",items:bucket}); } bucket.push(b.t); }
    else { bucket=null; out.push(b); }
  });
  return (
    <div className="airich">
      {out.map((b,i)=>
        b.k==="h" ? <h4 key={i}>{b.t}</h4>
        : b.k==="ul" ? <ul key={i}>{b.items.map((t,j)=><li key={j}>{aiInline(t,i+"-"+j+"-")}</li>)}</ul>
        : <p key={i}>{aiInline(b.t,i+"-")}</p>)}
    </div>
  );
}

export { aiInline, RichAI };
