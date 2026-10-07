import { describe, it, expect } from "vitest";
import { mirrorRows, isMissingTableError } from "./supabaseService";

describe("espelho relacional", () => {
  const data = {
    accounts: [{ id: "a1", name: "Conta", kind: "conta", bank: "Itaú", openingBalance: 10000 }],
    transactions: [
      { id: "t1", type: "ganho", cents: 700000, category: "Salário Mensal", date: "2026-10-01", acctId: "a1" },
      { id: "t2", type: "gasto", cents: 5050, category: "Vida Diária", date: "2026-10-02", acctId: "a1", paymentMethod: "pix", pluggyId: "px" },
      { id: "t3", type: "gasto", cents: 100, category: "Outros", date: "2026-10-02", acctId: "a1", pluggyId: "px" }, // id do banco repetido (dado antigo)
      { id: "t4", type: "transferencia", cents: 2000, date: "2026-10-03", acctId: "a1", toAcctId: "c1" },
      { id: "ruim", type: "gasto", cents: 1, date: "sem data", acctId: "a1" },
    ],
    budgets: { "Vida Diária": 50000 },
    budgetExceptions: { "2026-12": { "Vida Diária": 80000 } },
  };
  const r = mirrorRows(data, "u1");

  it("renda positiva, despesa e transferência negativas, em reais", () => {
    const m = Object.fromEntries(r.movements.map((x) => [x.id, x]));
    expect(m.t1.amount).toBe(7000);
    expect(m.t2.amount).toBe(-50.5);
    expect(m.t4).toMatchObject({ amount: -20, to_account_id: "c1", type: "transferencia" });
    expect(m.t2).toMatchObject({ payment_method: "pix", source: "pluggy_sync", external_id: "px" });
  });

  it("descarta lançamento sem data válida e não repete external_id", () => {
    expect(r.movements.some((x) => x.id === "ruim")).toBe(false);
    expect(r.movements.filter((x) => x.external_id === "px")).toHaveLength(1);
  });

  it("contas com banco e saldo; orçamentos padrão e do mês", () => {
    expect(r.bank_accounts[0]).toMatchObject({ id: "a1", bank_name: "Itaú", kind: "conta", user_id: "u1" });
    expect(r.budgets.map((b) => b.id).sort()).toEqual(["Vida Diária|2026-12", "Vida Diária|padrao"]);
  });

  it("reconhece o erro de tabela ainda não criada", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isMissingTableError({ code: "23505", message: "duplicate key" })).toBe(false);
  });
});
