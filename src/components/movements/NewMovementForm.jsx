/* components/movements/NewMovementForm.jsx — formulário de novo movimento / edição (tipo, valor, categoria, conta, data, método, repetir/parcelar). */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Money } from "../common/Input";
import { CATS, CAT_COLOR, CAT_HINT } from "../../domain/categories";
import { PAYMENT_METHODS, TYPES, defaultPaymentMethod, paymentMethodsFor } from "../../domain/types";
import { lookupCategoryMemory, suggestCategoryWithAI } from "../../services/geminiService";
import { splitCents } from "../../utils/calculations";
import { addMonthsISO, todayISO } from "../../utils/dates";
import { brl, extractTags, fmtDateBR } from "../../utils/formatters";
import { uid } from "../../utils/ids";
import { DATE_RE } from "../../utils/validators";

/* ---------- FORMULÁRIO DE LANÇAMENTO (usado inline no desktop e dentro do sheet no mobile) ---------- */
function TransactionForm({ accounts, txs, update, editTx, onDone, autoFocus, propagateIds, categoryMemory }){
  const [type,setType]=useState(editTx?editTx.type:"gasto");
  const [cents,setCents]=useState(editTx?editTx.cents:0);
  const [cat,setCat]=useState(editTx?(editTx.category||CATS.gasto[0][0]):CATS.gasto[0][0]);
  const [desc,setDesc]=useState(editTx?editTx.description:"");
  const [date,setDate]=useState(editTx?editTx.date:todayISO());
  const [acctId,setAcctId]=useState(editTx?(editTx.acctId||accounts[0]?.id||""):(accounts[0]?.id||""));
  const [toAcctId,setToAcctId]=useState(editTx?(editTx.toAcctId||accounts[1]?.id||accounts[0]?.id||""):(accounts[1]?.id||accounts[0]?.id||""));
  const [repeat,setRepeat]=useState(false);
  const [repeatMode,setRepeatMode]=useState("fixo"); // "fixo" (recorrente) | "parcelado"
  const [repeatTimes,setRepeatTimes]=useState(2);
  const [catManual,setCatManual]=useState(!!editTx);
  const [catSuggestBusy,setCatSuggestBusy]=useState(false);
  // método de pagamento: sugerido pela conta (cartão → crédito) até a pessoa escolher na mão
  const [pay,setPay]=useState(editTx?(editTx.paymentMethod||""):"");
  const [payManual,setPayManual]=useState(Boolean(editTx&&editTx.paymentMethod));
  const [tentou,setTentou]=useState(false); // só mostra os erros depois da primeira tentativa de salvar
  const formRef=useRef(null);
  const descTimer=useRef(null);
  const editId=editTx?editTx.id:null;

  // autocompletar #tag: sugere tags já usadas antes enquanto a pessoa digita "#" na descrição
  const knownTags=useMemo(()=>{ const set=new Set(); txs.forEach(t=>extractTags(t.description).forEach(tg=>set.add(tg))); return [...set].sort(); },[txs]);
  const tagFragmentMatch=desc.match(/#(\w*)$/);
  const tagFragment=tagFragmentMatch?tagFragmentMatch[1].toLowerCase():null;
  const tagSuggestions=tagFragment!=null?knownTags.filter(tg=>tg!==tagFragment&&tg.startsWith(tagFragment)).slice(0,5):[];
  const pickTagSuggestion=(tg)=>setDesc(d=>d.replace(/#(\w*)$/,"#"+tg+" "));

  useEffect(()=>{ if(!editTx && CATS[type]) setCat(CATS[type][0][0]); if(!editTx) setCatManual(false); },[type]);
  // sugestão de categoria enquanto o usuário digita a descrição (só se ele ainda não escolheu uma categoria na mão;
  // transferência não tem categoria). Primeiro consulta a memória local (descrição→categoria já escolhida antes) —
  // só cai pra IA se não achar nada ali, economizando uma chamada de rede no caso comum de descrição repetida.
  useEffect(()=>{
    clearTimeout(descTimer.current);
    if(editId || catManual || type==="transferencia" || desc.trim().length<3) return;
    const remembered=lookupCategoryMemory(categoryMemory, desc.trim());
    if(remembered && CATS[type].some(c=>c[0]===remembered)){ setCat(remembered); return; }
    descTimer.current=setTimeout(async()=>{
      setCatSuggestBusy(true);
      try{
        const suggested=await suggestCategoryWithAI(desc.trim(), type);
        if(suggested) setCat(suggested);
      }catch(_){ /* sugestão é só um bônus; sem IA a escolha manual de categoria continua normal */ }
      finally{ setCatSuggestBusy(false); }
    },800);
    return ()=>clearTimeout(descTimer.current);
  },[desc, type, catManual, editId, categoryMemory]);

  const isTransfer=type==="transferencia";
  const transferInvalid=isTransfer && (!toAcctId || acctId===toAcctId);
  const contaAtual=accounts.find(a=>a.id===acctId);
  const metodos=paymentMethodsFor(type);
  useEffect(()=>{
    if(payManual || isTransfer) return;
    setPay(defaultPaymentMethod(type, contaAtual));
  },[type, acctId, payManual]);
  // validação do roteiro: valor > 0, categoria, conta e método obrigatórios; movimento avulso novo não pode
  // ficar no futuro (conta futura entra por "Repetir / Parcelar", que já cria os previstos dos próximos meses)
  const erros=[];
  if(!(cents>0)) erros.push("Informe um valor maior que zero.");
  if(!isTransfer && !cat) erros.push("Escolha uma categoria.");
  if(accounts.length===0) erros.push("Cadastre uma conta em Configurações › Contas e bancos.");
  else if(!acctId) erros.push("Escolha o banco/conta.");
  if(!isTransfer && !pay) erros.push("Escolha o método de pagamento.");
  if(transferInvalid) erros.push("A conta de origem e a de destino devem ser diferentes.");
  if(!DATE_RE.test(date||"")) erros.push("Informe a data.");
  else if(!editId && !repeat && date>todayISO()) erros.push("A data não pode estar no futuro. Para contas que ainda vão vencer, use \"Repetir / Parcelar\".");

  function submit(){
    setTentou(true);
    if(erros.length) return;
    const entryCat=isTransfer?"":cat;
    const entryPay=isTransfer?undefined:pay;
    const entryToAcct=isTransfer?toAcctId:undefined;
    const today=todayISO();
    // memória de categorização: toda vez que um lançamento com descrição é salvo, guarda a categoria escolhida
    // pra essa descrição — próxima vez que ela aparecer, sugere direto sem precisar chamar a IA
    const rememberKey = (!isTransfer && desc.trim()) ? desc.trim().toLowerCase() : null;
    const withMemory = (d, patch)=> rememberKey ? {...patch, categoryMemory:{...(d.categoryMemory||{}), [rememberKey]:entryCat}} : patch;
    if(repeat && !editId){
      const n=Math.max(2,parseInt(repeatTimes,10)||2);
      const baseDesc=desc.trim()||(isTransfer?"Transferência":cat);
      const sId=uid(); // agrupa a série toda (recorrência/parcelamento) pra permitir editar/excluir em bloco depois
      const entries = repeatMode==="parcelado"
        ? splitCents(cents,n).map((c,i)=>{ const d=addMonthsISO(date,i); return { id:uid(), type, cents:c, category:entryCat, description:`${baseDesc} (${i+1}/${n})`, date:d, acctId, toAcctId:entryToAcct, paymentMethod:entryPay, source:"manual", status:d>today?"previsto":"realizado", seriesId:sId, seriesIndex:i, seriesTotal:n }; })
        : Array.from({length:n},(_,i)=>{ const d=addMonthsISO(date,i); return { id:uid(), type, cents, category:entryCat, description:desc.trim(), date:d, acctId, toAcctId:entryToAcct, paymentMethod:entryPay, source:"manual", status:d>today?"previsto":"realizado", seriesId:sId, seriesIndex:i, seriesTotal:n }; });
      update(d=>withMemory(d,{transactions:[...entries,...d.transactions]}));
      toast(`${n} lançamentos criados.`,"success");
      setCents(0);setDesc("");setRepeat(false);setRepeatTimes(2);setCatManual(false);setTentou(false);
      formRef.current?.querySelector("input")?.focus();
      onDone && onDone();
      return;
    }
    const entry={
      ...(editTx||{}), // edição preserva o que o formulário não mostra (id do banco, origem, tags de série…)
      id:editId||uid(), type, cents, category:entryCat, description:desc.trim(), date, acctId, toAcctId:entryToAcct,
      paymentMethod:entryPay, source:(editTx&&editTx.source)||"manual",
      status: editId ? (editTx.status||"realizado") : (date>today?"previsto":"realizado"),
      ...(editId ? { seriesId:editTx.seriesId, seriesIndex:editTx.seriesIndex, seriesTotal:editTx.seriesTotal } : {}),
    };
    if(editId && propagateIds && propagateIds.length){
      // "este e os próximos" / "todos": propaga só os campos editáveis (não a data — cada ocorrência é a sua própria)
      update(d=>withMemory(d,{transactions: d.transactions.map(t=>{
        if(t.id===editId) return entry;
        // não propaga a descrição: no parcelado ela carrega o número da própria parcela "(2/4)" etc.,
        // então sobrescrever com a descrição do item editado apagaria a numeração dos outros.
        if(propagateIds.includes(t.id)) return {...t, type:entry.type, cents:entry.cents, category:entry.category, acctId:entry.acctId, toAcctId:entry.toAcctId, paymentMethod:entry.paymentMethod};
        return t;
      })}));
    } else {
      update(d=>withMemory(d,{transactions:editId?d.transactions.map(t=>t.id===editId?entry:t):[entry,...d.transactions]}));
    }
    toast(editId?"Movimento atualizado.":"Movimento salvo.","success");
    setCents(0);setDesc("");setCatManual(false);setTentou(false);
    formRef.current?.querySelector("input")?.focus();
    onDone && onDone();
  }

  return (
    <div className="add" ref={formRef}>
      {editId && <div className="editing"><span>Editando lançamento</span><button onClick={onDone}>cancelar</button></div>}
      <div className="seg">
        {Object.entries(TYPES).map(([k,v])=><button key={k} className={(type===k?"on ":"")+v.cls} onClick={()=>setType(k)}>{v.label}</button>)}
      </div>
      <Money cents={cents} onChange={setCents} onEnter={submit} autoFocus={autoFocus}/>
      {!isTransfer &&
        <div className="chips">
          {CATS[type].map(([name,ic])=>
            <button key={name} className={"chip"+(cat===name?" on":"")} onClick={()=>{setCat(name);setCatManual(true);}}>
              <span className="swatch" style={{background:cat===name?"transparent":(CAT_COLOR[name]+"22")}}><Icon name={ic} size={12}/></span>{name}
            </button>)}
          {catSuggestBusy && <span className="aichip"><Icon name="brilho" size={12}/><span className="shimmer"/></span>}
        </div>}
      {!isTransfer && CAT_HINT[cat] && <p className="hint cathint">{cat}: {CAT_HINT[cat]}</p>}
      <div className="row2">
        <div style={{position:"relative"}}>
          <input className="fld" placeholder="Descrição (opcional) — use #tags" value={desc} onChange={e=>setDesc(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submit();}}/>
          {tagSuggestions.length>0 &&
            <div className="tagsuggest">
              {tagSuggestions.map(tg=><button type="button" key={tg} onClick={()=>pickTagSuggestion(tg)}>#{tg}</button>)}
            </div>}
        </div>
        {isTransfer ? (
          <React.Fragment>
            <select className="fld" value={acctId} onChange={e=>setAcctId(e.target.value)} style={{flex:"0 0 auto",maxWidth:170}}>
              {accounts.map(a=><option key={a.id} value={a.id}>Origem: {a.name}</option>)}
            </select>
            <select className="fld" value={toAcctId} onChange={e=>setToAcctId(e.target.value)} style={{flex:"0 0 auto",maxWidth:170}}>
              {accounts.map(a=><option key={a.id} value={a.id}>Destino: {a.name}</option>)}
            </select>
          </React.Fragment>
        ) : (
          <select className="fld" value={acctId} onChange={e=>setAcctId(e.target.value)} style={{flex:"0 0 auto",maxWidth:170}}>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <input className="fld" type="date" value={date} max={(!editId&&!repeat)?todayISO():undefined} onChange={e=>setDate(e.target.value)} style={{flex:"0 0 auto",maxWidth:160}} aria-label="Data"/>
      </div>
      {!isTransfer &&
        <div className="row2">
          <select className="fld" aria-label="Método de pagamento" value={pay} onChange={e=>{setPay(e.target.value);setPayManual(true);}}>
            <option value="">Método de pagamento…</option>
            {metodos.map(k=><option key={k} value={k}>{PAYMENT_METHODS[k].label}</option>)}
          </select>
        </div>}
      {isTransfer && transferInvalid && !tentou && <p className="hint" style={{color:"var(--neg)"}}>A conta de origem e destino devem ser diferentes.</p>}
      {!editId &&
        <label className="toggle">
          <input type="checkbox" checked={repeat} onChange={e=>setRepeat(e.target.checked)}/>
          Repetir / Parcelar
        </label>}
      {!editId && repeat &&
        <div className="row2">
          <select className="fld" value={repeatMode} onChange={e=>setRepeatMode(e.target.value)}>
            <option value="fixo">Fixo / Recorrente</option>
            <option value="parcelado">Parcelado</option>
          </select>
          <input className="fld" type="number" min="2" placeholder="Vezes" value={repeatTimes}
            onChange={e=>setRepeatTimes(e.target.value)} style={{flex:"0 0 auto",maxWidth:120}}/>
        </div>}
      {!editId && repeat && cents>0 && (()=>{
        const n=Math.max(2,parseInt(repeatTimes,10)||2);
        return (
          <p className="hint" style={{marginTop:-6,marginBottom:14}}>
            {repeatMode==="parcelado"
              ? <>Serão criados {n} lançamentos de ~{brl(Math.round(cents/n))} cada, de {fmtDateBR(date)} até {fmtDateBR(addMonthsISO(date,n-1))}.</>
              : <>Serão criados {n} lançamentos de {brl(cents)} cada, de {fmtDateBR(date)} até {fmtDateBR(addMonthsISO(date,n-1))}.</>}
          </p>);
      })()}
      {tentou && erros.length>0 &&
        <ul className="formerrs" role="alert">{erros.map(e=><li key={e}>{e}</li>)}</ul>}
      <div className="formactions">
        {onDone && <button type="button" className="sbtn" onClick={onDone}>Cancelar</button>}
        <button className="submit" onClick={submit}>{editId?"Salvar alterações":repeat?`Criar ${Math.max(2,parseInt(repeatTimes,10)||2)} lançamentos`:"Salvar"}</button>
      </div>
    </div>
  );
}

export { TransactionForm };
