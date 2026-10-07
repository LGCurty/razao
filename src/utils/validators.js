/* utils/validators.js — validações e normalizações (datas, dígitos, carimbos de tempo, descrições). */
/* ---- impressão digital do documento ----
   O nome do banco no PDF nem sempre bate com o apelido que a pessoa deu à conta ("Nubank Conta" x
   "NU PAGAMENTOS S.A."), e um mesmo banco pode ter conta e cartão. Números não têm esse problema: o
   número da conta e o final do cartão identificam sem ambiguidade. Ao confirmar uma importação, esses
   números ficam guardados na conta (settings de cada conta, campo matchKeys) e passam a casar sozinhos
   nos meses seguintes — sem depender da IA acertar o apelido. */
const fpNorm = (s)=>String(s||"").replace(/[^0-9a-zA-Z]/g,"").toLowerCase();
const soDigitos = (s)=>String(s||"").replace(/\D/g,"");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// compara dois timestamps pelo instante real (epoch), não pela string: o Postgres/PostgREST costuma
// devolver o mesmo instante num formato de texto diferente do que enviamos (ex: "+00:00" em vez de "Z"),
// então comparar string com "!==" gera falso conflito a cada gravação.
const sameInstant = (a, b) => {
  if (a===b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a), tb = Date.parse(b);
  return !isNaN(ta) && !isNaN(tb) && ta===tb;
};
const normDesc = (s)=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");

export { fpNorm, soDigitos, DATE_RE, sameInstant, normDesc };
