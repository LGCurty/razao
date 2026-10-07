import { describe, it, expect } from "vitest";
import { linhasMovimentos, paraCSV, paraXLSX, crc32, serialExcel, colLetra } from "./exporters";

const accounts = [{ id: "a1", name: "Nubank", bank: "Nubank", kind: "conta" }, { id: "c1", name: "Cartão; BTG", bank: "BTG Pactual", kind: "cartao" }];
const txs = [
  { id: "2", type: "gasto", cents: 8550, category: "Vida Diária", description: 'Mercado "bom" #casa', date: "2026-10-02", acctId: "c1", paymentMethod: "credito", source: "pluggy_sync" },
  { id: "1", type: "ganho", cents: 700000, category: "Salário Mensal", description: "Salário", date: "2026-10-01", acctId: "a1", status: "previsto" },
  { id: "3", type: "transferencia", cents: 5000, description: "Fatura", date: "2026-10-03", acctId: "a1", toAcctId: "c1" },
];

// lê um ZIP "stored" (o que o app gera): nome -> texto, conferindo o CRC de cada arquivo
function lerZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out = {};
  let o = 0;
  while (dv.getUint32(o, true) === 0x04034b50) {
    const crc = dv.getUint32(o + 14, true), tam = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true);
    const nome = dec.decode(bytes.slice(o + 30, o + 30 + nl));
    const dados = bytes.slice(o + 30 + nl, o + 30 + nl + tam);
    expect(crc32(dados)).toBe(crc);
    out[nome] = dec.decode(dados);
    o += 30 + nl + tam;
  }
  return out;
}

describe("exportação", () => {
  const linhas = linhasMovimentos(txs, accounts);
  it("ordena por data e põe o sinal certo no valor", () => {
    expect(linhas.map((l) => l[0].v)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(linhas.map((l) => l[9].v)).toEqual([7000, -85.5, -50]);
    expect(linhas[0][8].v).toBe("Previsto");
    expect(linhas[1][10].v).toBe("#casa");
    expect(linhas[1][11].v).toBe("Open Finance");
    expect(linhas[2][2].v).toBe(""); // transferência não tem categoria
  });
  it("CSV no padrão brasileiro, com aspas quando precisa", () => {
    const csv = paraCSV(linhas);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const l = csv.slice(1).split("\r\n");
    expect(l[0].startsWith("Data;Descrição;Categoria")).toBe(true);
    expect(l[2]).toContain('02/10/2026;"Mercado ""bom"" #casa";Vida Diária;Despesa;"Cartão; BTG"');
    expect(l[2]).toContain(";-85,50;");
  });
  it("XLSX: ZIP válido (CRC conferido) com planilha, estilos e dados tipados", () => {
    const zip = lerZip(paraXLSX(linhas));
    expect(Object.keys(zip).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = zip["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain(`<c r="A2" s="2"><v>${serialExcel("2026-10-01")}</v></c>`);
    expect(sheet).toContain('<c r="J3" s="3"><v>-85.5</v></c>');
    expect(sheet).toContain("Mercado &quot;bom&quot; #casa");
    expect(sheet).toContain('<autoFilter ref="A1:L4"/>');
  });
  it("auxiliares", () => {
    expect(serialExcel("1900-03-01")).toBe(61);
    expect(colLetra(0)).toBe("A");
    expect(colLetra(25)).toBe("Z");
    expect(colLetra(26)).toBe("AA");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
