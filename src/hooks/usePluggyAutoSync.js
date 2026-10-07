/* hooks/usePluggyAutoSync.js — hook da sincronização automática do Open Finance (ao abrir e a cada 6h, com novas tentativas). */
import React, { useEffect, useRef, useState } from "react";
import { toast } from "../components/common/Feedback";
import { PLUGGY_ITEM_STATUS, pluggyApi, pluggyRowCompleta, pluggyRowToTx, syncPluggyConnection } from "../services/pluggyService";
import { sb } from "../services/supabaseService";

/* ---- sincronização automática do Open Finance (Pluggy) ----
   Roda enquanto o app está aberto e logado: ao abrir, e a cada 5 minutos confere quais conexões
   passaram de 6h sem atualizar e busca só essas, em sequência. Falha de rede ou do banco ganha nova
   tentativa depois de 5 minutos, no máximo 3 seguidas — depois disso espera a próxima janela de 6h
   (ou um clique em "tentar de novo"). Conexão que exige ação da pessoa (senha trocada, consentimento
   vencido) não é tentada de novo sozinha: aparece como "reconectar". Sem internet, espera o "online".
   O que chega é gravado direto, sem duplicar (o id do lançamento no Pluggy é a chave). Lançamento ainda
   PENDENTE no banco fica para depois: pode mudar de valor ou sumir antes de ser efetivado.
   Com o app fechado nada roda — isso exigiria um agendamento no servidor com chave privilegiada. */
const AUTO_SYNC_HORAS=6;
const AUTO_SYNC_RETRY_MIN=5;
const AUTO_SYNC_MAX_TENTATIVAS=3;
function usePluggyAutoSync({ ativo, data, update }){
  const dataRef=useRef(data); dataRef.current=data;
  const updateRef=useRef(update); updateRef.current=update;
  const [configurado,setConfigurado]=useState(null);
  const [estado,setEstado]=useState({});   // itemId -> { fase:"sincronizando"|"ok"|"erro"|"reconectar", erro, em, novos }
  const [rodando,setRodando]=useState(false);
  const rodandoRef=useRef(false);
  const falhas=useRef({});                 // itemId -> { n, em } (falhas seguidas e quando foi a última)

  useEffect(()=>{
    if(!ativo) return;
    let cancelado=false;
    pluggyApi("status").then(r=>{ if(!cancelado) setConfigurado(Boolean(r.configurado)); })
      .catch(()=>{ if(!cancelado) setConfigurado(false); });
    return ()=>{ cancelado=true; };
  },[ativo]);

  async function sincronizarUma(conexao, opts){
    setEstado(s=>({...s,[conexao.id]:{...(s[conexao.id]||{}),fase:"sincronizando",erro:""}}));
    const d=dataRef.current;
    const jaImportados=new Set((d.transactions||[]).filter(t=>t.pluggyId).map(t=>t.pluggyId));
    try{
      const r=await syncPluggyConnection({ conexao, accounts:d.accounts, categoryMemory:d.categoryMemory, jaImportados, dias:opts&&opts.dias });
      const prontos=r.rows.filter(it=>pluggyRowCompleta(it) && !it.pendente).map(pluggyRowToTx);
      // quantos realmente entram (a gravação abaixo ainda filtra pelo estado mais recente)
      const conhecidosAgora=new Set((dataRef.current.transactions||[]).filter(t=>t.pluggyId).map(t=>t.pluggyId));
      const gravados=prontos.filter(t=>!t.pluggyId||!conhecidosAgora.has(t.pluggyId)).length;
      const agora=new Date().toISOString();
      updateRef.current(dd=>{
        const conhecidos=new Set(dd.transactions.filter(t=>t.pluggyId).map(t=>t.pluggyId));
        const add=prontos.filter(t=>!t.pluggyId||!conhecidos.has(t.pluggyId));
        const contasNovas=r.novas.filter(a=>!dd.accounts.some(x=>x.id===a.id));
        const daConexao=new Set(r.contasDaConexao||[]);
        const accounts=[...dd.accounts,...contasNovas].map(a=>{
          let n=a;
          if(daConexao.has(a.id) && a.pluggyItemId!==conexao.id) n={...n, pluggyItemId:conexao.id};
          if(r.saldos[a.id]!==undefined) n={...n, bankBalance:r.saldos[a.id], bankBalanceAt:agora};
          return n;
        });
        return {
          transactions:[...add,...dd.transactions],
          accounts,
          pluggy:{...dd.pluggy, items:dd.pluggy.items.map(i=>i.id===conexao.id
            ? {...i,lastSyncAt:agora,lastStatus:r.status,contas:r.contas.length,lastError:""} : i)},
        };
      });
      falhas.current[conexao.id]={n:0,em:0};
      setEstado(s=>({...s,[conexao.id]:{fase:"ok",erro:r.aviso||"",em:Date.now(),novos:gravados}}));
      return { ok:true, novos:gravados, contasNovas:r.novas };
    }catch(err){
      const f=falhas.current[conexao.id]||{n:0,em:0};
      falhas.current[conexao.id]={n:f.n+1,em:Date.now()};
      const reconectar=Boolean(err.reconectar);
      // só grava na conexão (e portanto no banco de dados) o que pede ação: reconectar, ou a última tentativa
      if(reconectar || f.n+1>=AUTO_SYNC_MAX_TENTATIVAS){
        updateRef.current(dd=>({pluggy:{...dd.pluggy,items:dd.pluggy.items.map(i=>i.id===conexao.id
          ? {...i,lastStatus:err.itemStatus||i.lastStatus,lastError:err.message||"Falha ao sincronizar."} : i)}}));
      }
      setEstado(s=>({...s,[conexao.id]:{fase:reconectar?"reconectar":"erro",erro:err.message||"Não foi possível buscar os dados do banco.",em:Date.now(),tentativas:f.n+1}}));
      return { ok:false, erro:err.message, reconectar };
    }
  }

  async function rodar(lista, manual, opts){
    if(rodandoRef.current || lista.length===0) return { ok:true, novos:0 };
    if(typeof navigator!=="undefined" && navigator.onLine===false){
      if(manual) toast("Sem conexão com a internet — a sincronização roda assim que ela voltar.","error");
      return { ok:false, erro:"Sem conexão com a internet." };
    }
    rodandoRef.current=true; setRodando(true);
    let novos=0; const erros=[], contas=[];
    try{
      for(const c of lista){
        const r=await sincronizarUma(c, opts);
        if(r.ok){ novos+=r.novos; contas.push(...(r.contasNovas||[])); } else erros.push(`${c.connectorName}: ${r.erro}`);
      }
    }finally{ rodandoRef.current=false; setRodando(false); }
    if(contas.length) toast(`${contas.length===1?"Conta criada":"Contas criadas"} automaticamente: ${contas.map(a=>a.name).join(", ")}.`,"success");
    if(novos>0) toast(`${novos} lançamento${novos===1?" novo":"s novos"} do banco ${novos===1?"salvo":"salvos"}.`,"success");
    else if(manual && erros.length===0) toast("Tudo em dia: nenhum lançamento novo nos bancos.","default");
    return erros.length ? { ok:false, erro:erros.join(" · "), novos } : { ok:true, novos };
  }

  // conexões "vencidas" (6h+ sem atualizar) e liberadas para tentar agora, respeitando a espera entre tentativas
  function elegiveis(){
    const agora=Date.now();
    return (dataRef.current.pluggy?.items||[]).filter(c=>{
      const st=PLUGGY_ITEM_STATUS[String(c.lastStatus||"").toUpperCase()];
      if(st && st.reconectar) return false; // espera a pessoa reconectar
      const velha=!c.lastSyncAt || (agora-new Date(c.lastSyncAt).getTime())>=AUTO_SYNC_HORAS*3600000;
      if(!velha) return false;
      const f=falhas.current[c.id];
      if(!f || f.n===0) return true;
      if(f.n<AUTO_SYNC_MAX_TENTATIVAS) return agora-f.em>=AUTO_SYNC_RETRY_MIN*60000;
      return agora-f.em>=AUTO_SYNC_HORAS*3600000;
    });
  }

  useEffect(()=>{
    if(!ativo || configurado!==true) return;
    const tick=()=>{ if(document.visibilityState==="hidden") return; const v=elegiveis(); if(v.length) rodar(v,false); };
    const t0=setTimeout(tick,1500); // um respiro depois de abrir: deixa o app terminar de carregar
    const iv=setInterval(tick,AUTO_SYNC_RETRY_MIN*60000);
    const onOnline=()=>setTimeout(tick,1000);
    const onVisible=()=>{ if(document.visibilityState==="visible") tick(); };
    window.addEventListener("online",onOnline);
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{ clearTimeout(t0); clearInterval(iv); window.removeEventListener("online",onOnline); document.removeEventListener("visibilitychange",onVisible); };
  },[ativo, configurado]);

  const items=(data && data.pluggy && data.pluggy.items)||[];
  const ultimaSync=items.reduce((m,i)=>i.lastSyncAt && (!m || i.lastSyncAt>m) ? i.lastSyncAt : m, "");
  return {
    configurado, ativo:Boolean(ativo && configurado), rodando, estado, ultimaSync,
    // manual: zera as falhas e roda já (uma conexão, ou todas)
    sincronizarAgora:(itemId, opts)=>{
      const lista=items.filter(i=>!itemId || i.id===itemId);
      lista.forEach(i=>{ falhas.current[i.id]={n:0,em:0}; });
      if(!ativo) return Promise.resolve({ ok:false, erro: !sb ? "Entre com a sua conta para sincronizar com o banco." : "Sincronização indisponível agora." });
      if(configurado===false) return Promise.resolve({ ok:false, erro:"Open Finance ainda não configurado no servidor." });
      return rodar(lista, true, opts);
    },
  };
}

export { AUTO_SYNC_HORAS, AUTO_SYNC_RETRY_MIN, AUTO_SYNC_MAX_TENTATIVAS, usePluggyAutoSync };
