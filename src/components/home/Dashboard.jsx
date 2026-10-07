/* components/home/Dashboard.jsx — Home: saldo total, o mês em números, orçamento mais apertado e histórico recente. */
import React, { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { ProgressBar } from "../common/Charts";
import { toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { StatusDot } from "../common/StatusDot";
import { HelpIcon } from "../help/HelpIcon";
import { goToTab } from "../navigation/navEvents";
import { CAT_ICON } from "../../domain/categories";
import { TYPES, isRealized, paymentLabel } from "../../domain/types";
import { cardInvoiceNet, saldosPorConta } from "../../utils/calculations";
import { brl, brlNum, tempoDesde } from "../../utils/formatters";

function HomeDashboard({ txs, accounts, monthIndex, vKey, monthLabel, totals, budgetRows, pluggy, onOpenTx }){
  // quem está logado e o motor de sincronização vêm dos contextos (não descem mais por props)
  const { session } = useAuth();
  const { pluggySync } = useData();
  const contas=useMemo(()=>saldosPorConta(txs, accounts),[txs,accounts]);
  const soContas=contas.filter(a=>a.kind==="conta");
  const saldoTotal=soContas.reduce((s,a)=>s+a.saldo,0);
  const bucket=monthIndex[vKey]||{itens:[]};
  const faturas=contas.filter(a=>a.kind==="cartao")
    .map(a=>({ a, v:cardInvoiceNet(bucket.itens, a.id).net }))
    .filter(x=>x.v>0);
  const conexoes=(pluggy&&pluggy.items)||[];
  const estado=(pluggySync&&pluggySync.estado)||{};
  const comErro=conexoes.filter(c=>{ const e=estado[c.id]; return (e && (e.fase==="erro"||e.fase==="reconectar"||e.fase==="parcial")) || c.lastError; });
  const ultima=pluggySync&&pluggySync.ultimaSync;
  const nome = session ? String(session.user.email||"").split("@")[0] : "";

  const resultado=totals.inc-totals.exp;
  const comLimite=budgetRows.filter(r=>r.limit>0).sort((a,b)=>b.pct-a.pct).slice(0,3);
  const semLimite=comLimite.length ? [] : budgetRows.filter(r=>r.spent>0).sort((a,b)=>b.spent-a.spent).slice(0,3);
  const recentes=useMemo(()=>[...txs].filter(isRealized)
    .sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:String(b.id).localeCompare(String(a.id))).slice(0,5),[txs]);
  const nomeConta=(id)=>{ const a=accounts.find(x=>x.id===id); return a ? (a.bank && a.bank!=="Outro" ? `${a.bank}` : a.name) : "—"; };

  async function sincronizar(){
    if(!pluggySync) return;
    const r=await pluggySync.sincronizarAgora();
    if(r && !r.ok && r.erro) toast(r.erro,"error");
  }
  const podeSincronizar = pluggySync && pluggySync.ativo && conexoes.length>0;

  return (
    <React.Fragment>
      <div className="homehead">
        <div>
          <div className="eyebrow">{nome?`Olá, ${nome}`:"Olá"}</div>
          <h2 className="hometitle">Seu dinheiro hoje</h2>
        </div>
        {podeSincronizar
          ? <button className={"syncbtn"+(pluggySync.rodando?" spin":"")+(comErro.length?" err":"")} onClick={sincronizar} disabled={pluggySync.rodando}
              aria-label="Sincronizar com os bancos" title={ultima?`Última sincronização ${tempoDesde(ultima)}`:"Sincronizar com os bancos"}>
              <Icon name="sincronizar" size={16}/>
              <span>{pluggySync.rodando ? "Sincronizando…" : comErro.length ? "Erro na sincronização" : ultima ? `Atualizado ${tempoDesde(ultima)}` : "Sincronizar"}</span>
            </button>
          : <button className="syncbtn" onClick={()=>goToTab("contas")}><Icon name="banco" size={16}/><span>Conectar banco</span></button>}
      </div>

      <div className="card g-6 homecard">
        <h3>Saldo total <HelpIcon section="contas-cartoes"/></h3>
        <div className={"bal num "+(saldoTotal>=0?"pos":"neg")} style={{fontSize:30,margin:"4px 0 6px"}}>{brl(saldoTotal)}</div>
        <div className="mm">Soma das {soContas.length} conta{soContas.length===1?"":"s"} (sem cartões){soContas.some(a=>a.doBanco)?" · saldo informado pelo banco nas contas conectadas":""}</div>
        {faturas.length>0 && <div className="mm">Fatura de cartão em {monthLabel}: {faturas.map(f=>`${f.a.name} ${brl(f.v)}`).join(" · ")}</div>}
        <div className="homemeta">
          {conexoes.length>0
            ? <React.Fragment>
                <span><Icon name="banco" size={13}/> {conexoes.length} banco{conexoes.length===1?"":"s"} conectado{conexoes.length===1?"":"s"} ({conexoes.map(c=>c.connectorName).join(", ")})</span>
                {ultima && <span>Última sincronização: {tempoDesde(ultima)}</span>}
                {comErro.length>0 && <span style={{color:"var(--neg)"}}>{comErro.map(c=>c.connectorName).join(", ")}: precisa de atenção em Configurações › Contas e bancos</span>}
              </React.Fragment>
            : <span>Nenhum banco conectado — os saldos vêm do que você lança.</span>}
        </div>
      </div>

      <div className="card g-6 homecard">
        <h3>{monthLabel} em números</h3>
        <div className="kv"><span className="kk">Renda</span><span className="vv num" style={{color:"var(--pos)"}}>{brl(totals.inc)}</span></div>
        <div className="kv"><span className="kk">Despesas</span><span className="vv num" style={{color:"var(--neg)"}}>{brl(totals.exp)}</span></div>
        <div className="kv"><span className="kk"><b>Resultado</b></span><span className="vv num" style={{fontSize:18,fontWeight:600,color:resultado>=0?"var(--pos)":"var(--neg)"}}>{brl(resultado)}</span></div>
        {totals.inv>0 && <div className="mm">Investido no mês: {brl(totals.inv)} (fora do resultado)</div>}
      </div>

      <div className="card g-6 homecard">
        <h3>Orçamento: as 3 mais apertadas <HelpIcon section="orcamento-ajuda"/></h3>
        {comLimite.length===0 && semLimite.length===0 && <p className="hint">Nenhuma despesa em {monthLabel} ainda.</p>}
        {comLimite.map(r=>(
          <div className="homebud" key={r.cat}>
            <div className="bh">
              <span className="bname"><Icon name={CAT_ICON[r.cat]||"outros"} size={15}/> {r.cat}</span>
              <span className="bval num">{brl(r.spent)} <span style={{color:"var(--text-mut)"}}>/ {brl(r.limit)} ({Math.round(r.pct*100)}%)</span></span>
            </div>
            <ProgressBar spent={r.spent} limit={r.limit} status={r.status}/>
            <StatusDot status={r.status}/>
          </div>
        ))}
        {semLimite.length>0 &&
          <React.Fragment>
            {semLimite.map(r=>(
              <div className="kv" key={r.cat}><span className="kk"><Icon name={CAT_ICON[r.cat]||"outros"} size={14}/> {r.cat}</span><span className="vv num">{brl(r.spent)}</span></div>
            ))}
            <p className="hint">Sem limites definidos ainda. <button type="button" className="saveretry" style={{fontSize:"inherit"}} onClick={()=>goToTab("orcamento")}>Definir orçamento</button></p>
          </React.Fragment>}
      </div>

      <div className="card g-6 homecard">
        <h3>Histórico recente <button type="button" className="sbtn" onClick={()=>goToTab("balanco")}>Ver todos</button></h3>
        {recentes.length===0 && <p className="hint">Nenhum movimento registrado ainda. Use "Novo movimento" para começar.</p>}
        <div className="recentlist">
          {recentes.map(t=>{
            const sinal=TYPES[t.type].sign;
            const cor=t.type==="ganho"?"var(--pos)":t.type==="gasto"?"var(--neg)":t.type==="investimento"?"var(--inv)":"var(--trf)";
            return (
              <button type="button" className="recentrow" key={t.id} onClick={()=>onOpenTx && onOpenTx(t)} aria-label={`Ver detalhes: ${t.description||t.category||TYPES[t.type].label}`}>
                <span className="rdate num">{t.date.slice(8,10)}/{t.date.slice(5,7)}</span>
                <span className="rcat">{t.type==="transferencia"?"Transferência":(t.category||TYPES[t.type].label)}<small>{t.description||""}</small></span>
                <span className="rval num" style={{color:cor}}>{sinal>0?"+":sinal<0?"−":"↔"} {brlNum(t.cents)}</span>
                <span className="rmeta">{paymentLabel(t, accounts)} · {nomeConta(t.acctId)}</span>
              </button>);
          })}
        </div>
      </div>
    </React.Fragment>
  );
}
HomeDashboard = React.memo(HomeDashboard);

export { HomeDashboard };
