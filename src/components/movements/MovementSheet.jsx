/* components/movements/MovementSheet.jsx — ficha completa de um movimento (inspirada na ficha de detalhes do
   OTAMERICA Sentinel): valor e status em destaque, especificações completas e as ações Editar, Duplicar,
   Marcar como pago e Excluir. Abre de qualquer lugar (lista, cartões, busca, histórico da Home). */
import React, { useRef } from "react";
import { askConfirm, askSeriesScope, toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Sheet } from "../common/Modal";
import { CAT_ICON } from "../../domain/categories";
import { TYPES, isRealized, paymentLabel } from "../../domain/types";
import { txEffectiveMonth } from "../../utils/calculations";
import { todayISO } from "../../utils/dates";
import { brl, capFirst, extractTags, fmtDateBR } from "../../utils/formatters";
import { uid } from "../../utils/ids";

const ORIGEM = { manual:"Lançado à mão", pluggy_sync:"Open Finance (banco conectado)", importacao:"Importação de extrato/fatura" };
const rotuloMov = (t)=> t.description || t.category || (TYPES[t.type]||TYPES.gasto).label;

/* ações sobre um movimento, usadas pela ficha. "editar" reaproveita o formulário do app (onEdit); série de
   recorrência/parcelamento pergunta o alcance (só este, este e os próximos, todos), como na lista. */
function useMovementActions({ txs, update, onEdit }){
  const txsRef=useRef(txs); txsRef.current=txs;
  function editar(t){
    if(t.seriesId){ askSeriesScope({ tx:t, txs:txsRef.current, action:"editar", onChoice:(ids)=>onEdit(t, ids.filter(id=>id!==t.id)) }); return; }
    onEdit(t, []);
  }
  function excluir(t, depois){
    const apagar=(ids)=>{
      const removidos=txsRef.current.filter(x=>ids.includes(x.id));
      update(d=>({ transactions:d.transactions.filter(x=>!ids.includes(x.id)) }));
      if(depois) depois();
      toast(ids.length>1 ? `${ids.length} lançamentos excluídos.` : `"${rotuloMov(t)}" excluído.`, "default", {
        duration:6000,
        action:{ label:"Desfazer", onClick:()=>update(d=>({ transactions:[...removidos.filter(r=>!d.transactions.some(x=>x.id===r.id)), ...d.transactions] })) },
      });
    };
    if(t.seriesId){ askSeriesScope({ tx:t, txs:txsRef.current, action:"excluir", onChoice:apagar }); return; }
    askConfirm({
      title:"Excluir movimento?",
      message:`"${rotuloMov(t)}" de ${brl(t.cents)} em ${fmtDateBR(t.date)} será excluído.`,
      confirmLabel:"Excluir",
      onConfirm:()=>apagar([t.id]),
    });
  }
  /* cópia avulsa com a data de hoje: sai da série e perde o vínculo com o banco (é um lançamento novo, à mão) */
  function duplicar(t){
    const hoje=todayISO();
    const { pluggyId, seriesId, seriesIndex, seriesTotal, ...resto }=t;
    const copia={ ...resto, id:uid(), date:hoje, status:"realizado", source:"manual" };
    update(d=>({ transactions:[copia, ...d.transactions] }));
    toast(`"${rotuloMov(t)}" duplicado com a data de hoje.`, "success", {
      duration:6000,
      action:{ label:"Desfazer", onClick:()=>update(d=>({ transactions:d.transactions.filter(x=>x.id!==copia.id) })) },
    });
    return copia;
  }
  function marcarPago(t){
    update(d=>({ transactions:d.transactions.map(x=>x.id===t.id?{...x,status:"realizado"}:x) }));
    toast("Marcado como pago.","success");
  }
  return { editar, excluir, duplicar, marcarPago };
}

function MovementSheet({ txId, txs, accounts, onClose, actions, onOpenTx }){
  // sempre a versão atual do lançamento (depois de editar, a ficha mostra o novo valor; se for excluído, fecha)
  const t = txId ? (txs||[]).find(x=>x.id===txId) : null;
  const conta=(id)=>(accounts||[]).find(a=>a.id===id);
  const open=Boolean(t);
  if(!t) return <Sheet open={false} onClose={onClose} title="Detalhes do movimento"/>;

  const tipo=TYPES[t.type]||TYPES.gasto;
  const trf=t.type==="transferencia";
  const previsto=!isRealized(t);
  const a=conta(t.acctId), b=conta(t.toAcctId);
  const mesFatura=txEffectiveMonth(t,accounts);
  const outraFatura = t.type==="gasto" && mesFatura!==String(t.date).slice(0,7);
  const tags=extractTags(t.description);
  const sinal = tipo.sign<0 ? "−" : tipo.sign>0 ? "+" : "↔";

  const specs=[
    ["Data", fmtDateBR(t.date)],
    ["Tipo", tipo.label],
    !trf && ["Categoria", t.category||"—"],
    [trf?"Origem":"Conta", a ? a.name : "—"],
    trf && ["Destino", b ? b.name : "—"],
    a && a.bank && a.bank!=="Outro" && ["Banco", a.bank],
    !trf && ["Forma de pagamento", paymentLabel(t, accounts)||"—"],
    outraFatura && ["Conta na fatura de", capFirst(new Date(mesFatura+"-01T00:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"}))],
    t.seriesTotal>1 && ["Parcela / recorrência", `${(t.seriesIndex||0)+1} de ${t.seriesTotal}`],
    tags.length>0 && ["Tags", tags.map(x=>"#"+x).join(" ")],
    ["Registrado por", ORIGEM[t.source] || ORIGEM.manual],
    t.pluggyId && ["ID no banco", t.pluggyId],
  ].filter(Boolean);

  const fechar=()=>onClose();
  const depoisDe=(fn)=>()=>{ fechar(); setTimeout(fn,60); }; // fecha a ficha antes de abrir outro diálogo

  return (
    <Sheet open={open} onClose={fechar} title="Detalhes do movimento">
      <div className="mvsheet">
        <div className="mvhead">
          <span className={"mvic "+tipo.cls}><Icon name={trf?"transferencia":(CAT_ICON[t.category]||"outros")} size={20}/></span>
          <div className="mvtitle">
            <b>{rotuloMov(t)}</b>
            <span className="mono">{trf ? "Transferência" : t.category} · {fmtDateBR(t.date)}</span>
          </div>
        </div>

        <div className={"mvstatus "+(previsto?"warn":tipo.cls)}>
          <div>
            <div className="mvlabel"><Icon name="atualizar" size={13}/> {previsto ? "Previsto" : "Realizado"}</div>
            <div className={"mvvalor num "+tipo.cls}>{sinal} {brl(t.cents)}</div>
          </div>
          <span className={"mvbadge "+(previsto?"warn":tipo.cls)}>{previsto ? "PREVISTO" : tipo.label.toUpperCase()}</span>
        </div>

        <div className="mvboxes">
          <div className="mvbox"><small>{trf?"De":"Conta"}</small><b>{a ? a.name : "—"}</b></div>
          <div className="mvbox"><small>{trf?"Para":"Categoria"}</small><b>{trf ? (b ? b.name : "—") : (t.category||"—")}</b></div>
        </div>

        <div className="mvspecs">
          <div className="mvspecstitle">Ficha completa</div>
          {specs.map(([k,v])=>(
            <div className="mvspec" key={k}><span>{k}</span><b className={k==="ID no banco"?"mono":""}>{v}</b></div>
          ))}
        </div>

        <div className="mvacts">
          {previsto && <button className="sbtn mvpaid" onClick={()=>actions.marcarPago(t)}><Icon name="check" size={15}/> Marcar como pago</button>}
          <button className="sbtn" onClick={depoisDe(()=>actions.editar(t))}><Icon name="editar" size={15}/> Editar</button>
          <button className="sbtn" onClick={()=>{ const c=actions.duplicar(t); if(c && onOpenTx) onOpenTx(c); }}><Icon name="adicionar" size={15}/> Duplicar</button>
          <button className="sbtn danger mvdel" onClick={depoisDe(()=>actions.excluir(t))}><Icon name="excluir" size={15}/> Excluir</button>
        </div>
      </div>
    </Sheet>
  );
}

export { MovementSheet, useMovementActions };
