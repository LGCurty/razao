/* utils/search.js — busca global de movimentos (descrição, categoria, conta, banco, tags e valor). */

// minúsculas e sem acento: "Alimentação" casa com "alimentacao"
const normalizar = (s)=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();

/* valor digitado como "85,50", "85.50", "R$ 1.200" ou "1200" → centavos; null se não for número */
function centavosDaBusca(q){
  const limpo=String(q||"").replace(/r\$\s*/i,"").trim();
  if(!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(limpo)) return null;
  const n = /,/.test(limpo) ? Number(limpo.replace(/\./g,"").replace(",",".")) : Number(limpo.replace(/\.(?=\d{3}(\D|$))/g,""));
  return Number.isFinite(n) ? Math.round(n*100) : null;
}

/* todas as palavras precisam aparecer em algum campo do movimento (busca "uber cartão" acha a corrida
   paga no cartão). Um número também casa pelo valor: inteiro (ex. "85") casa com 85,00 a 85,99; com
   centavos (ex. "85,50") casa exato. Mais recentes primeiro. */
function buscarMovimentos(txs, accounts, q, limite=50){
  const termo=normalizar(q);
  if(termo.length<2) return { itens:[], total:0 };
  const contas=Object.fromEntries((accounts||[]).map(a=>[a.id,a]));
  const cents=centavosDaBusca(q);
  const exato = cents!==null && /[.,]\d{1,2}$/.test(String(q).trim());
  const palavras=termo.split(/\s+/).filter(Boolean);
  const achados=(txs||[]).filter(t=>{
    if(cents!==null){
      if(exato ? t.cents===cents : (t.cents>=cents && t.cents<cents+100)) return true;
    }
    const a=contas[t.acctId], b=contas[t.toAcctId];
    const campos=normalizar([t.description, t.category, a&&a.name, a&&a.bank, b&&b.name, (t.tags||[]).join(" "), t.paymentMethod].join(" "));
    return palavras.every(p=>campos.includes(p));
  }).sort((x,y)=> x.date<y.date?1:x.date>y.date?-1:String(y.id).localeCompare(String(x.id)));
  return { itens:achados.slice(0,limite), total:achados.length };
}

export { normalizar, centavosDaBusca, buscarMovimentos };
