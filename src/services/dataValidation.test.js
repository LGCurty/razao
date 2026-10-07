import { describe, it, expect } from "vitest";
import { migrate, SEED, SCHEMA_VERSION } from "./dataValidation";

const antigo = {
  theme: "dark",
  accounts: [{ id: "a1", name: "Conta BTG", kind: "conta" }, { id: "c1", name: "Cartão Nubank", kind: "cartao" }],
  transactions: [
    { id: "t1", type: "gasto", cents: 5000, category: "Alimentação", date: "2026-09-01", acctId: "a1" },
    { id: "t2", type: "gasto", cents: 3000, category: "Compras", date: "2026-09-02", acctId: "c1" },
    { id: "t3", type: "ganho", cents: 700000, category: "Salário", date: "2026-09-05", acctId: "a1" },
    { id: "t4", type: "ganho", cents: 1200, category: "Rendimento", date: "2026-09-06", acctId: "a1" },
  ],
  budgets: { "Alimentação": 50000, "Compras": 30000, "Lazer": 20000 },
  budgetExceptions: { "2026-12": { "Alimentação": 80000 } },
  categoryMemory: { mercado: "Alimentação" },
  goals: [{ id: "g1", name: "Reserva", target: 1, saved: 0, linkedCategory: "Rendimento" }],
};

describe("migrate()", () => {
  it("leva um backup antigo (sem schemaVersion) até a versão atual sem perder nada", () => {
    const d = migrate(antigo);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.transactions).toHaveLength(4);
    expect(d.accounts).toHaveLength(2);
    expect(d.transactions.every((t) => t.status === "realizado")).toBe(true);
  });

  it("converte as categorias antigas para as da planilha", () => {
    const d = migrate(antigo);
    expect(d.transactions.map((t) => t.category)).toEqual(["Vida Diária", "Vida Diária", "Salário Mensal", "Proventos"]);
    expect(d.categoryMemory.mercado).toBe("Vida Diária");
    expect(d.goals[0].linkedCategory).toBe("Proventos");
  });

  it("soma os limites de orçamento de categorias que viraram uma só", () => {
    const d = migrate(antigo);
    expect(d.budgets).toEqual({ "Vida Diária": 80000, Entretenimento: 20000 });
    expect(d.budgetExceptions["2026-12"]).toEqual({ "Vida Diária": 80000 });
  });

  it("deduz o banco pelo nome da conta", () => {
    const d = migrate(antigo);
    expect(d.accounts.map((a) => a.bank)).toEqual(["BTG Pactual", "Nubank"]);
  });

  it("é idempotente: rodar de novo não muda nada", () => {
    const uma = migrate(antigo);
    expect(migrate(JSON.parse(JSON.stringify(uma)))).toEqual(uma);
  });

  it("preenche os padrões de configuração", () => {
    const d = migrate({});
    expect(d.settings).toMatchObject({ pluggyReview: false, budgetAlerts: true, budgetNotify: false, emailSummary: false });
    expect(d.pluggy.items).toEqual([]);
    expect(SEED.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
