/* components/accounts/Accounts.jsx — Configurações › Contas e bancos: contas, cartões, status da sincronização e parcelamentos. */
import React, { useEffect, useMemo, useState } from "react";
import { ProgressBar } from "../common/Charts";
import { askConfirm, toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Money } from "../common/Input";
import { Sheet } from "../common/Modal";
import { HelpIcon } from "../help/HelpIcon";
import { parseExtratoText } from "../movements/ImportStatement";
import { BANKS, bancoDoNome } from "../../domain/banks";
import { isRealized } from "../../domain/types";
import { fetchBcbIndicators } from "../../services/bcbService";
import { cardInvoiceNet, isInstallmentSeries, txEffectiveMonth } from "../../utils/calculations";
import { monthsFromToday, todayISO } from "../../utils/dates";
import { brl, fmtDateBR } from "../../utils/formatters";
import { uid } from "../../utils/ids";

/* custo real do parcelamento vs. CDI: parcelamento "sem juros" no Brasil não cobra nada a mais no nominal,
   mas segurar o dinheiro por mais tempo (em vez de pagar à vista) tem valor — se investido ao CDI nesse
   meio tempo, esse valor futuro vale menos em termos de hoje. A diferença entre o nominal das parcelas que
   faltam e o valor presente (descontado ao CDI) é a economia real de ter parcelado em vez de pago à vista. */
function Parcelamentos({ txs }){
  const [cdiAnnual,setCdiAnnual]=useState(null);
  useEffect(()=>{
    fetchBcbIndicators().then(d=>{
      // CDI vem como taxa diária (código 12 do SGS) — anualiza por 252 dias úteis, convenção padrão no Brasil.
      // Sem CDI disponível, usa a Selic meta (já anual) como aproximação (historicamente muito próximas).
      if(d.cdi!=null) setCdiAnnual((Math.pow(1+d.cdi/100,252)-1)*100);
      else if(d.selic!=null) setCdiAnnual(d.selic);
    }).catch(()=>{});
  },[]);
  const series=useMemo(()=>{
    const groups={};
    txs.forEach(t=>{ if(isInstallmentSeries(t)) (groups[t.seriesId]=groups[t.seriesId]||[]).push(t); });
    return Object.values(groups).map(items=>{
      const sorted=[...items].sort((a,b)=>a.seriesIndex-b.seriesIndex);
      const remaining=sorted.filter(t=>!isRealized(t));
      if(remaining.length===0) return null;
      return { seriesId:sorted[0].seriesId, baseDesc:(sorted[0].description||"").replace(/\s*\(\d+\/\d+\)$/,"")||sorted[0].category, total:sorted.length, paidCount:sorted.length-remaining.length, remaining };
    }).filter(Boolean);
  },[txs]);
  if(series.length===0) return null;
  const monthlyRate = cdiAnnual!=null ? Math.pow(1+cdiAnnual/100,1/12)-1 : null;
  return (
    <div className="card g-12">
      <h3>Parcelamentos ativos</h3>
      <div className="sub" style={{marginBottom:0}}>{monthlyRate!=null?"Economia real de ter parcelado em vez de pago à vista, descontando as parcelas futuras pela CDI/Selic vigente.":"Parcelas que ainda faltam pagar."}</div>
      {series.map(s=>{
        const nominal=s.remaining.reduce((sum,t)=>sum+t.cents,0);
        const presentValue = monthlyRate!=null ? s.remaining.reduce((sum,t)=>sum+t.cents/Math.pow(1+monthlyRate,monthsFromToday(t.date)+1),0) : null;
        const economia = presentValue!=null ? Math.round(nominal-presentValue) : null;
        return (
          <div className="kv" key={s.seriesId} style={{alignItems:"flex-start"}}>
            <span className="kk">{s.baseDesc} <span style={{color:"var(--text-mut)"}}>· {s.paidCount}/{s.total} pagas</span></span>
            <span className="vv" style={{textAlign:"right"}}>
              {brl(nominal)} restantes
              {economia!=null && <div className="mm" style={{marginTop:2}}>economia real ≈ {brl(economia)}</div>}
            </span>
          </div>);
      })}
    </div>
  );
}
Parcelamentos = React.memo(Parcelamentos);

function Contas({ accounts, update, monthTx, txs }){
  const [form,setForm]=useState(null);
  const [deleteFlow,setDeleteFlow]=useState(null); // {account, linkedCount}
  const [reassignTo,setReassignTo]=useState("");
  // auditoria de fatura: cola o texto da fatura do banco/cartão e compara com o que já está registrado
  // no app pra aquele cartão naquele mês — "bateu" / "na fatura mas não registrado" / "registrado mas não na fatura"
  const [auditAccount,setAuditAccount]=useState(null);
  const [auditMonth,setAuditMonth]=useState(todayISO().slice(0,7));
  const [auditText,setAuditText]=useState("");
  const [auditResult,setAuditResult]=useState(null);
  function openAudit(a){ setAuditAccount(a); setAuditMonth(todayISO().slice(0,7)); setAuditText(""); setAuditResult(null); }
  function runAudit(){
    const parsed=parseExtratoText(auditText).filter(it=>it.type==="gasto");
    const registered=txs.filter(t=>t.type==="gasto"&&t.acctId===auditAccount.id&&txEffectiveMonth(t,accounts)===auditMonth);
    const usedRegIds=new Set(), usedParsedIds=new Set();
    parsed.forEach(p=>{
      const match=registered.find(t=>!usedRegIds.has(t.id)&&t.date===p.date&&t.cents===p.cents);
      if(match){ usedRegIds.add(match.id); usedParsedIds.add(p.id); }
    });
    setAuditResult({
      bateu: parsed.filter(p=>usedParsedIds.has(p.id)),
      naFaturaNaoRegistrado: parsed.filter(p=>!usedParsedIds.has(p.id)),
      registradoNaoNaFatura: registered.filter(t=>!usedRegIds.has(t.id)),
    });
  }
  const blank={name:"",kind:"conta",bank:"",color:"#3B63C4",closingDay:"",dueDay:"",limit:0,openingBalance:0,openingDate:todayISO()};
  const COLORS=["#3B63C4","#E05A2B","#12805F","#C2382F","#B87C10","#A57BE0","#46B7C7","#8C93A8"];
  const save=()=>{if(!form.name.trim())return;update(d=>({accounts: form.id?d.accounts.map(x=>x.id===form.id?form:x):[...d.accounts,{...form,id:uid()}]}));setForm(null);toast("Conta salva.","success");};
  const remove=(a)=>{
    if(accounts.length<=1) return toast("Mantenha ao menos uma conta.","error");
    const linkedCount=txs.filter(t=>t.acctId===a.id||t.toAcctId===a.id).length;
    if(linkedCount===0){
      askConfirm({title:`Excluir ${a.name}?`,message:"Esta conta não tem lançamentos associados.",onConfirm:()=>{update(d=>({accounts:d.accounts.filter(x=>x.id!==a.id)}));toast("Conta excluída.","success");}});
      return;
    }
    const other=accounts.find(x=>x.id!==a.id);
    setReassignTo(other?other.id:"");
    setDeleteFlow({ account:a, linkedCount });
  };
  function confirmRemoveWithReassign(){
    if(!deleteFlow||!reassignTo) return;
    const { account, linkedCount } = deleteFlow;
    update(d=>({
      accounts: d.accounts.filter(x=>x.id!==account.id),
      transactions: d.transactions.map(t=>(
        t.acctId===account.id||t.toAcctId===account.id
          ? { ...t, acctId: t.acctId===account.id?reassignTo:t.acctId, toAcctId: t.toAcctId===account.id?reassignTo:t.toAcctId }
          : t
      )),
    }));
    toast(`Conta excluída. ${linkedCount} lançamento(s) movido(s) para outra conta.`,"success");
    setDeleteFlow(null);
  }
  const cardTotal=(id)=>cardInvoiceNet(monthTx, id);
  return (
    <React.Fragment>
    <div className="card">
      <h3>Contas e cartões <span style={{display:"flex",alignItems:"center",gap:6}}><button className="sbtn" onClick={()=>setForm(blank)}><Icon name="adicionar" size={14}/> Adicionar</button><HelpIcon section="contas-cartoes"/></span></h3>
      <div className="sub">Organize de onde entra e sai cada valor. Cartões mostram a fatura do mês.</div>
      {form &&
        <div className="miniform">
          <input className="fld" placeholder="Nome (ex: Nubank, Carteira)" value={form.name} onChange={e=>setForm({...form,name:e.target.value,bank:form.bank||bancoDoNome(e.target.value)})} style={{marginBottom:10}}/>
          <select className="fld" aria-label="Banco" value={form.bank||""} onChange={e=>setForm({...form,bank:e.target.value})} style={{marginBottom:10}}>
            <option value="">Banco…</option>
            {BANKS.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
          <div className="seg" style={{marginBottom:10}}>
            <button className={form.kind==="conta"?"on in":""} onClick={()=>setForm({...form,kind:"conta"})}><Icon name="banco" size={14}/> Conta</button>
            <button className={form.kind==="cartao"?"on inv":""} onClick={()=>setForm({...form,kind:"cartao"})}><Icon name="cartao" size={14}/> Cartão</button>
          </div>
          {form.kind==="cartao" &&
            <div className="row2">
              <input className="fld" type="number" min="1" max="31" placeholder="Dia de fechamento" value={form.closingDay||""} onChange={e=>setForm({...form,closingDay:e.target.value?parseInt(e.target.value,10):""})}/>
              <input className="fld" type="number" min="1" max="31" placeholder="Dia de vencimento" value={form.dueDay||""} onChange={e=>setForm({...form,dueDay:e.target.value?parseInt(e.target.value,10):""})}/>
            </div>}
          {form.kind==="cartao" &&
            <div style={{marginBottom:12}}>
              <div className="sub" style={{marginBottom:4}}>Limite do cartão</div>
              <Money cents={form.limit||0} onChange={v=>setForm({...form,limit:v})} small/>
            </div>}
          <div style={{marginBottom:12}}>
            <div className="sub" style={{marginBottom:4}}>Saldo inicial (o que já tinha antes de começar a registrar aqui)</div>
            <Money cents={form.openingBalance||0} onChange={v=>setForm({...form,openingBalance:v})} small/>
          </div>
          <div className="row2">
            <div style={{flex:1}}>
              <div className="sub" style={{marginBottom:4}}>Data do saldo inicial</div>
              <input className="fld" type="date" value={form.openingDate||""} onChange={e=>setForm({...form,openingDate:e.target.value})}/>
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
            {COLORS.map(c=><button key={c} aria-label={"Cor "+c} onClick={()=>setForm({...form,color:c})} style={{width:28,height:28,borderRadius:8,background:c,border:form.color===c?"2px solid var(--text)":"2px solid transparent",cursor:"pointer"}}/>)}
          </div>
          <div style={{display:"flex",gap:8}}><button className="sbtn primary" onClick={save}>Salvar</button><button className="sbtn" onClick={()=>setForm(null)}>Cancelar</button></div>
        </div>}
      {accounts.map(a=>{
        const inv=cardTotal(a.id);
        return (
        <div className="acct" key={a.id} style={{flexDirection:"column",alignItems:"stretch",gap:0}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div className="adot" style={{background:a.color}}><Icon name={a.kind==="cartao"?"cartao":"banco"} size={16}/></div>
            <div style={{flex:1}}>
              <div className="aname">{a.name}</div>
              <div className="akind">{a.bank && a.bank!=="Outro" ? `${a.bank} · ` : ""}{a.kind==="cartao"?<>Cartão{a.closingDay?` · fecha dia ${a.closingDay}`:""}{a.dueDay?` · vence dia ${a.dueDay}`:""} · fatura do mês {inv.net===0&&inv.gasto>0?"quitada":brl(inv.net)}{inv.credit>0?` · ${brl(inv.credit)} pagos a mais`:""}</>:"Conta"}{a.openingBalance?<> · saldo inicial {brl(a.openingBalance)}{a.openingDate?` em ${fmtDateBR(a.openingDate)}`:""}</>:""}</div>
            </div>
            {a.kind==="cartao" && <button className="sbtn iconsbtn" aria-label="Auditar fatura" onClick={()=>openAudit(a)}><Icon name="documento" size={14}/></button>}
            <button className="sbtn iconsbtn" aria-label="Editar" onClick={()=>setForm(a)}><Icon name="editar" size={14}/></button>
            <button className="sbtn iconsbtn" aria-label="Excluir" onClick={()=>remove(a)}><Icon name="excluir" size={14}/></button>
          </div>
          {a.kind==="cartao" && a.limit>0 &&
            <div style={{marginTop:8,marginLeft:48}}>
              <ProgressBar spent={inv.net} limit={a.limit} status={inv.net>=a.limit?"over":inv.net/a.limit>=0.8?"warn":"ok"}/>
              <div className="mm">{Math.min(100,inv.net/a.limit*100).toFixed(0)}% do limite comprometido · {brl(inv.net)} de {brl(a.limit)}{inv.credit>0?` · sobrou ${brl(inv.credit)} pago a mais`:""}</div>
            </div>}
        </div>);})}
    </div>

    <Parcelamentos txs={txs}/>

    <Sheet open={!!deleteFlow} onClose={()=>setDeleteFlow(null)} title={deleteFlow?`Excluir ${deleteFlow.account.name}?`:""}>
      {deleteFlow &&
        <React.Fragment>
          <p style={{fontSize:14,color:"var(--text-mut)",marginBottom:14,lineHeight:1.5}}>
            Esta conta tem {deleteFlow.linkedCount} lançamento{deleteFlow.linkedCount===1?"":"s"} associado{deleteFlow.linkedCount===1?"":"s"}. Escolha para onde movê-los antes de excluir.
          </p>
          <select className="fld" value={reassignTo} onChange={e=>setReassignTo(e.target.value)} style={{marginBottom:16}}>
            {accounts.filter(x=>x.id!==deleteFlow.account.id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <div style={{display:"flex",gap:10}}>
            <button className="sbtn" style={{flex:1,justifyContent:"center"}} onClick={()=>setDeleteFlow(null)}>Cancelar</button>
            <button className="sbtn danger" style={{flex:1,justifyContent:"center"}} onClick={confirmRemoveWithReassign}>Excluir e mover</button>
          </div>
        </React.Fragment>}
    </Sheet>

    <Sheet open={!!auditAccount} onClose={()=>setAuditAccount(null)} title={auditAccount?`Auditar fatura · ${auditAccount.name}`:""}>
      {auditAccount &&
        <React.Fragment>
          <div className="sub" style={{marginBottom:8}}>Cole abaixo o texto da fatura (mesmo formato aceito em "Importar do banco") e escolha o mês de referência.</div>
          <input className="fld" type="month" value={auditMonth} onChange={e=>{setAuditMonth(e.target.value);setAuditResult(null);}} style={{marginBottom:10}}/>
          <textarea className="fld" rows={6}
            style={{resize:"vertical",fontFamily:"'IBM Plex Mono',monospace",fontSize:13,marginBottom:10}}
            placeholder={"01/07/2026 Compra Mercado XYZ -150,00\n05/07/2026 Uber -32,00"}
            value={auditText} onChange={e=>{setAuditText(e.target.value);setAuditResult(null);}}/>
          <button className="sbtn primary" onClick={runAudit} disabled={!auditText.trim()}>Analisar fatura</button>

          {auditResult &&
            <div style={{marginTop:16}}>
              <div className="kv"><span className="kk"><Icon name="check" size={14}/> Bateu</span><span className="vv">{auditResult.bateu.length} · {brl(auditResult.bateu.reduce((s,p)=>s+p.cents,0))}</span></div>
              <div className="kv"><span className="kk"><Icon name="alerta" size={14}/> Na fatura, não registrado</span><span className="vv" style={{color:"var(--warn)"}}>{auditResult.naFaturaNaoRegistrado.length} · {brl(auditResult.naFaturaNaoRegistrado.reduce((s,p)=>s+p.cents,0))}</span></div>
              <div className="kv"><span className="kk"><Icon name="alerta" size={14}/> Registrado, não na fatura</span><span className="vv" style={{color:"var(--neg)"}}>{auditResult.registradoNaoNaFatura.length} · {brl(auditResult.registradoNaoNaFatura.reduce((s,p)=>s+p.cents,0))}</span></div>

              {auditResult.naFaturaNaoRegistrado.length>0 &&
                <div style={{marginTop:14}}>
                  <div className="sub" style={{marginBottom:6}}>Na fatura mas não registrado no app</div>
                  {auditResult.naFaturaNaoRegistrado.map(p=>(
                    <div className="kv" key={p.id}><span className="kk">{fmtDateBR(p.date)} · {p.desc||"—"}</span><span className="vv">{brl(p.cents)}</span></div>
                  ))}
                </div>}
              {auditResult.registradoNaoNaFatura.length>0 &&
                <div style={{marginTop:14}}>
                  <div className="sub" style={{marginBottom:6}}>Registrado no app mas não encontrado na fatura</div>
                  {auditResult.registradoNaoNaFatura.map(t=>(
                    <div className="kv" key={t.id}><span className="kk">{fmtDateBR(t.date)} · {t.description||t.category}</span><span className="vv">{brl(t.cents)}</span></div>
                  ))}
                </div>}
              {auditResult.naFaturaNaoRegistrado.length===0 && auditResult.registradoNaoNaFatura.length===0 &&
                <p className="hint" style={{color:"var(--pos)"}}>Tudo bateu — a fatura corresponde exatamente ao que está registrado.</p>}
            </div>}
        </React.Fragment>}
    </Sheet>
    </React.Fragment>
  );
}
Contas = React.memo(Contas);

export { Parcelamentos, Contas };
