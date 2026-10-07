/* domain/types.js — tipos de movimento (despesa, renda, investimento, transferência), previsto × realizado e métodos de pagamento. */
/* ---- referência ---- */
const TYPES = {
  gasto: { label: "Despesa", cls: "out", sign: -1 },
  ganho: { label: "Renda", cls: "in", sign: +1 },
  investimento: { label: "Investimento", cls: "inv", sign: -1 },
  transferencia: { label: "Transferência", cls: "trf", sign: 0 }, // não soma em Entradas/Saídas/Investido; afeta só o saldo por conta (lançamento em par)
};
// previsto × realizado: sem o campo (dado pré-migração) sempre foi tratado como já ocorrido.
// totais, históricos e gráficos usam só o realizado; a lista mostra os dois, o previsto atenuado.
/* método de pagamento de um movimento: o campo paymentMethod (preenchido no formulário); lançamentos
   antigos, sem o campo, mostram o que dá para deduzir da conta (cartão → crédito) */
const PAYMENT_METHODS = {
  pix:{label:"Pix"}, credito:{label:"Cartão de crédito"}, debito:{label:"Cartão de débito"},
  dinheiro:{label:"Dinheiro"}, boleto:{label:"Boleto"}, deposito:{label:"Depósito"}, ted:{label:"Transferência (TED/DOC)"},
};
function paymentMethodsFor(type){
  return type==="ganho" ? ["pix","deposito","ted","dinheiro"] : ["pix","credito","debito","dinheiro","boleto"];
}
function defaultPaymentMethod(type, conta){
  if(type==="ganho") return "pix";
  if(conta && conta.kind==="cartao") return "credito";
  return "pix";
}
function paymentLabel(t, accounts){
  if(t.paymentMethod && PAYMENT_METHODS[t.paymentMethod]) return PAYMENT_METHODS[t.paymentMethod].label;
  if(t.type==="transferencia") return "Transferência";
  const a=(accounts||[]).find(x=>x.id===t.acctId);
  if(a && a.kind==="cartao") return "Cartão de crédito";
  return "—";
}
const isRealized = (t)=>(t.status||"realizado")!=="previsto";

export { TYPES, PAYMENT_METHODS, paymentMethodsFor, defaultPaymentMethod, paymentLabel, isRealized };
