import { describe, it, expect } from "vitest";
import { mapPluggyDocs, pluggyRowToTx, pluggyRowCompleta, pluggyCategoria, garantirContasPluggy } from "./pluggyService";

const ACC = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const contaBanco = { id: ACC, type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta Corrente", marketingName: "Nubank", number: "0001/12345-6", balance: 1850.25 };

describe("conversão do Pluggy", () => {
  it("cria a conta que ainda não existe, com o banco já preenchido", () => {
    const { accounts, novas } = garantirContasPluggy([contaBanco], [], "Nubank");
    expect(novas).toHaveLength(1);
    expect(accounts[0].bank).toBe("Nubank");
    expect(accounts[0].kind).toBe("conta");
  });

  it("DEBIT vira despesa, CREDIT vira renda, pendente é marcado e id já importado é ignorado", () => {
    const { accounts } = garantirContasPluggy([contaBanco], [], "Nubank");
    const txs = [
      { id: "p1", date: "2026-10-01T10:00:00Z", description: "SUPERMERCADO", amount: -85.5, type: "DEBIT", category: "Groceries", status: "POSTED" },
      { id: "p2", date: "2026-10-02T10:00:00Z", description: "SALARIO", amount: 7000, type: "CREDIT", category: "Salary", status: "POSTED" },
      { id: "p3", date: "2026-10-03T10:00:00Z", description: "UBER", amount: -23.9, type: "DEBIT", category: "Taxi", status: "PENDING" },
      { id: "p0", date: "2026-09-30T10:00:00Z", description: "ANTIGO", amount: -1, type: "DEBIT", status: "POSTED" },
    ];
    const { rows, ignorados } = mapPluggyDocs({ contas: [contaBanco], txPorConta: { [ACC]: txs }, accounts, categoryMemory: {}, conexao: { id: "item", connectorName: "Nubank" }, jaImportados: new Set(["p0"]) });
    expect(ignorados).toBe(1);
    const porId = Object.fromEntries(rows.map((r) => [r.pluggyId, r]));
    expect(porId.p1).toMatchObject({ type: "gasto", cents: 8550, category: "Vida Diária", pendente: false });
    expect(porId.p2).toMatchObject({ type: "ganho", cents: 700000, category: "Salário Mensal" });
    expect(porId.p3.pendente).toBe(true);
  });

  it("linha completa vira lançamento com origem pluggy_sync e o id do banco", () => {
    const it_ = { type: "gasto", cents: 100, category: "Outros", desc: "X", date: "2026-10-01", acctId: "a1", pluggyId: "p9" };
    expect(pluggyRowCompleta(it_)).toBe(true);
    expect(pluggyRowToTx(it_)).toMatchObject({ source: "pluggy_sync", pluggyId: "p9", description: "X", status: "realizado" });
    expect(pluggyRowCompleta({ ...it_, acctId: "" })).toBe(false);
    expect(pluggyRowCompleta({ ...it_, type: "transferencia", toAcctId: "a1" })).toBe(false);
  });

  it("memória de categorização vale mais que o palpite pela categoria do banco", () => {
    expect(pluggyCategoria("gasto", "Groceries", "Padaria do Zé", { "padaria do zé": "Entretenimento" })).toBe("Entretenimento");
    expect(pluggyCategoria("gasto", "Taxes", "IPVA", {})).toBe("Obrigações");
    expect(pluggyCategoria("gasto", "algo desconhecido", "?", {})).toBe("Outros");
  });
});
