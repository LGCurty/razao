import { describe, it, expect } from "vitest";
import { txEffectiveMonth, cardInvoiceNet, saldosPorConta, budgetRowsFor, splitCents } from "./calculations";

const cartao = { id: "c1", kind: "cartao", closingDay: 20, dueDay: 28 };
const conta = { id: "a1", kind: "conta", openingBalance: 100000 };

describe("txEffectiveMonth", () => {
  it("gasto no cartão depois do fechamento cai na fatura do mês seguinte", () => {
    expect(txEffectiveMonth({ type: "gasto", date: "2026-08-25", acctId: "c1" }, [cartao])).toBe("2026-09");
    expect(txEffectiveMonth({ type: "gasto", date: "2026-08-15", acctId: "c1" }, [cartao])).toBe("2026-08");
  });
  it("renda e conta corrente ficam no mês da data", () => {
    expect(txEffectiveMonth({ type: "ganho", date: "2026-08-25", acctId: "c1" }, [cartao])).toBe("2026-08");
    expect(txEffectiveMonth({ type: "gasto", date: "2026-08-25", acctId: "a1" }, [conta])).toBe("2026-08");
  });
  it("vira o ano em dezembro", () => {
    expect(txEffectiveMonth({ type: "gasto", date: "2026-12-25", acctId: "c1" }, [cartao])).toBe("2027-01");
  });
});

describe("saldosPorConta", () => {
  it("soma saldo inicial e lançamentos realizados; transferência é débito/crédito em par", () => {
    const txs = [
      { type: "ganho", cents: 50000, acctId: "a1" },
      { type: "gasto", cents: 2000, acctId: "a1" },
      { type: "gasto", cents: 9999, acctId: "a1", status: "previsto" },
      { type: "transferencia", cents: 10000, acctId: "a1", toAcctId: "c1" },
    ];
    const r = saldosPorConta(txs, [conta, cartao]);
    expect(r.find((a) => a.id === "a1").saldo).toBe(100000 + 50000 - 2000 - 10000);
    expect(r.find((a) => a.id === "c1").saldo).toBe(10000);
  });
  it("conta ligada ao banco usa o saldo informado pelo banco", () => {
    const r = saldosPorConta([{ type: "gasto", cents: 500, acctId: "a1" }], [{ ...conta, bankBalance: 185025 }]);
    expect(r[0].saldo).toBe(185025);
    expect(r[0].doBanco).toBe(true);
  });
});

describe("budgetRowsFor", () => {
  it("status por faixa: ok < 80% ≤ atenção < 100% ≤ estourou; exceção do mês vence o padrão", () => {
    const rows = budgetRowsFor(
      { Moradia: 1000, "Vida Diária": 1000, Transporte: 1000 },
      { "2026-10": { Transporte: 100 } },
      "2026-10",
      { Moradia: 1000, "Vida Diária": 850, Transporte: 50, Saúde: 10 },
      {}
    );
    const st = Object.fromEntries(rows.map((r) => [r.cat, r.status]));
    expect(st).toEqual({ Moradia: "over", "Vida Diária": "warn", Transporte: "ok", Saúde: "none" });
    expect(rows.find((r) => r.cat === "Transporte").isException).toBe(true);
  });
});

describe("cardInvoiceNet e splitCents", () => {
  it("pagamento por transferência abate a fatura", () => {
    const itens = [
      { type: "gasto", cents: 80000, acctId: "c1" },
      { type: "transferencia", cents: 50000, acctId: "a1", toAcctId: "c1" },
    ];
    expect(cardInvoiceNet(itens, "c1").net).toBe(30000);
  });
  it("parcelas somam exatamente o total", () => {
    const p = splitCents(10000, 3);
    expect(p.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(p).toHaveLength(3);
  });
});
