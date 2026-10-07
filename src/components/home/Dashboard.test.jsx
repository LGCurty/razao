// Componentes renderizados isoladamente (sem o App em volta), com os contextos que eles usam.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeDashboard } from "./Dashboard";
import { StatusDot } from "../common/StatusDot";
import { AuthProvider } from "../../context/AuthContext";
import { DataProvider } from "../../context/DataContext";

const texto = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");

describe("HomeDashboard", () => {
  const props = {
    txs: [
      { id: "1", type: "ganho", cents: 700000, category: "Salário Mensal", description: "Salário", date: "2026-10-01", acctId: "a1" },
      { id: "2", type: "gasto", cents: 120000, category: "Moradia", description: "Aluguel", date: "2026-10-02", acctId: "a1", paymentMethod: "boleto" },
    ],
    accounts: [{ id: "a1", name: "Conta", kind: "conta", bank: "BTG Pactual", openingBalance: 0 }],
    monthIndex: {}, vKey: "2026-10", monthLabel: "Outubro de 2026",
    totals: { inc: 700000, exp: 120000, inv: 0 },
    budgetRows: [{ cat: "Moradia", limit: 120000, spent: 120000, pct: 1, status: "over" }],
    pluggy: { items: [] },
  };
  const html = renderToStaticMarkup(
    <AuthProvider session={{ user: { email: "maria@exemplo.com" } }}>
      <DataProvider data={{}} update={() => {}} pluggySync={{ ativo: false, estado: {} }}>
        <HomeDashboard {...props}/>
      </DataProvider>
    </AuthProvider>
  );
  const t = texto(html);

  it("mostra os 4 cartões", () => {
    for (const titulo of ["Saldo total", "Outubro de 2026 em números", "as 3 mais apertadas", "Histórico recente"]) expect(t).toContain(titulo);
  });
  it("cumprimenta quem está logado (vindo do AuthContext)", () => {
    expect(t).toContain("Olá, maria");
  });
  it("calcula saldo e resultado", () => {
    expect(t).toContain("R$ 5.800,00"); // saldo da conta: 7.000 - 1.200
    expect(t).toContain("Resultado");
  });
  it("histórico mostra método e banco", () => {
    expect(t).toContain("Boleto · BTG Pactual");
  });
  it("sem banco conectado, oferece conectar", () => {
    expect(t).toContain("Conectar banco");
  });
});

describe("StatusDot", () => {
  it("traduz o status do orçamento", () => {
    expect(texto(renderToStaticMarkup(<StatusDot status="over"/>))).toContain("Limite atingido");
    expect(texto(renderToStaticMarkup(<StatusDot status="warn"/>))).toContain("Atenção");
    expect(texto(renderToStaticMarkup(<StatusDot status="ok"/>))).toContain("OK");
  });
});
