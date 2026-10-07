/* components/tools/MonthReport.jsx — relatório do mês para imprimir / salvar como PDF. Fica fora do app
   (direto no <body>, com estilos próprios em styles/print.css): na impressão só ele aparece, em fundo branco. */
import React from "react";
import { TYPES, isRealized, paymentLabel } from "../../domain/types";
import { saldosPorConta } from "../../utils/calculations";
import { brl, fmtDateBR } from "../../utils/formatters";

const STATUS={ ok:"Dentro do limite", warn:"Atenção", over:"Estourado", none:"Sem limite" };

function MonthReport({ accounts, txs, monthItens, monthLabel, totals, budgetRows }){
  const itens=[...(monthItens||[])].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  const gastos=itens.filter(t=>t.type==="gasto" && isRealized(t));
  const porCat={};
  gastos.forEach(t=>{ porCat[t.category||"Outros"]=(porCat[t.category||"Outros"]||0)+t.cents; });
  const cats=Object.entries(porCat).sort((a,b)=>b[1]-a[1]);
  const totalGastos=cats.reduce((s,[,v])=>s+v,0);
  const contas=saldosPorConta(txs||[], accounts||[]);
  const nomeConta=(id)=>{ const a=(accounts||[]).find(x=>x.id===id); return a?a.name:"—"; };
  const resultado=totals.inc-totals.exp-totals.inv;
  const comLimite=(budgetRows||[]).filter(r=>r.limit>0);

  return (
    <div className="razao-print" aria-hidden="true">
      <header className="rp-head">
        <div>
          <h1>Relatório de {monthLabel}</h1>
          <p>Razão — controle financeiro · gerado em {fmtDateBR(new Date().toISOString().slice(0,10))}</p>
        </div>
      </header>

      <section className="rp-kpis">
        <div><small>Renda</small><b className="pos">{brl(totals.inc)}</b></div>
        <div><small>Despesas</small><b className="neg">{brl(totals.exp)}</b></div>
        <div><small>Investido</small><b>{brl(totals.inv)}</b></div>
        <div><small>Resultado</small><b className={resultado>=0?"pos":"neg"}>{brl(resultado)}</b></div>
      </section>
      <p className="rp-nota">Valores realizados; gasto no cartão conta no mês da fatura.{totals.previstoExp>0||totals.previstoInc>0?` Ainda previsto no mês: ${brl(totals.previstoInc)} de renda e ${brl(totals.previstoExp)} de despesa.`:""}</p>

      {comLimite.length>0 &&
        <section>
          <h2>Orçamento</h2>
          <table>
            <thead><tr><th>Categoria</th><th className="r">Orçado</th><th className="r">Gasto</th><th className="r">%</th><th>Status</th></tr></thead>
            <tbody>{comLimite.map(r=>(
              <tr key={r.cat}><td>{r.cat}</td><td className="r">{brl(r.limit)}</td><td className="r">{brl(r.spent)}</td><td className="r">{Math.round(r.pct*100)}%</td><td className={"st-"+r.status}>{STATUS[r.status]}</td></tr>
            ))}</tbody>
          </table>
        </section>}

      {cats.length>0 &&
        <section>
          <h2>Gastos por categoria</h2>
          <table>
            <thead><tr><th>Categoria</th><th className="r">Valor</th><th className="r">% do total</th></tr></thead>
            <tbody>{cats.map(([c,v])=>(
              <tr key={c}><td>{c}</td><td className="r">{brl(v)}</td><td className="r">{totalGastos?Math.round(v/totalGastos*100):0}%</td></tr>
            ))}</tbody>
          </table>
        </section>}

      <section>
        <h2>Saldos das contas</h2>
        <table>
          <thead><tr><th>Conta</th><th>Tipo</th><th className="r">Saldo</th></tr></thead>
          <tbody>{contas.map(a=>(
            <tr key={a.id}><td>{a.name}</td><td>{a.kind==="cartao"?"Cartão":"Conta"}{a.doBanco?" (saldo do banco)":""}</td><td className="r">{brl(a.saldo)}</td></tr>
          ))}</tbody>
        </table>
      </section>

      <section>
        <h2>Lançamentos ({itens.length})</h2>
        <table className="rp-mov">
          <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Pagamento</th><th className="r">Valor</th></tr></thead>
          <tbody>{itens.map(t=>{
            const tipo=TYPES[t.type]||TYPES.gasto;
            return (
              <tr key={t.id} className={isRealized(t)?"":"prev"}>
                <td>{fmtDateBR(t.date)}</td>
                <td>{t.description||"—"}{isRealized(t)?"":" (previsto)"}</td>
                <td>{t.type==="transferencia"?"Transferência":(t.category||"")}</td>
                <td>{t.type==="transferencia"?`${nomeConta(t.acctId)} → ${nomeConta(t.toAcctId)}`:nomeConta(t.acctId)}</td>
                <td>{t.type==="transferencia"?"":paymentLabel(t,accounts)}</td>
                <td className={"r "+(t.type==="ganho"?"pos":t.type==="transferencia"?"":"neg")}>{tipo.sign>0?"+":tipo.sign<0?"−":""}{brl(t.cents)}</td>
              </tr>);
          })}</tbody>
        </table>
      </section>
    </div>
  );
}

export { MonthReport };
