// api/sync.js com o fetch simulado: nada sai para a rede (nem Supabase, nem Pluggy).
// Fica fora de api/ de propósito: tudo que está em api/ vira função publicada na Vercel.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.PLUGGY_CLIENT_ID = "id";
process.env.PLUGGY_CLIENT_SECRET = "segredo";
const sync = require("../api/sync.js");

const ITEM = "11111111-2222-3333-4444-555555555555";
const C1 = "aaaaaaaa-0000-0000-0000-000000000001";
const C2 = "aaaaaaaa-0000-0000-0000-000000000002";

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/* cenário: o que o "Pluggy" responde. falhasTx[conta] = quantas vezes /v2/transactions falha antes de dar certo
   (Infinity = sempre), com o código HTTP de falhaCodigo */
function montarFetch(cen) {
  const chamadas = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    const u = new URL(url);
    chamadas.push(u.pathname);
    if (u.pathname === "/auth/v1/user") return cen.semLogin ? json(401, {}) : json(200, { id: "u1", email: "eu@exemplo.com" });
    if (u.pathname === "/auth") return json(200, { apiKey: "k" });
    if (u.pathname === `/items/${ITEM}`) return cen.itemInexistente ? json(404, { message: "Item not found" }) : json(200, { id: ITEM, status: cen.itemStatus || "UPDATED", connector: { name: "Nubank", imageUrl: "x.png" } });
    if (u.pathname === "/accounts") return json(200, { results: cen.contas || [] });
    if (u.pathname === "/v2/transactions") {
      const conta = u.searchParams.get("accountId");
      cen.feitas = cen.feitas || {};
      cen.feitas[conta] = (cen.feitas[conta] || 0) + 1;
      const falhas = (cen.falhasTx || {})[conta] || 0;
      if (cen.feitas[conta] <= falhas) return json(cen.falhaCodigo || 503, { message: "Pluggy indisponível" });
      return json(200, { results: [{ id: "t-" + conta, amount: -10, type: "DEBIT", date: "2026-10-01" }], next: null });
    }
    return json(404, {});
  });
  return chamadas;
}

async function chamar(body, { headers = { authorization: "Bearer tok" }, method = "POST" } = {}) {
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await sync({ method, headers, body }, res);
  return res;
}

const contas = [{ id: C1, name: "Conta Corrente", balance: 100 }, { id: C2, name: "Cartão", type: "CREDIT" }];

describe("api/sync", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("statusFinal: success / partial / error", () => {
    expect(sync.statusFinal(2, 0)).toBe("success");
    expect(sync.statusFinal(2, 1)).toBe("partial");
    expect(sync.statusFinal(2, 2)).toBe("error");
    expect(sync.statusFinal(0, 0)).toBe("error");
  });

  it("todas as contas ok → success, com lançamentos por conta", async () => {
    montarFetch({ contas });
    const r = await chamar({ itemId: ITEM, from: "2026-09-01", to: "2026-10-06" });
    expect(r.code).toBe(200);
    expect(r.body.status).toBe("success");
    expect(Object.keys(r.body.transacoes).sort()).toEqual([C1, C2]);
    expect(r.body.item.connectorName).toBe("Nubank");
    expect(r.body.erros).toEqual([]);
  });

  it("uma conta falha mesmo com novas tentativas → partial, a outra vem", async () => {
    const cen = { contas, falhasTx: { [C2]: Infinity }, falhaCodigo: 400 }; // 400 não é passageiro: sem nova tentativa
    montarFetch(cen);
    const r = await chamar({ itemId: ITEM });
    expect(r.body.status).toBe("partial");
    expect(r.body.transacoes[C1]).toHaveLength(1);
    expect(r.body.transacoes[C2]).toBeUndefined();
    expect(r.body.erros).toEqual([expect.objectContaining({ accountId: C2, nome: "Cartão" })]);
    expect(cen.feitas[C2]).toBe(1);
  });

  it("falha passageira (503) ganha nova tentativa e se recupera → success", async () => {
    const cen = { contas: [contas[0]], falhasTx: { [C1]: 1 } };
    montarFetch(cen);
    const r = await chamar({ itemId: ITEM });
    expect(r.body.status).toBe("success");
    expect(cen.feitas[C1]).toBe(2);
  });

  it("todas falham → error", async () => {
    montarFetch({ contas: [contas[0]], falhasTx: { [C1]: Infinity }, falhaCodigo: 400 });
    const r = await chamar({ itemId: ITEM });
    expect(r.body.status).toBe("error");
    expect(r.body.error).toBeTruthy();
  });

  it("credencial vencida no banco → reconectar, sem buscar contas", async () => {
    const chamadas = montarFetch({ contas, itemStatus: "LOGIN_ERROR" });
    const r = await chamar({ itemId: ITEM });
    expect(r.body.status).toBe("reconectar");
    expect(r.body.itemStatus).toBe("LOGIN_ERROR");
    expect(chamadas).not.toContain("/accounts");
  });

  it("conexão que não existe mais → reconectar", async () => {
    montarFetch({ itemInexistente: true });
    const r = await chamar({ itemId: ITEM });
    expect(r.body.status).toBe("reconectar");
    expect(r.body.itemStatus).toBe("NOT_FOUND");
  });

  it("sem login → 401; itemId inválido → 400; GET → 405", async () => {
    montarFetch({ contas, semLogin: true });
    expect((await chamar({ itemId: ITEM })).code).toBe(401);
    expect((await chamar({ itemId: "../items" })).code).toBe(400);
    expect((await chamar({ itemId: ITEM, from: "ontem" })).code).toBe(400);
    expect((await chamar({}, { method: "GET" })).code).toBe(405);
  });
});
