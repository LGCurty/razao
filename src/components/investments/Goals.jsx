/* components/investments/Goals.jsx — Investimentos › Metas. */
import React, { useMemo, useState } from "react";
import { askConfirm, toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Money } from "../common/Input";
import { HelpIcon } from "../help/HelpIcon";
import { CATS } from "../../domain/categories";
import { isRealized } from "../../domain/types";
import { brl } from "../../utils/formatters";
import { uid } from "../../utils/ids";

/* ---------- METAS ---------- */
function Metas({ goals, update, txs }){
  const [form,setForm]=useState(null);
  const [contribId,setContribId]=useState(null);
  const [contrib,setContrib]=useState(0);
  const blank={name:"",target:0,saved:0,deadline:"",linkedCategory:null};
  // categorias que fazem sentido ligar a uma meta (poupança/investimento) — gasto fica de fora
  const linkedCategoryOptions=useMemo(()=>[...CATS.investimento,...CATS.ganho].map(c=>c[0]).filter((v,i,a)=>a.indexOf(v)===i),[]);
  // meta ligada a uma categoria real: o progresso soma automaticamente todo lançamento realizado daquela
  // categoria, além do valor guardado manualmente — não precisa "avisar" a meta toda vez que investe
  const goalAutoSaved=(g)=>{
    if(!g.linkedCategory) return 0;
    return txs.filter(t=>isRealized(t)&&t.category===g.linkedCategory&&t.type!=="gasto").reduce((s,t)=>s+t.cents,0);
  };
  const save=()=>{if(!form.name.trim()||form.target<=0)return;update(d=>({goals: form.id?d.goals.map(x=>x.id===form.id?form:x):[...d.goals,{...form,id:uid()}]}));setForm(null);toast("Meta salva.","success");};
  const remove=(g)=>askConfirm({title:"Excluir meta?",message:`"${g.name}" será removida.`,onConfirm:()=>{update(d=>({goals:d.goals.filter(x=>x.id!==g.id)}));toast("Meta excluída.","success");}});
  const addContrib=(g)=>{update(d=>({goals:d.goals.map(x=>x.id===g.id?{...x,saved:x.saved+contrib}:x)}));setContribId(null);setContrib(0);toast("Valor guardado.","success");};
  const monthsLeft=(dl)=>{if(!dl)return null;const d=new Date(dl),n=new Date();return Math.max(0,(d.getFullYear()-n.getFullYear())*12+d.getMonth()-n.getMonth());};
  return (
    <div className="card">
      <h3>Metas e planos <span style={{display:"flex",alignItems:"center",gap:6}}><button className="sbtn" onClick={()=>setForm(blank)}><Icon name="adicionar" size={14}/> Nova</button><HelpIcon section="metas-ajuda"/></span></h3>
      <div className="sub">Pague seus sonhos primeiro: defina valor, prazo e acompanhe o progresso.</div>
      {form &&
        <div className="miniform">
          <input className="fld" placeholder="Nome (ex: Viagem, Reserva)" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={{marginBottom:10}}/>
          <div style={{margin:"10px 0"}}><div className="sub" style={{marginBottom:4}}>Valor total</div><Money cents={form.target} onChange={v=>setForm({...form,target:v})} small/></div>
          <div style={{margin:"10px 0"}}><div className="sub" style={{marginBottom:4}}>Já guardado (manual)</div><Money cents={form.saved} onChange={v=>setForm({...form,saved:v})} small/></div>
          <div className="sub" style={{marginBottom:4}}>Prazo</div>
          <input className="fld" type="date" value={form.deadline} onChange={e=>setForm({...form,deadline:e.target.value})} style={{marginBottom:10}}/>
          <div className="sub" style={{marginBottom:4}}>Ligar a uma categoria (opcional)</div>
          <select className="fld" value={form.linkedCategory||""} onChange={e=>setForm({...form,linkedCategory:e.target.value||null})}>
            <option value="">Nenhuma — só o valor guardado manualmente</option>
            {linkedCategoryOptions.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <div className="hint">Ligando a uma categoria, todo lançamento real dessa categoria soma automaticamente no progresso da meta.</div>
          <div style={{display:"flex",gap:8,marginTop:12}}><button className="sbtn primary" onClick={save}>Salvar meta</button><button className="sbtn" onClick={()=>setForm(null)}>Cancelar</button></div>
        </div>}
      {goals.length===0 && !form && <p className="hint">Nenhuma meta ainda. Crie sua primeira, como uma reserva de emergência.</p>}
      {goals.map(g=>{
        const autoSaved=goalAutoSaved(g);
        const totalSaved=g.saved+autoSaved;
        const pct=g.target>0?Math.min(100,totalSaved/g.target*100):0;
        const ml=monthsLeft(g.deadline);
        const need=ml&&ml>0?Math.max(0,Math.ceil((g.target-totalSaved)/ml)):null;
        return (
          <div className="goal" key={g.id}>
            <div className="gh">
              <div>
                <div className="gname"><Icon name="metas" size={16}/> {g.name}</div>
                <div className="gsub">{pct.toFixed(0)}% concluído{g.deadline && <> · prazo {new Date(g.deadline+"T00:00:00").toLocaleDateString("pt-BR",{month:"short",year:"numeric"})}</>}{need!=null && <> · guardar {brl(need)}/mês</>}</div>
              </div>
              <div style={{display:"flex",gap:2}}>
                <button className="sbtn iconsbtn" aria-label="Editar" onClick={()=>setForm(g)}><Icon name="editar" size={15}/></button>
                <button className="sbtn iconsbtn" aria-label="Excluir" onClick={()=>remove(g)}><Icon name="excluir" size={15}/></button>
              </div>
            </div>
            <div className="bar"><i style={{width:pct+"%",background:pct>=100?"var(--pos)":"var(--inv)"}}/></div>
            <div className="gv"><span className="num">{brl(totalSaved)}</span><span className="num" style={{color:"var(--text-mut)"}}>{brl(g.target)}</span></div>
            {g.linkedCategory && <div className="mm">Ligada à categoria "{g.linkedCategory}" · {brl(autoSaved)} de lançamentos reais + {brl(g.saved)} guardados manualmente</div>}
            {contribId===g.id
              ? <div style={{marginTop:12}}><Money cents={contrib} onChange={setContrib} small onEnter={()=>addContrib(g)} autoFocus/><div style={{display:"flex",gap:8,marginTop:8}}><button className="sbtn primary" onClick={()=>addContrib(g)}>Guardar</button><button className="sbtn" onClick={()=>setContribId(null)}>Cancelar</button></div></div>
              : <div className="gacts"><button className="sbtn" onClick={()=>{setContribId(g.id);setContrib(0);}}><Icon name="adicionar" size={13}/> Guardar dinheiro</button></div>}
          </div>);
      })}
    </div>
  );
}
Metas = React.memo(Metas);

export { Metas };
