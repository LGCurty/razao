import { describe, it, expect } from "vitest";
import { analisar, ultimosMeses } from "./analytics";

const accounts = [{ id: "a1", name: "Nubank", kind: "conta" }, { id: "c1", name: "Cartão", kind: "cartao" }];
const txs = [
  { id: "1", type: "gasto", cents: 10000, category: "Moradia", date: "2026-10-02", acctId: "a1" },
  { id: "2", type: "gasto", cents: 3000, category: "Transporte", date: "2026-10-03", acctId: "c1" },
  { id: "3", type: "gasto", cents: 2000, category: "Transporte", date: "2026-09-10", acctId: "a1" },
  { id: "4", type: "gasto", cents: 9999, category: "Moradia", date: "2026-10-04", acctId: "a1", status: "previsto" },
  { id: "5", type: "ganho", cents: 700000, category: "Salário Mensal", date: "2026-10-01", acctId: "a1" },
  { id: "6", type: "gasto", cents: 500, category: "Lazer", date: "2025-01-01", acctId: "a1" },
];
const base = { mesAtual: "2026-10" };

describe("análise interativa (filtros cruzados)", () => {
  it("lista os últimos meses do período", () => {
    expect(ultimosMeses("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
  it("só realizado e só o tipo escolhido, dentro do período", () => {
    const r = analisar(txs, accounts, { ...base, periodo: "6m" });
    expect(r.kpis.total).toBe(15000); // 10000 + 3000 + 2000 (sem o previsto, sem 2025, sem renda)
    expect(r.kpis.n).toBe(3);
    expect(r.porMes.map((m) => m.nome)).toHaveLength(6);
    expect(analisar(txs, accounts, { ...base, periodo: "tudo" }).kpis.total).toBe(15500);
    expect(analisar(txs, accounts, { ...base, tipo: "ganho" }).kpis.total).toBe(700000);
  });
  it("filtro de categoria não esconde as outras categorias, mas filtra conta e mês", () => {
    const r = analisar(txs, accounts, { ...base, categoria: "Transporte" });
    expect(r.porCategoria.map((c) => c.nome)).toEqual(["Moradia", "Transporte"]);
    expect(r.porConta.find((c) => c.chave === "c1").cents).toBe(3000);
    expect(r.porConta.find((c) => c.chave === "a1").cents).toBe(2000);
    expect(r.kpis.total).toBe(5000);
    expect(r.maiores.map((t) => t.id)).toEqual(["2", "3"]);
  });
  it("filtros combinados: conta + mês", () => {
    const r = analisar(txs, accounts, { ...base, conta: "a1", mes: "2026-10" });
    expect(r.kpis.total).toBe(10000);
    expect(r.kpis.maior.id).toBe("1");
    expect(r.porMes.find((m) => m.chave === "2026-09").cents).toBe(2000); // o gráfico de mês ignora o próprio filtro
  });
});
