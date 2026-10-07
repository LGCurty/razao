import { describe, it, expect } from "vitest";
import { buscarMovimentos, centavosDaBusca, normalizar } from "./search";

const accounts = [{ id: "a1", name: "Nubank", bank: "Nubank" }, { id: "c1", name: "Cartão BTG", bank: "BTG Pactual" }];
const txs = [
  { id: "1", type: "gasto", cents: 8550, category: "Vida Diária", description: "Supermercado Bom Preço", date: "2026-10-01", acctId: "a1" },
  { id: "2", type: "gasto", cents: 2390, category: "Transporte", description: "Uber", date: "2026-10-03", acctId: "c1" },
  { id: "3", type: "ganho", cents: 700000, category: "Salário Mensal", description: "Salário", date: "2026-09-30", acctId: "a1" },
  { id: "4", type: "gasto", cents: 8599, category: "Alimentação", description: "Restaurante", date: "2026-08-10", acctId: "c1", tags: ["viagem"] },
];

describe("busca global", () => {
  it("ignora acento e maiúsculas", () => {
    expect(normalizar("Alimentação")).toBe("alimentacao");
    expect(buscarMovimentos(txs, accounts, "alimentacao").itens.map((t) => t.id)).toEqual(["4"]);
  });
  it("todas as palavras precisam casar, em qualquer campo (inclusive a conta)", () => {
    expect(buscarMovimentos(txs, accounts, "uber btg").itens.map((t) => t.id)).toEqual(["2"]);
    expect(buscarMovimentos(txs, accounts, "uber nubank").total).toBe(0);
  });
  it("valor inteiro casa com os centavos daquele real; com vírgula, exato", () => {
    expect(buscarMovimentos(txs, accounts, "85").itens.map((t) => t.id)).toEqual(["1", "4"]);
    expect(buscarMovimentos(txs, accounts, "85,50").itens.map((t) => t.id)).toEqual(["1"]);
    expect(buscarMovimentos(txs, accounts, "R$ 7.000").itens.map((t) => t.id)).toEqual(["3"]);
  });
  it("tags entram na busca; mais recente primeiro; menos de 2 letras não busca", () => {
    expect(buscarMovimentos(txs, accounts, "viagem").itens[0].id).toBe("4");
    expect(buscarMovimentos(txs, accounts, "a").total).toBe(0);
    expect(buscarMovimentos(txs, accounts, "nubank").itens.map((t) => t.id)).toEqual(["1", "3"]);
  });
  it("lê valores em formato brasileiro", () => {
    expect(centavosDaBusca("1.200,50")).toBe(120050);
    expect(centavosDaBusca("12.5")).toBe(1250);
    expect(centavosDaBusca("abc")).toBe(null);
  });
});
