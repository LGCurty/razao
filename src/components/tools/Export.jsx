/* components/tools/Export.jsx — Exportação (Ferramentas, como no OTAMERICA Sentinel): movimentos em Excel
   (.xlsx) ou CSV com filtros, relatório do mês em PDF (pela impressão do aparelho) e backup completo.
   No celular os arquivos podem ir direto para a folha de compartilhamento (WhatsApp, Drive, e-mail…). */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { CATS } from "../../domain/categories";
import { TYPES, isRealized } from "../../domain/types";
import { linhasMovimentos, paraCSV, paraXLSX, TIPOS_MIME, podeCompartilhar, compartilharOuBaixar } from "../../utils/exporters";
import { todayISO } from "../../utils/dates";
import { brl, fmtDateBR } from "../../utils/formatters";
import { MonthReport } from "./MonthReport";

/* exporta uma lista de movimentos no formato escolhido; devolve o que aconteceu, para a tela avisar */
async function exportarMovimentos(lista, accounts, formato, nomeBase, compartilhar){
  const linhas=linhasMovimentos(lista, accounts);
  const nome=`${nomeBase}.${formato}`;
  const conteudo = formato==="xlsx" ? paraXLSX(linhas) : paraCSV(linhas);
  const r=await compartilharOuBaixar(conteudo, nome, TIPOS_MIME[formato], compartilhar);
  if(r==="baixado") toast(`${nome} baixado (${lista.length} movimento${lista.length===1?"":"s"}).`,"success");
  else if(r==="compartilhado") toast("Arquivo enviado.","success");
  return r;
}

function Exportacao({ txs, accounts, view, vKey, monthLabel, totals, budgetRows, monthItens, onBackup }){
  const [periodo,setPeriodo]=useState("mes");        // "mes" | "intervalo" | "tudo"
  const [de,setDe]=useState(`${vKey}-01`);
  const [ate,setAte]=useState(todayISO());
  const [tipo,setTipo]=useState("");                 // "" = todos
  const [conta,setConta]=useState("");
  const [categoria,setCategoria]=useState("");
  const [status,setStatus]=useState("");
  const compartilhavel=useMemo(()=>podeCompartilhar(),[]);
  const [compartilhar,setCompartilhar]=useState(compartilhavel);
  const [ocupado,setOcupado]=useState("");
  const [imprimindo,setImprimindo]=useState(false);

  const lista=useMemo(()=>(txs||[]).filter(t=>{
    if(periodo==="mes" && String(t.date).slice(0,7)!==vKey) return false;
    if(periodo==="intervalo" && ((de && t.date<de) || (ate && t.date>ate))) return false;
    if(tipo && t.type!==tipo) return false;
    if(conta && t.acctId!==conta && t.toAcctId!==conta) return false;
    if(categoria && t.category!==categoria) return false;
    if(status==="realizado" && !isRealized(t)) return false;
    if(status==="previsto" && isRealized(t)) return false;
    return true;
  }),[txs,periodo,de,ate,tipo,conta,categoria,status,vKey]);
  const soma=lista.reduce((s,t)=>s+(t.type==="ganho"?t.cents:-t.cents),0);
  const nomeBase = periodo==="mes" ? `razao-movimentos-${vKey}` : periodo==="intervalo" ? `razao-movimentos-${de||"inicio"}-a-${ate||"hoje"}` : `razao-movimentos-${todayISO()}`;
  const categorias=[...new Set([...CATS.gasto.map(c=>c[0]), ...CATS.ganho.map(c=>c[0]), ...(txs||[]).map(t=>t.category).filter(Boolean)])];

  async function exportar(formato){
    if(!lista.length || ocupado) return;
    setOcupado(formato);
    try{ await exportarMovimentos(lista, accounts, formato, nomeBase, compartilhar); }
    catch(e){ toast(e.message||"Não foi possível gerar o arquivo.","error"); }
    finally{ setOcupado(""); }
  }

  // relatório: monta a versão para impressão e abre a impressão do aparelho ("Salvar como PDF")
  useEffect(()=>{
    if(!imprimindo) return;
    const tituloAntes=document.title;
    document.title=`Razão — Relatório de ${monthLabel}`;
    const fim=()=>{ document.title=tituloAntes; setImprimindo(false); };
    window.addEventListener("afterprint",fim);
    const t=setTimeout(()=>{ try{ window.print(); }catch(e){ fim(); } },150);
    const seguranca=setTimeout(fim,120000);
    return ()=>{ clearTimeout(t); clearTimeout(seguranca); window.removeEventListener("afterprint",fim); document.title=tituloAntes; };
  },[imprimindo]);

  return (
    <React.Fragment>
      <div className="card g-12 export">
        <h3>Movimentos em Excel ou CSV</h3>
        <div className="sub">Escolha o recorte e o formato. O Excel já vem com datas, valores em R$, filtro e cabeçalho fixo.</div>

        <div className="exlabel">Período</div>
        <div className="seg mini exseg" role="group" aria-label="Período">
          <button className={periodo==="mes"?"on":""} aria-pressed={periodo==="mes"} onClick={()=>setPeriodo("mes")}>{monthLabel}</button>
          <button className={periodo==="intervalo"?"on":""} aria-pressed={periodo==="intervalo"} onClick={()=>setPeriodo("intervalo")}>Intervalo</button>
          <button className={periodo==="tudo"?"on":""} aria-pressed={periodo==="tudo"} onClick={()=>setPeriodo("tudo")}>Tudo</button>
        </div>
        {periodo==="intervalo" &&
          <div className="exdatas">
            <label><span>De</span><input className="fld" type="date" value={de} onChange={e=>setDe(e.target.value)}/></label>
            <label><span>Até</span><input className="fld" type="date" value={ate} onChange={e=>setAte(e.target.value)}/></label>
          </div>}

        <div className="exgrid">
          <label><span className="exlabel">Tipo</span>
            <select className="fld" value={tipo} onChange={e=>setTipo(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select></label>
          <label><span className="exlabel">Conta</span>
            <select className="fld" value={conta} onChange={e=>setConta(e.target.value)}>
              <option value="">Todas</option>
              {(accounts||[]).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
          <label><span className="exlabel">Categoria</span>
            <select className="fld" value={categoria} onChange={e=>setCategoria(e.target.value)}>
              <option value="">Todas</option>
              {categorias.map(c=><option key={c} value={c}>{c}</option>)}
            </select></label>
          <label><span className="exlabel">Status</span>
            <select className="fld" value={status} onChange={e=>setStatus(e.target.value)}>
              <option value="">Realizado e previsto</option>
              <option value="realizado">Só realizado</option>
              <option value="previsto">Só previsto</option>
            </select></label>
        </div>

        <div className="exresumo" aria-live="polite">
          <b className="num">{lista.length}</b> movimento{lista.length===1?"":"s"} · saldo do recorte <b className="num" style={{color:soma>=0?"var(--pos)":"var(--neg)"}}>{brl(soma)}</b>
        </div>

        {compartilhavel &&
          <label className="toggle" style={{marginTop:4}}>
            <input type="checkbox" checked={compartilhar} onChange={e=>setCompartilhar(e.target.checked)}/>
            Enviar pelo compartilhamento do celular (WhatsApp, Drive, e-mail…) em vez de só baixar
          </label>}

        <div className="exacts">
          <button className="sbtn primary" disabled={!lista.length||!!ocupado} onClick={()=>exportar("xlsx")}><Icon name="baixar" size={15}/> {ocupado==="xlsx"?"Gerando…":"Excel (.xlsx)"}</button>
          <button className="sbtn" disabled={!lista.length||!!ocupado} onClick={()=>exportar("csv")}><Icon name="baixar" size={15}/> {ocupado==="csv"?"Gerando…":"CSV"}</button>
        </div>
        {!lista.length && <p className="hint">Nenhum movimento nesse recorte.</p>}
      </div>

      <div className="card g-6 export">
        <h3>Relatório do mês em PDF</h3>
        <div className="sub">{monthLabel}: resumo, orçamento por categoria, gastos por categoria, saldos das contas e todos os lançamentos, numa página pronta para guardar ou mandar.</div>
        <button className="sbtn primary exbig" onClick={()=>setImprimindo(true)} disabled={imprimindo}><Icon name="documento" size={15}/> {imprimindo?"Abrindo…":"Gerar relatório (PDF)"}</button>
        <p className="hint">Abre a impressão do aparelho: escolha <b>Salvar como PDF</b> (no iPhone, toque em Compartilhar › Imprimir e depois em compartilhar de novo para salvar).</p>
      </div>

      <div className="card g-6 export">
        <h3>Backup completo</h3>
        <div className="sub">Tudo do app (lançamentos, contas, orçamentos, metas, carteira e preferências) num arquivo .json, para guardar ou importar em outro aparelho em Preferências.</div>
        <button className="sbtn exbig" onClick={onBackup}><Icon name="baixar" size={15}/> Baixar backup (.json)</button>
      </div>

      {imprimindo && createPortal(
        <MonthReport {...{ accounts, txs, monthItens, monthLabel, totals, budgetRows, vKey }}/>,
        document.body)}
    </React.Fragment>
  );
}

export { Exportacao, exportarMovimentos };
