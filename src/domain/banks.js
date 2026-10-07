/* domain/banks.js — bancos oferecidos no cadastro de conta e como reconhecê-los pelo nome. */
// bancos oferecidos no cadastro de conta (os quatro da planilha primeiro)
const BANKS = ["BTG Pactual","Nubank","Bradesco","Itaú","Banco do Brasil","Caixa","Santander","Inter","C6 Bank","Mercado Pago","PicPay","Outro"];
const BANK_PATTERNS = [[/btg/i,"BTG Pactual"],[/nu ?bank|\bnu\b/i,"Nubank"],[/bradesco/i,"Bradesco"],[/ita[uú]/i,"Itaú"],[/banco do brasil|\bbb\b/i,"Banco do Brasil"],[/caixa/i,"Caixa"],[/santander/i,"Santander"],[/\binter\b/i,"Inter"],[/\bc6\b/i,"C6 Bank"],[/mercado ?pago/i,"Mercado Pago"],[/picpay/i,"PicPay"]];
const bancoDoNome = (txt)=>{ const m=BANK_PATTERNS.find(([re])=>re.test(String(txt||""))); return m ? m[1] : ""; };

export { BANKS, BANK_PATTERNS, bancoDoNome };
