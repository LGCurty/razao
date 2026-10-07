/* services/supabaseService.js — Supabase: cliente, carregar/salvar o registro principal (finance_data) com detecção de conflito e o espelho nas tabelas relacionais. */
import { createClient } from "@supabase/supabase-js";
import { TYPES, isRealized } from "../domain/types";
import { SEED, migrate } from "./dataValidation";
import { saldosPorConta } from "../utils/calculations";
import { DATE_RE } from "../utils/validators";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://xgdigegpxnoybklmyeyq.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnZGlnZWdweG5veWJrbG15ZXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjA4MTQsImV4cCI6MjEwMDEzNjgxNH0.o9JxnQi-lj_BC_Ja6KZ9dxUyQUBO5ay6nIml5xqim6U";

const configured =
  SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("SEU-PROJETO") &&
  SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes("SUA-CHAVE");
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---- persistência ----
   loadData nunca cai silenciosamente em SEED por falha: falha de rede ou JSON corrompido
   sempre lança, para o chamador (App) mostrar uma tela de erro em vez de sobrescrever dados reais. */
async function loadData(userId){
  if (sb && userId){
    const { data, error } = await sb.from("finance_data").select("data,updated_at").eq("user_id",userId).maybeSingle();
    if (error) throw error;
    if (data && data.data) return { data: migrate(data.data), updatedAt: data.updated_at };
    const nowIso = new Date().toISOString();
    const { error: insErr } = await sb.from("finance_data").insert({ user_id:userId, data:SEED, updated_at:nowIso });
    if (insErr) throw insErr;
    return { data: SEED, updatedAt: nowIso };
  }
  const raw = localStorage.getItem("razao");
  if (!raw) return { data: SEED, updatedAt: null };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch(e){ throw new Error("Os dados salvos neste aparelho estão corrompidos e não puderam ser lidos: "+e.message); }
  return { data: migrate(parsed), updatedAt: null };
}
/* saveData verifica conflito (updated_at mais novo no servidor do que o esperado) antes de gravar,
   a menos que force=true. Lança em qualquer falha real, para o chamador tratar/tentar de novo.

   A checagem de conflito e a gravação são UMA operação só (UPDATE ... WHERE updated_at = esperado),
   não duas separadas (antes: SELECT pra conferir, DEPOIS UPSERT pra gravar). Com duas operações
   separadas, numa conexão lenta ou instável uma gravação atrasada podia passar pela checagem antes de
   outra terminar, e só efetivamente gravar DEPOIS — sobrescrevendo por cima em silêncio, sem conflito
   nenhum detectado (a checagem já tinha passado). Com o UPDATE condicional, o próprio Postgres só
   grava se o updated_at ainda for exatamente o esperado NAQUELE instante — sem essa janela aberta
   entre conferir e gravar. Se não bater (0 linhas afetadas), é conflito de verdade. */
async function saveData(userId, data, expectedUpdatedAt, force){
  if (sb && userId){
    const nowIso = new Date().toISOString();
    if (expectedUpdatedAt && !force){
      const { data: saved, error } = await sb.from("finance_data")
        .update({ data, updated_at:nowIso })
        .eq("user_id",userId).eq("updated_at",expectedUpdatedAt)
        .select("updated_at").maybeSingle();
      if (error) throw error;
      if (!saved) return { conflict:true }; // 0 linhas batidas: outra gravação já mudou o updated_at no meio do caminho
      return { conflict:false, updatedAt: saved.updated_at };
    }
    // pede de volta o updated_at tal como o Postgres o armazenou, para as próximas comparações
    // partirem do mesmo formato (evita falso conflito na comparação seguinte)
    const { data: saved, error } = await sb.from("finance_data").upsert({ user_id:userId, data, updated_at:nowIso }).select("updated_at").maybeSingle();
    if (error) throw error;
    return { conflict:false, updatedAt: (saved && saved.updated_at) || nowIso };
  }
  localStorage.setItem("razao", JSON.stringify(data));
  return { conflict:false, updatedAt: null };
}
/* checagem leve, só do carimbo de tempo — usada ao voltar o foco na aba, sem baixar os dados inteiros */
async function fetchServerUpdatedAt(userId){
  if (!sb || !userId) return null;
  const { data, error } = await sb.from("finance_data").select("updated_at").eq("user_id",userId).maybeSingle();
  if (error) throw error;
  return data ? data.updated_at : null;
}

/* ---- espelho relacional (tabelas bank_accounts, movements e budgets no Supabase) ----
   finance_data continua sendo a fonte principal. Depois de cada salvamento confirmado, a mesma informação
   vai, normalizada, para as tabelas relacionais (ver supabase/migrations) — só o que mudou desde a última
   vez, e o que sumiu daqui é apagado lá. Serve para consultar por SQL (Power BI, relatórios) e para a
   sincronização do Open Finance no servidor. Se as tabelas ainda não foram criadas, o espelho se desliga
   sozinho naquela sessão, sem erro nenhum para a pessoa. */
const MIRROR_TABLES=["bank_accounts","movements","budgets"];
const MIRROR_CHUNK=500;
function isMissingTableError(err){
  const m=String((err&&err.message)||"");
  return Boolean(err) && (err.code==="42P01" || err.code==="PGRST205" || /does not exist|could not find the table|schema cache/i.test(m));
}
const finalDaConta=(a)=>{ const k=(a.matchKeys||[])[0]; return k ? String(k).split(":").pop() : null; };
function mirrorRows(data, userId){
  const accounts=data.accounts||[], txs=data.transactions||[];
  const itens=(data.pluggy&&data.pluggy.items)||[];
  const bank_accounts=saldosPorConta(txs, accounts).map(a=>{
    const item=a.pluggyItemId ? itens.find(i=>i.id===a.pluggyItemId) : null;
    return { user_id:userId, id:String(a.id), name:a.name||"Conta", bank_name:a.bank||null, kind:a.kind==="cartao"?"cartao":"conta",
      account_number:finalDaConta(a), balance:a.saldo/100, opening_balance:(a.openingBalance||0)/100,
      pluggy_item_id:a.pluggyItemId||null, last_sync:(item&&item.lastSyncAt)||null,
      sync_status: item ? (item.lastError ? "error" : item.lastSyncAt ? "active" : "pending") : null,
      error_message:(item&&item.lastError)||null };
  });
  const extVistos=new Set();
  const movements=txs.filter(t=>t && t.id && TYPES[t.type] && DATE_RE.test(t.date||"")).map(t=>{
    // o índice único (usuário, external_id) não aceita repetição: um id do banco duplicado por dado antigo fica só no primeiro
    let ext=t.pluggyId||null;
    if(ext){ if(extVistos.has(ext)) ext=null; else extVistos.add(ext); }
    return { user_id:userId, id:String(t.id), bank_account_id:t.acctId||null, to_account_id:t.type==="transferencia"?(t.toAcctId||null):null,
      type:t.type, category:t.category||null, amount:(t.type==="ganho"?1:-1)*(t.cents||0)/100, payment_method:t.paymentMethod||null,
      date:t.date, description:t.description||null, status:isRealized(t)?"realizado":"previsto",
      source:t.source||(t.pluggyId?"pluggy_sync":"manual"), external_id:ext, series_id:t.seriesId||null };
  });
  const budgets=[];
  Object.entries(data.budgets||{}).forEach(([cat,v])=>{ if(v>0) budgets.push({ user_id:userId, id:`${cat}|padrao`, category:cat, limit_amount:v/100, month_year:"padrao" }); });
  Object.entries(data.budgetExceptions||{}).forEach(([mk,m])=>Object.entries(m||{}).forEach(([cat,v])=>{
    if(v>0) budgets.push({ user_id:userId, id:`${cat}|${mk}`, category:cat, limit_amount:v/100, month_year:mk });
  }));
  return { bank_accounts, movements, budgets };
}
async function mirrorFetchIds(table, userId){
  const ids=[];
  for(let de=0; de<200000; de+=1000){
    const { data, error }=await sb.from(table).select("id").eq("user_id",userId).range(de,de+999);
    if(error) throw error;
    (data||[]).forEach(r=>ids.push(r.id));
    if(!data || data.length<1000) break;
  }
  return ids;
}
async function syncMirror(userId, data, cache){
  if(!sb || !userId || !cache) return;
  if(cache.userId!==userId){ Object.assign(cache,{ userId, available:null, last:null, status:"", error:"", at:0 }); }
  if(cache.available===false) return;
  if(cache.running){ cache.pending=data; return; }
  cache.running=true;
  try{
    if(cache.available==null){
      const probe=await sb.from("movements").select("id").limit(1);
      if(probe.error){
        if(isMissingTableError(probe.error)){ cache.available=false; cache.status="ausente"; return; }
        throw probe.error;
      }
      cache.available=true;
      cache.last={};
      for(const t of MIRROR_TABLES) cache.last[t]=new Map((await mirrorFetchIds(t,userId)).map(id=>[id,null]));
    }
    const rows=mirrorRows(data,userId);
    for(const t of MIRROR_TABLES){
      const antes=cache.last[t], depois=new Map(), mudou=[];
      for(const r of rows[t]){ if(depois.has(r.id)) continue; const j=JSON.stringify(r); depois.set(r.id,j); if(antes.get(r.id)!==j) mudou.push(r); }
      const sumiram=[...antes.keys()].filter(id=>!depois.has(id));
      // apaga antes de gravar: um lançamento do banco removido e reimportado com outro id não esbarra no índice único
      for(let i=0;i<sumiram.length;i+=MIRROR_CHUNK){
        const { error }=await sb.from(t).delete().eq("user_id",userId).in("id",sumiram.slice(i,i+MIRROR_CHUNK));
        if(error) throw error;
      }
      for(let i=0;i<mudou.length;i+=MIRROR_CHUNK){
        const { error }=await sb.from(t).upsert(mudou.slice(i,i+MIRROR_CHUNK),{ onConflict:"user_id,id" });
        if(error) throw error;
      }
      cache.last[t]=depois;
    }
    cache.status="ok"; cache.error=""; cache.at=Date.now();
  }catch(err){
    cache.status="erro"; cache.error=(err&&err.message)||String(err);
    console.warn("Espelho relacional não sincronizou:", err);
  }finally{
    cache.running=false;
    if(cache.onChange) cache.onChange({ status:cache.status, error:cache.error, at:cache.at });
    if(cache.pending){ const proximo=cache.pending; cache.pending=null; syncMirror(userId, proximo, cache); }
  }
}

export { SUPABASE_URL, SUPABASE_ANON_KEY, configured, sb, loadData, saveData, fetchServerUpdatedAt, MIRROR_TABLES, MIRROR_CHUNK, isMissingTableError, finalDaConta, mirrorRows, mirrorFetchIds, syncMirror };
