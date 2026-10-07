/* utils/exporters.js — exportação de movimentos em CSV e Excel (.xlsx de verdade, sem biblioteca externa:
   o .xlsx é um ZIP de arquivos XML; aqui o ZIP é montado "sem compressão", que todo leitor aceita) e entrega
   do arquivo: no celular, pela folha de compartilhamento do aparelho (WhatsApp, Drive, e-mail…) quando ela
   aceita arquivos; senão, download normal. */
import { TYPES, isRealized, paymentLabel } from "../domain/types";
import { extractTags } from "./formatters";

const ORIGEM = { manual:"Manual", pluggy_sync:"Open Finance", importacao:"Importação" };
const CABECALHO = ["Data","Descrição","Categoria","Tipo","Conta","Conta destino","Banco","Forma de pagamento","Status","Valor (R$)","Tags","Origem"];

/* uma linha por movimento, já com os tipos certos: data, texto e dinheiro. Valor com sinal: renda positiva;
   despesa, investimento e transferência (saída da conta de origem) negativos — igual às tabelas relacionais. */
function linhasMovimentos(txs, accounts){
  const conta=(id)=>(accounts||[]).find(a=>a.id===id);
  const ordenados=[...(txs||[])].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:String(a.id).localeCompare(String(b.id)));
  return ordenados.map(t=>{
    const tipo=TYPES[t.type]||TYPES.gasto;
    const a=conta(t.acctId), b=conta(t.toAcctId);
    const valor=(t.type==="ganho"?1:-1)*t.cents/100;
    return [
      { t:"d", v:t.date },
      { t:"s", v:t.description||"" },
      { t:"s", v:t.type==="transferencia"?"":(t.category||"") },
      { t:"s", v:tipo.label },
      { t:"s", v:a?a.name:"" },
      { t:"s", v:b?b.name:"" },
      { t:"s", v:a&&a.bank&&a.bank!=="Outro"?a.bank:"" },
      { t:"s", v:t.type==="transferencia"?"":((paymentLabel(t,accounts)||"").replace(/^—$/,"")) },
      { t:"s", v:isRealized(t)?"Realizado":"Previsto" },
      { t:"m", v:valor },
      { t:"s", v:extractTags(t.description).map(x=>"#"+x).join(" ") },
      { t:"s", v:ORIGEM[t.source]||ORIGEM.manual },
    ];
  });
}

/* ---------- CSV (padrão brasileiro: ";" como separador e vírgula decimal; BOM para o Excel ler os acentos) ---------- */
function paraCSV(linhas, cabecalho=CABECALHO){
  const esc=(s)=>/[;"\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  const cel=(c)=>{
    if(c.t==="d"){ const [y,m,d]=String(c.v).split("-"); return `${d}/${m}/${y}`; }
    if(c.t==="m"||c.t==="n") return Number(c.v).toFixed(2).replace(".",",");
    return esc(String(c.v??""));
  };
  return "﻿"+[cabecalho.map(esc).join(";"), ...linhas.map(l=>l.map(cel).join(";"))].join("\r\n");
}

/* ---------- XLSX ---------- */
const xmlEsc=(s)=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"");
const colLetra=(i)=>{ let s=""; i++; while(i>0){ const r=(i-1)%26; s=String.fromCharCode(65+r)+s; i=Math.floor((i-1)/26); } return s; };
const serialExcel=(iso)=>{ const [y,m,d]=String(iso).split("-").map(Number); return (Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/86400000; };

function planilhaXML(linhas, cabecalho, larguras){
  const linhaXML=(cels, r, cabec)=>`<row r="${r}">`+cels.map((c,i)=>{
    const ref=colLetra(i)+r;
    if(cabec) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEsc(c)}</t></is></c>`;
    if(c.t==="d" && /^\d{4}-\d{2}-\d{2}$/.test(String(c.v))) return `<c r="${ref}" s="2"><v>${serialExcel(c.v)}</v></c>`;
    if(c.t==="m") return `<c r="${ref}" s="3"><v>${Number(c.v)}</v></c>`;
    if(c.t==="n") return `<c r="${ref}"><v>${Number(c.v)}</v></c>`;
    const v=String(c.v??"");
    return v ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>` : "";
  }).join("")+`</row>`;
  const ultima=colLetra(cabecalho.length-1)+(linhas.length+1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`+
    `<cols>${cabecalho.map((_,i)=>`<col min="${i+1}" max="${i+1}" width="${(larguras&&larguras[i])||14}" customWidth="1"/>`).join("")}</cols>`+
    `<sheetData>${linhaXML(cabecalho,1,true)}${linhas.map((l,i)=>linhaXML(l,i+2,false)).join("")}</sheetData>`+
    `<autoFilter ref="A1:${ultima}"/>`+
    `</worksheet>`;
}

const ESTILOS=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00;[Red]-&quot;R$&quot; #,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function paraXLSX(linhas, { cabecalho=CABECALHO, aba="Movimentos", larguras=[12,34,20,14,20,20,16,20,12,14,18,14] }={}){
  const arquivos=[
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(aba).slice(0,31)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xmlEsc(aba).slice(0,31)}'!$A$1:$${colLetra(cabecalho.length-1)}$${linhas.length+1}</definedName></definedNames></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", planilhaXML(linhas, cabecalho, larguras)],
    ["xl/styles.xml", ESTILOS],
  ];
  return zipSemCompressao(arquivos);
}

/* ---------- ZIP (método "stored": sem compressão, com CRC-32) ---------- */
let TABELA_CRC=null;
function crc32(bytes){
  if(!TABELA_CRC){
    TABELA_CRC=new Uint32Array(256);
    for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; TABELA_CRC[n]=c>>>0; }
  }
  let c=0xFFFFFFFF;
  for(let i=0;i<bytes.length;i++) c=TABELA_CRC[(c^bytes[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function zipSemCompressao(arquivos){
  const enc=new TextEncoder();
  const agora=new Date();
  const hora=(agora.getHours()<<11)|(agora.getMinutes()<<5)|(agora.getSeconds()>>1);
  const data=((agora.getFullYear()-1980)<<9)|((agora.getMonth()+1)<<5)|agora.getDate();
  const partes=[], central=[];
  let deslocamento=0;
  arquivos.forEach(([nome, conteudo])=>{
    const nomeB=enc.encode(nome), dados=typeof conteudo==="string"?enc.encode(conteudo):conteudo;
    const crc=crc32(dados);
    const local=new DataView(new ArrayBuffer(30));
    local.setUint32(0,0x04034b50,true); local.setUint16(4,20,true); local.setUint16(6,0x0800,true); local.setUint16(8,0,true);
    local.setUint16(10,hora,true); local.setUint16(12,data,true); local.setUint32(14,crc,true);
    local.setUint32(18,dados.length,true); local.setUint32(22,dados.length,true); local.setUint16(26,nomeB.length,true); local.setUint16(28,0,true);
    partes.push(new Uint8Array(local.buffer), nomeB, dados);
    const cen=new DataView(new ArrayBuffer(46));
    cen.setUint32(0,0x02014b50,true); cen.setUint16(4,20,true); cen.setUint16(6,20,true); cen.setUint16(8,0x0800,true); cen.setUint16(10,0,true);
    cen.setUint16(12,hora,true); cen.setUint16(14,data,true); cen.setUint32(16,crc,true); cen.setUint32(20,dados.length,true); cen.setUint32(24,dados.length,true);
    cen.setUint16(28,nomeB.length,true); cen.setUint16(30,0,true); cen.setUint16(32,0,true); cen.setUint16(34,0,true); cen.setUint16(36,0,true);
    cen.setUint32(38,0,true); cen.setUint32(42,deslocamento,true);
    central.push(new Uint8Array(cen.buffer), nomeB);
    deslocamento += 30+nomeB.length+dados.length;
  });
  const tamCentral=central.reduce((s,p)=>s+p.length,0);
  const fim=new DataView(new ArrayBuffer(22));
  fim.setUint32(0,0x06054b50,true); fim.setUint16(8,arquivos.length,true); fim.setUint16(10,arquivos.length,true);
  fim.setUint32(12,tamCentral,true); fim.setUint32(16,deslocamento,true);
  const tudo=[...partes, ...central, new Uint8Array(fim.buffer)];
  const out=new Uint8Array(tudo.reduce((s,p)=>s+p.length,0));
  let o=0; tudo.forEach(p=>{ out.set(p,o); o+=p.length; });
  return out;
}

/* ---------- entrega do arquivo ---------- */
const TIPOS_MIME={ csv:"text/csv;charset=utf-8", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
function baixar(conteudo, nome, mime){
  const blob=conteudo instanceof Blob ? conteudo : new Blob([conteudo],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
const podeCompartilhar=()=>{
  try{ return typeof navigator!=="undefined" && !!navigator.canShare && navigator.canShare({ files:[new File(["x"],"t.csv",{type:"text/csv"})] }); }
  catch(e){ return false; }
};
/* no celular abre a folha de compartilhamento; se a pessoa cancelar, não faz nada; sem suporte, baixa */
async function compartilharOuBaixar(conteudo, nome, mime, compartilhar){
  if(compartilhar && podeCompartilhar()){
    try{ await navigator.share({ files:[new File([conteudo], nome, { type:mime })], title:nome }); return "compartilhado"; }
    catch(e){ if(e && e.name==="AbortError") return "cancelado"; }
  }
  baixar(conteudo, nome, mime);
  return "baixado";
}

export { CABECALHO, linhasMovimentos, paraCSV, paraXLSX, crc32, zipSemCompressao, serialExcel, colLetra, TIPOS_MIME, baixar, podeCompartilhar, compartilharOuBaixar };
