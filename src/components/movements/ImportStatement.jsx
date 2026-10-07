/* components/movements/ImportStatement.jsx — Gastos › Importar do banco: leitura de PDFs/fotos/texto, revisão e aprovação. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { Money } from "../common/Input";
import { HelpIcon } from "../help/HelpIcon";
import { OpenFinance } from "./OpenFinance";
import { goToTab } from "../navigation/navEvents";
import { CATS } from "../../domain/categories";
import { TYPES } from "../../domain/types";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { aiModelId, analyzeDocumentWithAI, fileToBase64, localRowsFromText, mapAiDocument } from "../../services/geminiService";
import { extractPdfText, loadPdfJs } from "../../services/pdfService";
import { daysApart, todayISO } from "../../utils/dates";
import { brl, fmtBytes, fmtDateBR } from "../../utils/formatters";
import { uid } from "../../utils/ids";
import { normDesc } from "../../utils/validators";

/* ---------- EXTRATO INTELIGENTE ---------- */
const EXTRATO_LINE_RE=/(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
function parseExtratoText(text){
  const year=new Date().getFullYear();
  const out=[];
  text.split(/\n+/).forEach(raw=>{
    const line=raw.trim();
    if(!line)return;
    const m=line.match(EXTRATO_LINE_RE);
    if(!m)return;
    const [,dpart,desc,vpart]=m;
    const [dd,mm,yy]=dpart.split("/");
    const yr=yy?(yy.length===2?"20"+yy:yy):String(year);
    const iso=`${yr}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
    const neg=vpart.trim().startsWith("-");
    const num=parseFloat(vpart.replace(/-/g,"").replace(/\./g,"").replace(",","."));
    if(isNaN(num))return;
    const cents=Math.round(num*100);
    const type=neg?"gasto":"ganho";
    out.push({ id:uid(), date:iso, desc:desc.trim(), cents, type, category:CATS[type][CATS[type].length-1][0], acctId:"" });
  });
  return out;
}
/* ---------- IMPORTAR DO BANCO (importação em lote de extratos e faturas) ----------
   A ideia é chegar o mais perto possível de um "open finance manual": a pessoa joga TODOS os PDFs do mês
   (extratos das contas + faturas dos cartões) de uma vez, e o app cuida do resto — descobre de qual banco
   é cada documento, se é extrato ou fatura, casa com a conta cadastrada e classifica cada linha, separando
   gasto, entrada, investimento, pagamento de fatura e transferência entre bancos. Nada é salvo sem revisão. */

const DOC_PHASES = {
  fila:       { label:"Na fila",                  weight:0    },
  lendo:      { label:"Abrindo o arquivo",        weight:0.06 },
  ia:         { label:"IA lendo o documento",     weight:0.15 },
  conferindo: { label:"Conferindo os lançamentos",weight:0.92 },
  pronto:     { label:"Pronto",                   weight:1    },
  erro:       { label:"Falhou",                   weight:1    },
};
const DOC_TIPO_LABEL = { extrato:"Extrato", fatura:"Fatura", nota_corretagem:"Nota de corretagem", recibo:"Recibo", outro:"Documento" };
const MAX_DOC_BYTES = 3 * 1024 * 1024;
// só recusamos o que a IA claramente não consegue ler. Qualquer outra coisa (inclusive arquivo sem
// extensão e sem type, como vem de alguns pickers de nuvem) é aceita e tentada.
const NAO_LEGIVEL = /^(video|audio)\//i;
const NAO_LEGIVEL_EXT = /\.(zip|rar|7z|tar|gz|exe|dmg|apk|mp4|mov|avi|mkv|mp3|wav|m4a|docx?|xlsx?|pptx?|csv|txt)$/i;
// tipo real do arquivo: alguns pickers entregam type vazio — sem isso a IA receberia mime errado
const guessMime = (file)=>{
  if(file.type) return file.type;
  const n=(file.name||"").toLowerCase();
  if(/\.pdf$/.test(n)) return "application/pdf";
  if(/\.(jpg|jpeg)$/.test(n)) return "image/jpeg";
  if(/\.png$/.test(n)) return "image/png";
  if(/\.(heic|heif)$/.test(n)) return "image/heic";
  if(/\.webp$/.test(n)) return "image/webp";
  return "application/pdf"; // sem pista nenhuma, PDF é o palpite mais provável neste app
};
const VALOR_COR = { gasto:"var(--neg)", ganho:"var(--pos)", investimento:"var(--inv)", transferencia:"var(--trf)" };
/* ativos lidos de uma nota de corretagem: além de virarem lançamentos de investimento (o dinheiro que
   saiu da conta), eles podem entrar na carteira em Investimentos. Aqui a pessoa escolhe quais quer levar
   para lá — ativo que já existe na carteira tem o aporte somado em vez de duplicar a linha. */
function AtivosDaNota({ doc, update, onDone }){
  const [sel,setSel]=useState(()=>new Set((doc.meta.ativos||[]).filter(a=>a.selected).map(a=>a.id)));
  const ativos=doc.meta.ativos||[];
  const escolhidos=ativos.filter(a=>sel.has(a.id));
  const toggle=(id)=>setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  function adicionar(){
    if(!escolhidos.length) return;
    update(d=>{
      const holdings=[...(d.holdings||[])];
      escolhidos.forEach(a=>{
        // casa por ticker quando houver, senão pelo nome — evita criar "BTLG11" duas vezes
        const chave=(a.ticker||a.nome).toLowerCase();
        const i=holdings.findIndex(h=>(h.name||"").toLowerCase().includes(chave));
        if(i>=0) holdings[i]={ ...holdings[i], invested:holdings[i].invested+a.cents, current:holdings[i].current+a.cents };
        else holdings.push({ id:uid(), name:a.nome, cls:a.cls, invested:a.cents, current:a.cents });
      });
      return { holdings };
    });
    toast(`${escolhidos.length} ativo${escolhidos.length===1?"":"s"} na carteira.`,"success");
    onDone && onDone();
  }
  return (
    <div className="ativosnota">
      <div className="ativoshead">
        <b>{ativos.length} ativo{ativos.length===1?"":"s"} nesta nota</b>
        <span>Some na sua carteira em Investimentos, além de entrar como aporte no extrato.</span>
      </div>
      {ativos.map(a=>(
        <label className="ativorow" key={a.id}>
          <input type="checkbox" checked={sel.has(a.id)} onChange={()=>toggle(a.id)}/>
          <span className="an">{a.nome}{a.operacao==="venda" && <span className="tag warn" style={{marginLeft:6}}>venda</span>}</span>
          <span className="aq">{a.quantidade>0?`${a.quantidade} × ${brl(Math.round(a.cents/a.quantidade))}`:""}</span>
          <span className="acls">{a.cls}</span>
          <span className="av num">{brl(a.cents)}</span>
        </label>
      ))}
      <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
        <button className="sbtn primary" disabled={!escolhidos.length} onClick={adicionar}>
          <Icon name="investimentos" size={14}/> Adicionar {escolhidos.length} à carteira
        </button>
        <button className="sbtn" onClick={onDone}>Agora não</button>
      </div>
    </div>
  );
}

function Extrato({ accounts, update, txs, aiModel, pluggy, categoryMemory, autoSync, revisarAntes }){
  const [docs,setDocs]=useState([]);      // um por arquivo enviado, com status e progresso próprios
  const [items,setItems]=useState([]);    // lançamentos reconhecidos, cada um apontando para o docId de origem
  const [running,setRunning]=useState(false);
  const [dragOver,setDragOver]=useState(false);
  const [showText,setShowText]=useState(false);
  const [text,setText]=useState("");
  const fileRef=useRef(null);
  const cameraRef=useRef(null);
  const runningRef=useRef(false);
  const queueRef=useRef([]);   // fila real de processamento: aceita arquivos jogados enquanto outra leva roda
  const statusRef=useRef(null); // painel de status, trazido à vista assim que os arquivos chegam

  const patchDoc=(id,patch)=>setDocs(ds=>ds.map(d=>d.id===id?{...d,...patch}:d));

  // avanço "de dentro" do documento enquanto a IA pensa: a barra caminha em direção ao fim da fase (88%)
  // sem nunca alcançá-la, para não prometer conclusão antes da resposta chegar. Os saltos de verdade
  // (arquivo aberto, resposta recebida, documento pronto) são os que movem o número para valer.
  useEffect(()=>{
    if(!running) return;
    const t=setInterval(()=>{
      setDocs(ds=>ds.map(d=>d.status==="ia"?{...d,progress:Math.min(0.88,d.progress+(0.9-d.progress)*0.05)}:d));
    },400);
    return ()=>clearInterval(t);
  },[running]);

  const overall=useMemo(()=>{
    if(docs.length===0) return 0;
    return docs.reduce((s,d)=>s+Math.min(1,d.progress),0)/docs.length;
  },[docs]);
  const doneCount=docs.filter(d=>d.status==="pronto"||d.status==="erro").length;
  const errosCount=docs.filter(d=>d.status==="erro").length;
  const lidosCount=docs.filter(d=>d.status==="pronto").length;
  const tudoFalhou=docs.length>0 && errosCount===docs.length;
  const currentDoc=docs.find(d=>d.status!=="pronto"&&d.status!=="erro"&&d.status!=="fila");

  async function processOne(doc){
    patchDoc(doc.id,{status:"lendo",progress:DOC_PHASES.lendo.weight});
    let aiError="";
    try{
      const base64=await fileToBase64(doc.file);
      patchDoc(doc.id,{status:"ia",progress:DOC_PHASES.ia.weight});
      const res=await analyzeDocumentWithAI({
        base64, mimeType:guessMime(doc.file), fileName:doc.name, accounts, model:aiModelId(aiModel),
      });
      patchDoc(doc.id,{status:"conferindo",progress:DOC_PHASES.conferindo.weight});
      const { meta, rows }=mapAiDocument(res,accounts,doc.id);
      if(rows.length===0) throw new Error("A IA não encontrou nenhum lançamento neste arquivo.");
      setItems(prev=>[...prev,...rows]);
      patchDoc(doc.id,{status:"pronto",progress:1,meta,count:rows.length,file:null});
      return;
    }catch(err){
      aiError=err.message||"Falha ao analisar com IA.";
    }
    // rede de segurança: sem IA disponível, ainda dá para extrair o texto do PDF localmente e usar o
    // parser por regex (só reconhece gasto/ganho, sem identificar banco nem transferência)
    if(/pdf/i.test(doc.file?.type||"")||/\.pdf$/i.test(doc.name)){
      try{
        patchDoc(doc.id,{status:"conferindo",progress:DOC_PHASES.conferindo.weight});
        await loadPdfJs();
        const buf=await doc.file.arrayBuffer();
        const pdf=await window.pdfjsLib.getDocument({ data:buf }).promise;
        const extracted=await extractPdfText(pdf);
        const rows=localRowsFromText(extracted,doc.id,accounts);
        if(rows.length===0) throw new Error("Nenhuma linha reconhecida (o PDF pode ser uma imagem escaneada).");
        setItems(prev=>[...prev,...rows]);
        patchDoc(doc.id,{
          status:"pronto", progress:1, count:rows.length, file:null,
          aviso:`IA indisponível (${aiError}) — lido localmente, sem identificar banco nem transferências.`,
          meta:{ tipo:"outro", banco:"", contaId:accounts[0]?.id||"", contaAuto:false, periodoInicio:"", periodoFim:"", vencimento:"", totalDocumento:0, confianca:null, observacao:"", fonte:"local" },
        });
        return;
      }catch(localErr){
        patchDoc(doc.id,{status:"erro",progress:1,error:`${aiError} ${localErr.message||""}`.trim(),file:null});
        return;
      }
    }
    patchDoc(doc.id,{status:"erro",progress:1,error:aiError,file:null});
  }

  async function addFiles(fileList){
    const all=Array.from(fileList||[]);
    if(all.length===0) return;
    // ser tolerante aqui importa: picker de nuvem (Drive, iCloud, WhatsApp) entrega arquivo com type
    // vazio e às vezes sem extensão. Antes isso era recusado em silêncio e a pessoa ficava sem saber
    // por que "não aconteceu nada". Agora só recusamos o que claramente não dá pra ler, e o resto vai.
    const recusados=all.filter(f=>NAO_LEGIVEL.test(f.type)||NAO_LEGIVEL_EXT.test(f.name));
    const accepted=all.filter(f=>!recusados.includes(f));
    if(recusados.length) toast(`${recusados.length===1?"1 arquivo não pode ser lido":`${recusados.length} arquivos não podem ser lidos`}: ${recusados.map(f=>f.name).join(", ")}. Envie PDF, foto ou print.`,"error",{duration:7000});
    if(accepted.length===0) return;
    // o arquivo trafega em base64 (≈ +33%) dentro de um JSON; acima disso a função serverless recusa o corpo
    const grandes=accepted.filter(f=>f.size>MAX_DOC_BYTES);
    if(grandes.length) toast(`${grandes.length} arquivo(s) acima de 3 MB podem falhar na IA — separe em partes menores se der erro.`,"error");
    const novos=accepted.map(f=>({ id:uid(), name:f.name, size:f.size, file:f, status:"fila", progress:0, error:"", aviso:"", meta:null, count:0 }));
    setDocs(ds=>[...ds,...novos]);
    queueRef.current.push(...novos);
    // confirmação imediata de recebimento, antes de qualquer leitura: a pessoa precisa ver que o
    // arquivo chegou no mesmo instante em que escolheu, não só quando a IA terminar
    toast(`${accepted.length} arquivo${accepted.length===1?"":"s"} recebido${accepted.length===1?"":"s"}. Lendo…`,"success");
    setTimeout(()=>{ statusRef.current?.scrollIntoView({behavior:"smooth",block:"nearest"}); },60);
    if(runningRef.current) return; // já tem uma leva rodando: ela vai consumir estes também
    runningRef.current=true; setRunning(true);
    try{
      // um de cada vez: evita estourar a cota gratuita da IA e mantém o progresso legível
      while(queueRef.current.length) await processOne(queueRef.current.shift());
    }finally{
      runningRef.current=false; setRunning(false);
    }
  }

  function onDrop(e){
    e.preventDefault(); setDragOver(false);
    if(e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }
  function analisarTexto(){
    const rows=localRowsFromText(text,"manual",accounts);
    if(rows.length===0){ toast("Nenhuma linha reconhecida no texto colado.","error"); return; }
    const manualDoc={ id:"manual", name:"Texto colado", size:0, file:null, status:"pronto", progress:1, error:"", aviso:"", count:rows.length,
      meta:{ tipo:"outro", banco:"", contaId:accounts[0]?.id||"", contaAuto:false, periodoInicio:"", periodoFim:"", vencimento:"", totalDocumento:0, confianca:null, observacao:"", fonte:"local" } };
    setDocs(ds=>ds.some(d=>d.id==="manual") ? ds.map(d=>d.id==="manual"?manualDoc:d) : [...ds,manualDoc]);
    setItems(prev=>[...prev.filter(it=>it.docId!=="manual"),...rows]);
  }

  function updateItem(id,patch){ setItems(its=>its.map(it=>it.id===id?{...it,...patch}:it)); }
  function removeItem(id){ setItems(its=>its.filter(it=>it.id!==id)); }
  function removeDoc(id){ setItems(its=>its.filter(it=>it.docId!==id)); setDocs(ds=>ds.filter(d=>d.id!==id)); }
  function limparTudo(){ setItems([]); setDocs([]); setText(""); }

  // trocar a conta do documento reetiqueta todos os lançamentos dele de uma vez — inclusive o outro lado
  // das transferências, quando era o documento que ocupava aquela ponta
  function setDocAccount(docId,newAcct){
    const doc=docs.find(d=>d.id===docId);
    const old=doc?.meta?.contaId||"";
    patchDoc(docId,{meta:{...doc.meta,contaId:newAcct,contaAuto:false}});
    setItems(its=>its.map(it=>it.docId!==docId?it:({
      ...it,
      acctId: (it.acctId===old || (!it.acctId && it.type!=="transferencia")) ? newAcct : it.acctId,
      toAcctId: it.toAcctId===old ? newAcct : it.toAcctId,
    })));
  }

  // duplicata contra o histórico já salvo: mesma data, valor, tipo e descrição
  const dupHistorico=useMemo(()=>{
    const set=new Set();
    items.forEach(it=>{
      const dup=txs.some(t=>t.date===it.date&&t.cents===it.cents&&t.type===it.type&&normDesc(t.description)===normDesc(it.desc));
      if(dup) set.add(it.id);
    });
    return set;
  },[items,txs]);
  // duplicata ENTRE documentos: o caso clássico é o pagamento da fatura, que aparece tanto no extrato da
  // conta quanto na própria fatura do cartão. Mesmo valor, mesmo tipo, datas próximas, documentos diferentes.
  const dupEntreDocs=useMemo(()=>{
    const set=new Set(); const vistos=[];
    items.forEach(it=>{
      const tol=it.type==="transferencia"?3:0;
      const hit=vistos.find(v=>v.docId!==it.docId&&v.cents===it.cents&&v.type===it.type&&daysApart(v.date,it.date)<=tol
        &&(it.type==="transferencia"||normDesc(v.desc)===normDesc(it.desc)));
      if(hit) set.add(it.id); else vistos.push(it);
    });
    return set;
  },[items]);
  const isDup=(id)=>dupHistorico.has(id)||dupEntreDocs.has(id);
  // assim que um item é marcado como duplicata, ele sai da seleção sozinho (mas continua visível e aprovável)
  const dupApplied=useRef(new Set());
  useEffect(()=>{
    const novos=items.filter(it=>isDup(it.id)&&!dupApplied.current.has(it.id)).map(it=>it.id);
    if(novos.length===0) return;
    novos.forEach(id=>dupApplied.current.add(id));
    setItems(its=>its.map(it=>novos.includes(it.id)?{...it,selected:false}:it));
  },[dupHistorico,dupEntreDocs]);

  const itemOk=(it)=>it.acctId&&(it.type!=="transferencia"||(it.toAcctId&&it.toAcctId!==it.acctId));
  // no celular a lista viria com 8 campos por lançamento — uma fatura de 30 linhas viraria um rolo sem fim.
  // Cada item aparece resumido em duas linhas e só abre os campos quando a pessoa toca em "ajustar".
  // O que precisa de decisão (falta conta, falta destino da transferência) já nasce aberto.
  const isDesktop=useIsDesktop();
  const [expanded,setExpanded]=useState(()=>new Set());
  const toggleExpand=(id)=>setExpanded(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const nomeConta=(id)=>accounts.find(a=>a.id===id)?.name||"conta não escolhida";
  const prontos=items.filter(it=>it.selected&&itemOk(it));
  const pendentes=items.filter(it=>it.selected&&!itemOk(it));

  const resumo=useMemo(()=>{
    const s={gasto:0,ganho:0,investimento:0,transferencia:0,nTrf:0};
    items.filter(it=>it.selected).forEach(it=>{ s[it.type]+=it.cents; if(it.type==="transferencia") s.nTrf++; });
    return s;
  },[items]);

  function toTx(it){
    const base={ id:uid(), type:it.type, cents:it.cents, category:it.type==="transferencia"?"":it.category,
      description:it.desc, date:it.date, acctId:it.acctId, status: it.date>todayISO()?"previsto":"realizado" };
    if(it.type==="transferencia") base.toAcctId=it.toAcctId;
    // guarda o id do lançamento no Pluggy: é por ele que a próxima sincronização sabe que este
    // já entrou, mesmo que o banco reescreva a descrição depois de efetivar
    if(it.pluggyId) base.pluggyId=it.pluggyId;
    return base;
  }
  function aprovar(lista){
    if(lista.length===0) return;
    const entries=lista.map(toTx);
    // alimenta a memória de categorização com o que foi confirmado aqui: da próxima vez que essa mesma
    // descrição aparecer (na mão ou noutro extrato), a categoria já vem sugerida sem custar chamada de IA
    const memoria={};
    lista.forEach(it=>{ if(it.type!=="transferencia" && it.desc.trim()) memoria[it.desc.trim().toLowerCase()]=it.category; });
    // aprende a impressão digital: o número de conta/cartão do documento fica guardado na conta que a
    // pessoa confirmou, e no mês que vem o mesmo banco casa sozinho, sem depender do apelido bater
    const aprendidos={};
    new Set(lista.map(it=>it.docId)).forEach(docId=>{
      const doc=docs.find(d=>d.id===docId);
      const conta=doc?.meta?.contaId, keys=doc?.meta?.fingerprints||[];
      if(!conta || !keys.length) return;
      aprendidos[conta]=[...(aprendidos[conta]||[]),...keys];
    });
    update(d=>{
      // a sincronização automática pode ter gravado o mesmo lançamento do banco enquanto esta lista
      // esperava revisão — o id do Pluggy decide, na hora de gravar, o que ainda não existe
      const conhecidos=new Set(d.transactions.filter(t=>t.pluggyId).map(t=>t.pluggyId));
      const novos=entries.filter(t=>!t.pluggyId||!conhecidos.has(t.pluggyId));
      return {
      transactions:[...novos,...d.transactions],
      categoryMemory:{...(d.categoryMemory||{}),...memoria},
      accounts: Object.keys(aprendidos).length
        ? d.accounts.map(a=>aprendidos[a.id] ? { ...a, matchKeys:[...new Set([...(a.matchKeys||[]),...aprendidos[a.id]])] } : a)
        : d.accounts,
      };
    });
    const ids=new Set(lista.map(it=>it.id));
    setItems(its=>its.filter(it=>!ids.has(it.id)));
    toast(`${entries.length} lançamento${entries.length===1?"":"s"} importado${entries.length===1?"":"s"}.`,"success");
  }

  /* ---- ações em massa ----
     Sem isso, um extrato em que a IA não reconheceu a conta obriga a pessoa a abrir item por item e
     escolher a mesma conta dezenas de vezes. Aqui aplica de uma vez em tudo que está marcado,
     atravessando documentos diferentes. */
  const marcados=items.filter(it=>it.selected);
  function aplicarEmMassa(patch){
    const ids=new Set(marcados.map(it=>it.id));
    if(!ids.size) return;
    setItems(its=>its.map(it=>ids.has(it.id)?{...it,...patch(it)}:it));
  }
  function massaConta(acctId){
    if(!acctId) return;
    // em transferência, "a conta do lançamento" é a origem; o destino continua como está
    aplicarEmMassa(()=>({ acctId }));
    toast(`Conta aplicada a ${marcados.length} lançamento${marcados.length===1?"":"s"}.`,"success");
  }
  function massaCategoria(cat){
    if(!cat) return;
    const alvo=marcados.filter(it=>it.type!=="transferencia" && CATS[it.type].some(c=>c[0]===cat));
    if(!alvo.length){ toast("Nenhum item marcado aceita essa categoria.","error"); return; }
    const ids=new Set(alvo.map(it=>it.id));
    setItems(its=>its.map(it=>ids.has(it.id)?{...it,category:cat}:it));
    toast(`Categoria aplicada a ${alvo.length} lançamento${alvo.length===1?"":"s"}.`,"success");
  }

  const docsComItens=docs.filter(d=>items.some(it=>it.docId===d.id));
  // a IA casa o documento com a conta pelo NOME do banco. Enquanto as contas tiverem os nomes
  // genéricos que vêm de fábrica, esse casamento não tem como acontecer e a pessoa acaba
  // escolhendo a conta na mão em todo documento — vale avisar antes de ela perder tempo.
  const contasGenericas=accounts.filter(a=>/^(conta|cartão|cartao|conta principal|cartão de crédito|cartao de credito|carteira|banco)$/i.test((a.name||"").trim()));

  // ids de lançamento do Pluggy que já entraram no histórico: a sincronização usa isso para não
  // trazer de novo o que já foi importado, por mais que os períodos se sobreponham
  const pluggyIdsSalvos=useMemo(()=>new Set(txs.filter(t=>t.pluggyId).map(t=>t.pluggyId)),[txs]);

  /* resultado do Open Finance entra pela mesma porta dos arquivos: um "documento" por conta do banco,
     já pronto, e as linhas na mesma lista de revisão. Sincronizar de novo substitui o documento
     anterior daquela conta em vez de duplicá-lo. */
  function receberDoOpenFinance({ docs:novosDocs, rows:novasRows }){
    const ids=new Set(novosDocs.map(d=>d.id));
    setItems(prev=>[...prev.filter(it=>!ids.has(it.docId)),...novasRows]);
    setDocs(ds=>[...ds.filter(d=>!ids.has(d.id)),...novosDocs]);
    setTimeout(()=>{ statusRef.current?.scrollIntoView({behavior:"smooth",block:"nearest"}); },60);
  }

  return (
    <React.Fragment>
    <OpenFinance accounts={accounts} update={update} pluggy={pluggy} categoryMemory={categoryMemory}
      jaImportados={pluggyIdsSalvos} onResultado={receberDoOpenFinance} autoSync={autoSync} revisarAntes={revisarAntes}/>
    <div className="card" style={{marginTop:14}}>
      <h3>Importar do banco <HelpIcon section="extrato-ajuda"/></h3>
      <div className="sub">Jogue aqui tudo do mês de uma vez — extratos, faturas de cartão, notas de corretagem, recibos. Vale PDF, foto ou print de tela do app do banco. A IA descobre de qual banco é cada documento e separa gasto, entrada, investimento, pagamento de fatura e transferência entre os seus bancos. Nada entra no app antes de você revisar.</div>

      {contasGenericas.length>0 &&
        <div className="banner" style={{marginBottom:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <span style={{flex:1,minWidth:200}}>
            Antes de importar, vale renomear {contasGenericas.length===1?"a conta":"as contas"} {contasGenericas.map(a=>`"${a.name}"`).join(", ")} com o nome do banco de verdade
            (Nubank, Itaú, Inter, C6…). É por esse nome que a IA descobre sozinha a qual conta cada PDF pertence — com nome genérico, você teria que escolher em cada documento.
          </span>
          <button className="sbtn" onClick={()=>goToTab("contas")}><Icon name="banco" size={14}/> Renomear agora</button>
        </div>}

      {/* o painel de status ocupa o lugar do dropzone assim que os arquivos chegam: o retorno aparece
          exatamente onde a pessoa acabou de clicar, em vez de num cartão mais abaixo da página */}
      <div ref={statusRef}>
        {docs.length===0
          ? <div className={"dropzone"+(dragOver?" over":"")}
              onClick={()=>fileRef.current?.click()}
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={onDrop}
              role="button" tabIndex={0}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();fileRef.current?.click();}}}>
              <Icon name="documento" size={26} style={{opacity:.5}}/>
              <div className="dzt">Arraste os arquivos aqui ou clique para escolher</div>
              <div className="dzs">Pode mandar vários de uma vez: extrato do banco A, do banco B, fatura do cartão C, nota de corretagem…<br/>PDF, foto ou print de tela (JPG/PNG).</div>
            </div>
          : <React.Fragment>
              <div className="uploadpanel">
                <div className="uphead">
                  {running
                    ? <React.Fragment>
                        <div className="aiorb small"><i/><i/><i/><span className="core"/></div>
                        <div className="upheadtxt">
                          <b>Lendo {docs.length} documento{docs.length===1?"":"s"}</b>
                          <span>{doneCount} de {docs.length} concluído{doneCount===1?"":"s"}{currentDoc?` · ${DOC_PHASES[currentDoc.status].label}`:""}</span>
                        </div>
                        <span className="aipct">{Math.round(overall*100)}%</span>
                      </React.Fragment>
                    : tudoFalhou
                      ? <React.Fragment>
                          <span className="upcheck erro"><Icon name="alerta" size={16}/></span>
                          <div className="upheadtxt">
                            <b>Não foi possível ler {docs.length===1?"o documento":`os ${docs.length} documentos`}</b>
                            <span>O motivo aparece abaixo de cada arquivo. Você ainda pode lançar na mão ou tentar de novo.</span>
                          </div>
                        </React.Fragment>
                      : <React.Fragment>
                          <span className="upcheck"><Icon name="check" size={16}/></span>
                          <div className="upheadtxt">
                            <b>{lidosCount} de {docs.length} documento{docs.length===1?"":"s"} lido{lidosCount===1?"":"s"}</b>
                            <span>{items.length>0 ? `${items.length} lançamento${items.length===1?"":"s"} para revisar abaixo` : "Nenhum lançamento reconhecido"}{errosCount>0?` · ${errosCount} falhou`:""}</span>
                          </div>
                          <span className="aipct" style={{color:errosCount>0?"var(--warn)":"var(--pos)"}}>{Math.round((lidosCount/docs.length)*100)}%</span>
                        </React.Fragment>}
                </div>
                {running && <div className="aibar" style={{marginTop:10}}><i style={{width:`${Math.max(2,overall*100)}%`}}/><span/></div>}

                <div className="uplist">
                  {docs.map(d=>{
                    const lendo=["lendo","ia","conferindo"].includes(d.status);
                    return (
                      <div className={"uprow"+(d.status==="erro"?" erro":"")} key={d.id}>
                        <Icon name={d.meta?.tipo==="fatura"?"cartao":d.meta?.tipo==="nota_corretagem"?"investimentos":d.meta?.tipo==="recibo"?"camera":"documento"} size={15}
                          style={{color:d.status==="erro"?"var(--neg)":d.status==="pronto"?"var(--pos)":"var(--text-mut)",flex:"0 0 auto"}}/>
                        <div className="upinfo">
                          <div className="upname">{d.name} {d.size>0 && <span className="upsize">{fmtBytes(d.size)}</span>}</div>
                          {lendo && <div className="uprowbar"><i style={{width:`${Math.max(4,d.progress*100)}%`}}/></div>}
                        </div>
                        {d.status==="pronto" && <span className="dstat" style={{color:"var(--pos)"}}><Icon name="check" size={12}/> {d.count} lançamento{d.count===1?"":"s"}</span>}
                        {d.status==="erro" && <span className="dstat" style={{color:"var(--neg)"}}><Icon name="alerta" size={12}/> falhou</span>}
                        {d.status==="fila" && <span className="dstat">na fila</span>}
                        {lendo && <span className="dstat"><i className="dspin"/> {DOC_PHASES[d.status].label} · {Math.round(d.progress*100)}%</span>}
                        <button className="sbtn iconsbtn" aria-label={"Remover "+d.name} disabled={running} onClick={()=>removeDoc(d.id)}><Icon name="fechar" size={13}/></button>
                      </div>
                    );
                  })}
                </div>
                {docs.filter(d=>d.status==="erro").map(d=>(
                  <p className="hint" key={d.id} style={{color:"var(--neg)",marginTop:6}}>{d.name}: {d.error}</p>
                ))}
                {docs.filter(d=>d.aviso).map(d=>(
                  <p className="hint" key={d.id} style={{color:"var(--warn)",marginTop:6}}>{d.name}: {d.aviso}</p>
                ))}
              </div>
              <div className={"dropzone compact"+(dragOver?" over":"")}
                onClick={()=>fileRef.current?.click()}
                onDragOver={e=>{e.preventDefault();setDragOver(true);}}
                onDragLeave={()=>setDragOver(false)}
                onDrop={onDrop}
                role="button" tabIndex={0}
                onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();fileRef.current?.click();}}}>
                <Icon name="adicionar" size={15}/> Adicionar mais arquivos
              </div>
            </React.Fragment>}
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple style={{display:"none"}}
        onChange={e=>{addFiles(e.target.files); e.target.value="";}}/>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{display:"none"}}
        onChange={e=>{addFiles(e.target.files); e.target.value="";}}/>
      <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
        <button className="sbtn" onClick={()=>cameraRef.current?.click()}><Icon name="camera" size={14}/> Tirar foto</button>
        <button className="sbtn" onClick={()=>setShowText(v=>!v)}><Icon name="editar" size={14}/> {showText?"Esconder":"Colar texto"}</button>
        {(docs.length>0||items.length>0) && <button className="sbtn danger" onClick={limparTudo} disabled={running}>Limpar tudo</button>}
      </div>

      {showText &&
        <div style={{marginTop:12}}>
          <textarea className="fld" rows={5}
            style={{resize:"vertical",fontFamily:"'IBM Plex Mono',monospace",fontSize:13,marginBottom:8}}
            placeholder={"01/07/2026 Compra Mercado XYZ -150,00\n05/07/2026 PIX recebido 500,00"}
            value={text} onChange={e=>setText(e.target.value)}/>
          <button className="sbtn primary" onClick={analisarTexto} disabled={!text.trim()}>Analisar texto colado</button>
          <p className="hint">Leitura local, sem IA: uma linha por lançamento, no formato "DD/MM/AAAA descrição valor". Valor negativo vira gasto, positivo vira ganho.</p>
        </div>}
    </div>



    {items.length>0 &&
      <div className="card" style={{marginTop:14}}>
        <h3>Revisar e importar <span className="aipct">{prontos.length} de {items.length}</span></h3>
        <div className="sub">Confira o que a IA entendeu. Desmarque o que não quiser, ajuste conta, tipo e categoria — e importe tudo de uma vez.</div>
        <div className="stats" style={{marginBottom:14}}>
          <div className="stat"><div className="k"><Icon name="enviar" size={12}/>Gastos</div><div className="v" style={{color:"var(--neg)"}}>{brl(resumo.gasto)}</div></div>
          <div className="stat"><div className="k"><Icon name="baixar" size={12}/>Entradas</div><div className="v" style={{color:"var(--pos)"}}>{brl(resumo.ganho)}</div></div>
          <div className="stat"><div className="k"><Icon name="investimentos" size={12}/>Investido</div><div className="v" style={{color:"var(--inv)"}}>{brl(resumo.investimento)}</div></div>
          <div className="stat"><div className="k"><Icon name="transferencia" size={12}/>Transferências</div><div className="v" style={{color:"var(--trf)"}}>{resumo.nTrf} · {brl(resumo.transferencia)}</div></div>
        </div>
        {(dupHistorico.size>0||dupEntreDocs.size>0) &&
          <p className="hint" style={{color:"var(--warn)",marginTop:0,marginBottom:10}}>
            {dupHistorico.size>0 && <>{dupHistorico.size} item(ns) já existem no seu histórico. </>}
            {dupEntreDocs.size>0 && <>{dupEntreDocs.size} item(ns) aparecem em dois documentos ao mesmo tempo (típico do pagamento da fatura, que sai no extrato e chega na fatura). </>}
            Já vieram desmarcados — marque de novo se forem lançamentos legítimos e diferentes.
          </p>}
        {pendentes.length>0 &&
          <p className="hint" style={{color:"var(--warn)",marginTop:0,marginBottom:10}}>
            {pendentes.length} item(ns) marcados ainda estão sem conta (ou sem o destino da transferência) e não serão importados até você escolher.
          </p>}

        {marcados.length>0 &&
          <div className="massbar">
            <span className="masslabel"><Icon name="check" size={13}/> {marcados.length} marcado{marcados.length===1?"":"s"} — aplicar em todos:</span>
            <select className="fld" value="" aria-label="Aplicar conta a todos os marcados"
              onChange={e=>{ massaConta(e.target.value); e.target.value=""; }}>
              <option value="">Conta…</option>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name}{a.kind==="cartao"?" (cartão)":""}</option>)}
            </select>
            <select className="fld" value="" aria-label="Aplicar categoria a todos os marcados"
              onChange={e=>{ massaCategoria(e.target.value); e.target.value=""; }}>
              <option value="">Categoria…</option>
              {Object.entries(CATS).map(([tipo,cats])=>
                <optgroup key={tipo} label={TYPES[tipo].label}>
                  {cats.map(([name])=><option key={tipo+name} value={name}>{name}</option>)}
                </optgroup>)}
            </select>
            <button className="sbtn" onClick={()=>setItems(its=>its.map(it=>({...it,selected:false})))}>Desmarcar tudo</button>
          </div>}

        {docsComItens.map(doc=>{
          const docItems=items.filter(it=>it.docId===doc.id);
          const selDoc=docItems.filter(it=>it.selected);
          const acct=accounts.find(a=>a.id===doc.meta?.contaId);
          const tipo=doc.meta?.tipo||"outro";
          return (
            <div key={doc.id}>
              <div className="dochead">
                <span className={"badge "+tipo}>{DOC_TIPO_LABEL[tipo]}</span>
                <b style={{fontSize:13}}>{doc.meta?.banco||doc.name}</b>
                <span style={{fontSize:12,color:"var(--text-mut)"}}>
                  {doc.meta?.periodoInicio&&doc.meta?.periodoFim ? `${fmtDateBR(doc.meta.periodoInicio)} a ${fmtDateBR(doc.meta.periodoFim)} · ` : ""}
                  {docItems.length} lançamento{docItems.length===1?"":"s"}
                  {doc.meta?.totalDocumento>0 ? ` · total ${brl(doc.meta.totalDocumento)}` : ""}
                </span>
                <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontSize:12,color:"var(--text-mut)"}}>{tipo==="fatura"?"Cartão:":tipo==="nota_corretagem"?"Debita em:":"Conta:"}</span>
                  <select className="fld" style={{width:"auto",minWidth:150,padding:"7px 10px",fontSize:13}}
                    value={doc.meta?.contaId||""} onChange={e=>setDocAccount(doc.id,e.target.value)}>
                    <option value="">Escolher…</option>
                    {accounts.map(a=><option key={a.id} value={a.id}>{a.name}{a.kind==="cartao"?" (cartão)":""}</option>)}
                  </select>
                  <button className="sbtn" onClick={()=>setItems(its=>its.map(it=>it.docId===doc.id?{...it,selected:selDoc.length!==docItems.length}:it))}>
                    {selDoc.length===docItems.length?"Desmarcar todos":"Marcar todos"}
                  </button>
                </div>
              </div>
              <div className="docbody">
                {doc.meta?.observacao && <p className="hint" style={{marginTop:0,marginBottom:8}}>{doc.meta.observacao}{doc.meta.confianca!=null?` · confiança ${Math.round(doc.meta.confianca*100)}%`:""}</p>}
                {doc.meta?.contaVia==="numero" && <p className="hint" style={{marginTop:0,marginBottom:8,color:"var(--pos)"}}>Conta reconhecida pelo número, não pelo nome — este banco já foi importado antes.</p>}
                {doc.meta?.contaVia==="nova" && <p className="hint" style={{marginTop:0,marginBottom:8,color:"var(--pos)"}}>Conta criada automaticamente para esta conexão. Pode renomear em Configurações › Contas e bancos quando quiser.</p>}
                {doc.meta?.fonte==="pluggy" && <p className="hint" style={{marginTop:0,marginBottom:8,color:"var(--pos)"}}><Icon name="escudo" size={12}/> Veio direto do banco pelo Open Finance — nenhum arquivo, nenhuma digitação.</p>}
                {(doc.meta?.ativos||[]).length>0 && <AtivosDaNota doc={doc} update={update} onDone={()=>patchDoc(doc.id,{meta:{...doc.meta,ativos:[]}})}/>}
                {acct && tipo==="fatura" && acct.kind!=="cartao" &&
                  <p className="hint" style={{color:"var(--warn)",marginTop:0}}>Esta é uma fatura de cartão, mas a conta escolhida não é um cartão — os gastos vão entrar na conta bancária.</p>}
                {docItems.map(it=>{
                  const dup=isDup(it.id);
                  const falta=!itemOk(it);
                  const aberto=isDesktop||expanded.has(it.id)||falta;
                  return (
                    <div className={"itemrow"+(it.selected?"":" off")} key={it.id}>
                      <input type="checkbox" checked={it.selected} onChange={e=>updateItem(it.id,{selected:e.target.checked})} aria-label="Importar este lançamento"/>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="row2" style={{marginBottom:aberto?6:0,alignItems:"center"}}>
                          <span className="num" style={{fontSize:12,color:"var(--text-mut)",flex:"0 0 auto",minWidth:0}}>{fmtDateBR(it.date)}</span>
                          <span style={{fontSize:13,flex:"2 1 200px"}}>
                            {it.desc||"—"}
                            {dup && <span className="tag warn" style={{marginLeft:6}}>duplicata</span>}
                            {it.confidence!=null&&it.confidence<0.6 && <span className="tag warn" style={{marginLeft:6}}>conferir</span>}
                            {it.natureza==="pagamento_fatura" && <span className="tag ok" style={{marginLeft:6}}>pagamento de fatura</span>}
                            {(it.natureza==="transferencia_saida"||it.natureza==="transferencia_entrada") && <span className="tag ok" style={{marginLeft:6}}>entre bancos</span>}
                            {it.natureza==="estorno" && <span className="tag ok" style={{marginLeft:6}}>estorno</span>}
                          </span>
                          {aberto
                            ? <div style={{flex:"0 0 165px",minWidth:150}}><Money cents={it.cents} onChange={v=>updateItem(it.id,{cents:v})} small/></div>
                            : <span className="num" style={{flex:"0 0 auto",minWidth:0,fontSize:14,fontWeight:500,whiteSpace:"nowrap",color:VALOR_COR[it.type]}}>{brl(it.cents)}</span>}
                        </div>
                        {!aberto &&
                          <button type="button" className="itemsummary" onClick={()=>toggleExpand(it.id)}>
                            <span>{TYPES[it.type].label} · {it.type==="transferencia" ? `${nomeConta(it.acctId)} → ${nomeConta(it.toAcctId)}` : `${it.category} · ${nomeConta(it.acctId)}`}</span>
                            <b>ajustar</b>
                          </button>}
                        {aberto &&
                        <div className="row2" style={{marginBottom:0}}>
                          <select className="fld" value={it.type} onChange={e=>{
                            const type=e.target.value;
                            updateItem(it.id,{type,category:type==="transferencia"?"":CATS[type][0][0],toAcctId:type==="transferencia"?it.toAcctId:""});
                          }}>
                            {Object.entries(TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                          </select>
                          {it.type==="transferencia"
                            ? <React.Fragment>
                                <select className="fld" value={it.acctId} onChange={e=>updateItem(it.id,{acctId:e.target.value})}>
                                  <option value="">Sai de…</option>
                                  {accounts.map(a=><option key={a.id} value={a.id}>Sai de {a.name}</option>)}
                                </select>
                                <select className="fld" value={it.toAcctId||""} onChange={e=>updateItem(it.id,{toAcctId:e.target.value})}>
                                  <option value="">Entra em…</option>
                                  {accounts.map(a=><option key={a.id} value={a.id}>Entra em {a.name}</option>)}
                                </select>
                              </React.Fragment>
                            : <React.Fragment>
                                <select className="fld" value={it.category} onChange={e=>updateItem(it.id,{category:e.target.value})}>
                                  {CATS[it.type].map(([name])=><option key={name} value={name}>{name}</option>)}
                                </select>
                                <select className="fld" value={it.acctId} onChange={e=>updateItem(it.id,{acctId:e.target.value})}>
                                  <option value="">Conta…</option>
                                  {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                              </React.Fragment>}
                        </div>}
                        {aberto && !isDesktop && !falta && <button type="button" className="itemsummary" onClick={()=>toggleExpand(it.id)}><span/><b>recolher</b></button>}
                        {falta&&it.selected && <div className="hint" style={{color:"var(--warn)",marginTop:4}}>Falta escolher {it.type==="transferencia"?"as duas contas da transferência":"a conta"}.</div>}
                      </div>
                      <button className="sbtn iconsbtn" aria-label="Descartar" onClick={()=>removeItem(it.id)}><Icon name="excluir" size={13}/></button>
                    </div>
                  );
                })}
                <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                  <button className="sbtn primary" disabled={selDoc.filter(itemOk).length===0} onClick={()=>aprovar(selDoc.filter(itemOk))}>
                    <Icon name="check" size={14}/> Importar deste documento ({selDoc.filter(itemOk).length})
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        <button className="submit" onClick={()=>aprovar(prontos)} disabled={prontos.length===0}>
          <Icon name="check" size={16}/> Importar {prontos.length} lançamento{prontos.length===1?"":"s"} de {docsComItens.length} documento{docsComItens.length===1?"":"s"}
        </button>
      </div>}
    </React.Fragment>
  );
}
Extrato = React.memo(Extrato);

export { EXTRATO_LINE_RE, parseExtratoText, DOC_PHASES, DOC_TIPO_LABEL, MAX_DOC_BYTES, NAO_LEGIVEL, NAO_LEGIVEL_EXT, guessMime, VALOR_COR, AtivosDaNota, Extrato };
