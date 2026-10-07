/* components/assistant/Assistant.jsx — Home › Assistente: perguntas em linguagem natural sobre os lançamentos. */
import React, { useState } from "react";
import { Icon } from "../common/Icon";
import { HelpIcon } from "../help/HelpIcon";
import { TYPES } from "../../domain/types";
import { callGemini } from "../../services/geminiService";

/* ---------- ASSISTENTE (perguntas em linguagem natural sobre os dados do usuário) ---------- */
const ASSISTANT_TX_CAP=3000;
function Perguntar({ txs, accounts }){
  const [question,setQuestion]=useState("");
  const [history,setHistory]=useState([]);
  const [busy,setBusy]=useState(false);

  async function ask(){
    const q=question.trim();
    if(!q||busy) return;
    setBusy(true);
    setQuestion("");
    const entry={ q, a:"", error:"" };
    setHistory(h=>[...h,entry]);
    try{
      const acctNames=Object.fromEntries(accounts.map(a=>[a.id,a.name]));
      const capped=txs.length>ASSISTANT_TX_CAP;
      const sample=capped?txs.slice(0,ASSISTANT_TX_CAP):txs;
      const lines=sample.map(t=>`${t.date};${TYPES[t.type].label};${t.category};${acctNames[t.acctId]||"?"};${(t.cents/100).toFixed(2)};${t.description||""}`).join("\n");
      const prompt=`Você é um assistente financeiro. Abaixo está o histórico de lançamentos do usuário, um por linha, no formato "data;tipo;categoria;conta;valor;descrição" (valor em reais)${capped?` — mostrando os ${ASSISTANT_TX_CAP} lançamentos mais recentes de um histórico maior`:""}:

${lines||"(nenhum lançamento registrado ainda)"}

Pergunta do usuário: "${q}"

Responda de forma direta e curta, em português do Brasil, baseando-se SOMENTE nos dados acima. Se não houver dados suficientes para responder com confiança, diga isso claramente em vez de inventar um número.`;
      const text=await callGemini({ prompt });
      setHistory(h=>h.map(item=>item===entry?{...item,a:text.trim()}:item));
    }catch(err){
      setHistory(h=>h.map(item=>item===entry?{...item,error:err.message||"Não foi possível obter uma resposta."}:item));
    }finally{
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Assistente <HelpIcon section="assistente-ajuda"/></h3>
      <div className="sub">Pergunte qualquer coisa sobre seus lançamentos, em linguagem natural.</div>
      {history.length===0 &&
        <p className="hint">Exemplos: "quanto gastei com Uber esse ano?", "qual foi meu maior gasto em julho?", "quanto recebi de proventos em 2026?"</p>}
      {history.length>0 &&
        <div style={{display:"flex",flexDirection:"column",gap:16,marginBottom:16}}>
          {history.map((item,i)=>(
            <div key={i}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Você perguntou: {item.q}</div>
              {item.error
                ? <div style={{fontSize:13,color:"var(--neg)"}}>{item.error}</div>
                : item.a
                  ? <div style={{fontSize:14,lineHeight:1.6}}>{item.a}</div>
                  : <div style={{fontSize:13,color:"var(--text-mut)"}}>Pensando…</div>}
            </div>
          ))}
        </div>}
      <div className="row2">
        <input className="fld" placeholder="Pergunte algo sobre suas finanças…" value={question}
          onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")ask();}} disabled={busy}/>
      </div>
      <button className="submit" onClick={ask} disabled={busy||!question.trim()}><Icon name="brilho" size={15}/> {busy?"Perguntando…":"Perguntar"}</button>
    </div>
  );
}
Perguntar = React.memo(Perguntar);

export { ASSISTANT_TX_CAP, Perguntar };
