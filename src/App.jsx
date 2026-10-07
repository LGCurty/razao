/* App.jsx — componente raiz: carrega e salva os dados, controla a navegação, o tempo real, os provedores de contexto e monta as telas. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AuthProvider } from "./context/AuthContext";
import { DataProvider } from "./context/DataContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ThemeToggle } from "./components/navigation/ThemeToggle";
import { Contas } from "./components/accounts/Accounts";
import { Perguntar } from "./components/assistant/Assistant";
import { Auth, RecoverySetPassword } from "./components/auth/Auth";
import { Orcamento } from "./components/budget/Budget";
import { ConfirmHost, SeriesScopeHost, ToastHost, toast } from "./components/common/Feedback";
import { BrandMark, Icon } from "./components/common/Icon";
import { Money } from "./components/common/Input";
import { ConflictDialog, LoadErrorScreen, SkeletonScreen } from "./components/common/Loading";
import { Sheet } from "./components/common/Modal";
import { Ajuda } from "./components/help/Manual";
import { WelcomeTour } from "./components/help/WelcomeTour";
import { HomeDashboard } from "./components/home/Dashboard";
import { Geral } from "./components/home/Panorama";
import { Metas } from "./components/investments/Goals";
import { Investimentos } from "./components/investments/Investments";
import { Extrato } from "./components/movements/ImportStatement";
import { Balanco } from "./components/movements/MovementList";
import { TransactionForm } from "./components/movements/NewMovementForm";
import { setHelpListener, setTabListener } from "./components/navigation/navEvents";
import { NAV_SECTIONS, sectionOfView } from "./components/navigation/sections";
import { APP_BUILD, APP_VERSION } from "./config";
import { CAT_COLOR } from "./domain/categories";
import { COLOR_THEMES, COLOR_THEME_MAP } from "./domain/themes";
import { TYPES, isRealized } from "./domain/types";
import { useBudgetAlerts } from "./hooks/useBudgetAlerts";
import { useIsDesktop } from "./hooks/useIsDesktop";
import { usePluggyAutoSync } from "./hooks/usePluggyAutoSync";
import { SEED, migrate } from "./services/dataValidation";
import { AI_MODELS } from "./services/geminiService";
import { fetchServerUpdatedAt, loadData, saveData, sb, syncMirror } from "./services/supabaseService";
import { budgetRowsFor, txEffectiveMonth } from "./utils/calculations";
import { MONTH_NAMES, todayISO } from "./utils/dates";
import { capFirst, fmtDateBR, tempoDesde } from "./utils/formatters";
import { sameInstant } from "./utils/validators";

function App(){
  const [session,setSession]=useState(null);
  const [authReady,setAuthReady]=useState(!sb); // sem supabase, pula auth
  const [recovery,setRecovery]=useState(false); // veio de um link de "esqueci minha senha"
  const [loadStatus,setLoadStatus]=useState("carregando"); // carregando|ok|erro
  const [loadError,setLoadError]=useState("");
  const [loadNonce,setLoadNonce]=useState(0); // incrementar força uma nova tentativa de carga
  const [data,setData]=useState(SEED);
  const { transactions:txs, accounts, budgets, budgetExceptions, goals, holdings, categoryMemory, patrimonyHistory, recaps, settings, pluggy } = data;
  const theme = data.theme || "dark";
  const isDesktop = useIsDesktop();
  const loaded = loadStatus==="ok"; // compat: usado pelas abas como "dados prontos"

  const [view,setView]=useState(new Date());
  const [tab,setTab]=useState("geral");
  // última tela vista em cada seção: voltar pra "Gastos" reabre "Importar do banco" se era lá que a pessoa estava
  const [lastView,setLastView]=useState({});
  useEffect(()=>{ const sec=sectionOfView(tab); setLastView(m=>m[sec.key]===tab?m:{...m,[sec.key]:tab}); },[tab]);
  const curSection=sectionOfView(tab);
  const goSection=(sec)=>setTab(lastView[sec.key]||sec.views[0][0]);
  const [helpTarget,setHelpTarget]=useState(null);
  // filtro pendente pra aplicar assim que a aba de destino abrir (ver goToTab) — ex: clicar numa
  // categoria no Panorama chega no Balanço já com aquela categoria filtrada na lista
  const [pendingFilter,setPendingFilter]=useState(null);
  useEffect(()=>{ setHelpListener((sectionId)=>{ setHelpTarget(sectionId); setTab("ajuda"); }); return ()=>setHelpListener(null); },[]);
  useEffect(()=>{ setTabListener((t,filter)=>{ setTab(t); if(filter) setPendingFilter(filter); }); return ()=>setTabListener(null); },[]);
  // popover do mês e menu "⋯" são mutuamente exclusivos por construção (só um valor guardado);
  // setMonthPicker/setMenu abaixo são compatíveis com o uso anterior (booleano ou função de toggle)
  const [activePopover,setActivePopover]=useState(null); // "month" | "menu" | null
  const monthPicker = activePopover==="month";
  const menu = activePopover==="menu";
  function setMonthPicker(v){ setActivePopover(p=>{ const next = typeof v==="function" ? v(p==="month") : v; return next?"month":(p==="month"?null:p); }); }
  function setMenu(v){ setActivePopover(p=>{ const next = typeof v==="function" ? v(p==="menu") : v; return next?"menu":(p==="menu"?null:p); }); }
  const monthTriggerRef=useRef(null);
  const monthPopRef=useRef(null);
  const menuTriggerRef=useRef(null);
  const menuPopRef=useRef(null);
  // fecha ao clicar fora, com Esc (devolvendo o foco ao botão que abriu), ou ao abrir o outro popover
  useEffect(()=>{
    if(!activePopover) return;
    const popRef = activePopover==="month"?monthPopRef:menuPopRef;
    const triggerRef = activePopover==="month"?monthTriggerRef:menuTriggerRef;
    function onDocMouseDown(e){
      if(popRef.current && popRef.current.contains(e.target)) return;
      if(triggerRef.current && triggerRef.current.contains(e.target)) return;
      setActivePopover(null);
    }
    function onKeyDown(e){
      if(e.key==="Escape"){ setActivePopover(null); triggerRef.current?.focus(); }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return ()=>{
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  },[activePopover]);
  // aviso de versão nova: quem chama é o registro do service worker (no fim do arquivo), assim que
  // termina de baixar um build mais recente. Nada recarrega sozinho — a decisão é de quem está usando,
  // pra não perder o que estiver sendo digitado no meio de um lançamento.
  const [novaVersao,setNovaVersao]=useState(false);
  useEffect(()=>{
    window.__razaoNovaVersao=()=>setNovaVersao(true);
    return ()=>{ delete window.__razaoNovaVersao; };
  },[]);
  const [pickerYear,setPickerYear]=useState(view.getFullYear());
  const [scrolled,setScrolled]=useState(false);
  const [saveState,setSaveState]=useState("idle"); // idle|saving|saved|erro
  const [conflict,setConflict]=useState(null); // {message} quando há dados mais novos no servidor

  // sheet do formulário de lançamento (mobile) — controlado aqui pra poder abrir a partir do FAB em qualquer aba
  const [sheetOpen,setSheetOpen]=useState(false);
  const [sheetEditTx,setSheetEditTx]=useState(null);
  const [sheetPropagateIds,setSheetPropagateIds]=useState([]);
  const fabRef=useRef(null);
  const fabDeskRef=useRef(null);
  function openAdd(){ setSheetEditTx(null); setSheetPropagateIds([]); setSheetOpen(true); }
  function openEditMobile(t,propagateIds){ setSheetEditTx(t); setSheetPropagateIds(propagateIds||[]); setSheetOpen(true); }

  const fileRef=useRef(null);
  const saveTimer=useRef(null);
  const retryTimer=useRef(null);
  const saveInFlightRef=useRef(false);   // um salvamento está a caminho do servidor agora
  const mirrorRef=useRef({});            // estado do espelho relacional (tabelas do Supabase)
  const [mirrorStatus,setMirrorStatus]=useState({ status:"", error:"", at:0 });
  mirrorRef.current.onChange=setMirrorStatus;
  const skipNextSaveRef=useRef(false);   // os dados acabaram de VIR do servidor: não há o que salvar de volta
  const lastKnownUpdatedAtRef=useRef(null);
  const dirtyRef=useRef(false); // há alteração ainda não confirmada como salva (para o aviso de beforeunload)
  const [offlineReadOnly,setOfflineReadOnly]=useState(false); // sem conexão: abre com o último estado salvo, sem gravar nada

  useEffect(()=>{
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme==="dark"?"#08090D":"#F6F7F9");
  },[theme]);
  useEffect(()=>{
    const onScroll=()=>setScrolled(window.scrollY>4);
    window.addEventListener("scroll",onScroll,{passive:true});
    return ()=>window.removeEventListener("scroll",onScroll);
  },[]);

  // auth — inclui o evento PASSWORD_RECOVERY (usuário clicou no link de "esqueci minha senha")
  useEffect(()=>{
    if(!sb) return;
    sb.auth.getSession().then(({data})=>{ setSession(data.session); setAuthReady(true); });
    const { data:sub } = sb.auth.onAuthStateChange((event,s)=>{
      setSession(s);
      if(event==="PASSWORD_RECOVERY") setRecovery(true);
    });
    return ()=>sub.subscription.unsubscribe();
  },[]);

  // carregar — nunca cai em SEED por falha: erro vira tela dedicada (LoadErrorScreen), sem sobrescrever nada
  useEffect(()=>{
    if(!authReady) return;
    if(sb && !session){ setLoadStatus("carregando"); return; }
    const userId = session ? session.user.id : null;
    let cancelled=false;
    setLoadStatus("carregando"); setLoadError(""); setOfflineReadOnly(false);
    (async()=>{
      try{
        const { data: loadedData, updatedAt } = await loadData(userId);
        if(cancelled) return;
        setData(loadedData);
        lastKnownUpdatedAtRef.current = updatedAt;
        dirtyRef.current = false;
        setLoadStatus("ok");
        // espelha um instantâneo somente-leitura no aparelho: se a rede cair numa próxima abertura,
        // é isso que permite abrir com o último estado conhecido em vez de uma tela de erro
        if(sb && userId){ try{ localStorage.setItem("razao_offline_cache", JSON.stringify({ data:loadedData, cachedAt:Date.now() })); }catch(_){} }
      }catch(e){
        console.error(e);
        if(cancelled) return;
        // falha de rede específica (não um erro do servidor/permissão): se houver um instantâneo salvo
        // de uma sessão anterior, abre com ele em modo somente leitura em vez de mostrar erro — sem
        // gravar nada, pra não arriscar sobrescrever o servidor com dados desatualizados.
        const looksOffline = !navigator.onLine || /fetch|network|Failed to fetch/i.test(e?.message||"");
        if(looksOffline && sb && userId){
          try{
            const cached = JSON.parse(localStorage.getItem("razao_offline_cache")||"null");
            if(cached && cached.data){
              setData(migrate(cached.data));
              lastKnownUpdatedAtRef.current = null;
              dirtyRef.current = false;
              setOfflineReadOnly(true);
              setLoadStatus("ok");
              return;
            }
          }catch(_){}
        }
        setLoadError(e.message||"Falha desconhecida ao carregar os dados.");
        setLoadStatus("erro");
      }
    })();
    return ()=>{ cancelled=true; };
  },[authReady, session, loadNonce]);

  // ao voltar a conexão em modo somente leitura, tenta buscar os dados reais e sincronizar de verdade
  useEffect(()=>{
    function onOnline(){
      if(!offlineReadOnly) return;
      const userId = session ? session.user.id : null;
      loadData(userId).then(({ data: freshData, updatedAt })=>{
        setData(freshData);
        lastKnownUpdatedAtRef.current = updatedAt;
        dirtyRef.current = false;
        setOfflineReadOnly(false);
        toast("Conexão restabelecida — dados sincronizados.","success");
      }).catch(()=>{ /* ainda sem sorte; continua em somente leitura até a próxima tentativa */ });
    }
    window.addEventListener("online", onOnline);
    return ()=>window.removeEventListener("online", onOnline);
  },[offlineReadOnly, session]);

  // salvar (debounce) com detecção de conflito entre dispositivos e nova tentativa automática em caso de falha
  async function attemptSave(userId, dataToSave, retryDelay){
    saveInFlightRef.current=true;
    try{
      const result = await saveData(userId, dataToSave, lastKnownUpdatedAtRef.current);
      if(result.conflict){
        setSaveState("idle");
        setConflict({ message:"Seus dados foram alterados em outro dispositivo depois da última vez que este aparelho salvou." });
        return;
      }
      if(result.updatedAt!==undefined) lastKnownUpdatedAtRef.current = result.updatedAt;
      dirtyRef.current = false;
      setSaveState("saved");
      setTimeout(()=>setSaveState(s=>s==="saved"?"idle":s),2000);
      // mantém o espelho offline sempre no que acabou de ser confirmado como salvo — não só no que
      // foi carregado na abertura — senão uma sessão longa cheia de edições ficaria com um espelho velho
      if(sb && userId){ try{ localStorage.setItem("razao_offline_cache", JSON.stringify({ data:dataToSave, cachedAt:Date.now() })); }catch(_){} }
      // espelho relacional: fora do caminho crítico — falhar aqui nunca impede nem desfaz o salvamento principal
      if(sb && userId) syncMirror(userId, dataToSave, mirrorRef.current);
    }catch(err){
      console.error(err);
      setSaveState("erro");
      const nextDelay = retryDelay>=15000?15000:retryDelay===5000?15000:retryDelay===2000?5000:2000;
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(()=>attemptSave(userId,dataToSave,nextDelay), retryDelay||2000);
    }finally{
      saveInFlightRef.current=false;
    }
  }
  function retrySaveNow(){ clearTimeout(retryTimer.current); attemptSave(session?session.user.id:null, data, 2000); }
  useEffect(()=>{
    if(loadStatus!=="ok" || offlineReadOnly) return; // somente leitura offline: nunca tenta gravar
    // recém-recarregado do servidor (tempo real ou "recarregar"): gravar de volta o mesmo conteúdo só
    // geraria um carimbo novo — e, com dois aparelhos abertos, um empurrando o outro sem fim
    if(skipNextSaveRef.current){ skipNextSaveRef.current=false; return; }
    dirtyRef.current = true;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    clearTimeout(retryTimer.current);
    const userId = session ? session.user.id : null;
    saveTimer.current = setTimeout(()=>attemptSave(userId, data, 2000), 600);
    return ()=>clearTimeout(saveTimer.current);
  },[data, loadStatus, offlineReadOnly]);

  // avisa antes de fechar/recarregar a aba se ainda houver algo não confirmado como salvo
  useEffect(()=>{
    function onBeforeUnload(e){
      if(dirtyRef.current || saveState==="saving" || saveState==="erro"){ e.preventDefault(); e.returnValue=""; }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return ()=>window.removeEventListener("beforeunload", onBeforeUnload);
  },[saveState]);

  // ao voltar o foco na aba, verifica (checagem leve, só o carimbo de tempo) se há versão mais nova salva alhures
  useEffect(()=>{
    if(!sb) return;
    function onVisible(){
      if(document.visibilityState!=="visible" || !session || loadStatus!=="ok") return;
      fetchServerUpdatedAt(session.user.id).then(serverUpdatedAt=>{
        if(serverUpdatedAt && lastKnownUpdatedAtRef.current && !sameInstant(serverUpdatedAt, lastKnownUpdatedAtRef.current)){
          setConflict({ message:"Há uma versão mais nova dos seus dados salva em outro dispositivo." });
        }
      }).catch(()=>{});
    }
    document.addEventListener("visibilitychange", onVisible);
    return ()=>document.removeEventListener("visibilitychange", onVisible);
  },[session, loadStatus]);

  /* tempo real (Supabase Realtime): quando outro aparelho salva, este recarrega sozinho se não tiver nada
     pendente aqui; se tiver, cai no mesmo diálogo de conflito de sempre. O evento só serve de "campainha":
     quem decide é o carimbo canônico do servidor (fetchServerUpdatedAt), o que também descarta o eco do
     próprio salvamento. Precisa da tabela finance_data publicada no Realtime (ver supabase/migrations);
     sem isso a assinatura não recebe nada e o app segue com a checagem ao voltar o foco, como antes. */
  useEffect(()=>{
    if(!sb || !session || loadStatus!=="ok" || typeof sb.channel!=="function") return;
    const userId=session.user.id;
    let timer=null, vivo=true;
    function verificar(){
      fetchServerUpdatedAt(userId).then(serverTs=>{
        if(!vivo || !serverTs) return;
        if(lastKnownUpdatedAtRef.current && sameInstant(serverTs, lastKnownUpdatedAtRef.current)) return;
        if(saveInFlightRef.current){ timer=setTimeout(verificar,2500); return; } // espera o salvamento daqui terminar
        if(dirtyRef.current){ setConflict({ message:"Seus dados acabaram de ser alterados em outro dispositivo." }); return; }
        loadData(userId).then(({ data:fresh, updatedAt })=>{
          if(!vivo || dirtyRef.current) return;
          skipNextSaveRef.current=true;
          setData(fresh);
          lastKnownUpdatedAtRef.current=updatedAt;
          toast("Atualizado com as mudanças feitas em outro dispositivo.","default");
        }).catch(()=>{});
      }).catch(()=>{});
    }
    let canal=null;
    try{
      canal=sb.channel("finance_data:"+userId)
        .on("postgres_changes",{ event:"UPDATE", schema:"public", table:"finance_data", filter:"user_id=eq."+userId },()=>{
          clearTimeout(timer); timer=setTimeout(verificar, 800);
        })
        .subscribe();
    }catch(_){ canal=null; }
    return ()=>{ vivo=false; clearTimeout(timer); if(canal){ try{ sb.removeChannel(canal); }catch(_){} } };
  },[session, loadStatus]);

  async function reloadFromServer(){
    const userId = session ? session.user.id : null;
    try{
      const { data: freshData, updatedAt } = await loadData(userId);
      skipNextSaveRef.current = true;
      setData(freshData);
      lastKnownUpdatedAtRef.current = updatedAt;
      dirtyRef.current = false;
      setConflict(null);
      toast("Dados recarregados.","success");
    }catch(e){ toast("Não foi possível recarregar agora.","error"); }
  }
  async function keepThisScreen(){
    const userId = session ? session.user.id : null;
    try{
      const result = await saveData(userId, data, null, true); // force: ignora o conflito e grava por cima
      if(result.updatedAt!==undefined) lastKnownUpdatedAtRef.current = result.updatedAt;
      dirtyRef.current = false;
      setConflict(null);
      toast("Dados desta tela salvos por cima.","success");
    }catch(e){ toast("Não foi possível salvar agora. Tente de novo.","error"); }
  }

  useEffect(()=>{ if(monthPicker) setPickerYear(view.getFullYear()); },[monthPicker]);
  // ponto único de mutação: bloquear aqui cobre todo formulário/botão do app de uma vez, sem precisar
  // desabilitar cada um individualmente enquanto estiver em modo somente leitura offline
  const update=(patch)=>{
    if(offlineReadOnly){ toast("Sem conexão — modo somente leitura. Esta alteração não foi salva.","error"); return; }
    setData(d=>({ ...d, ...(typeof patch==="function"?patch(d):patch) }));
  };
  // Open Finance automático: só com login (o servidor exige), dados carregados, online e sem a
  // preferência "revisar antes de salvar" ligada (nesse caso a busca fica manual, pela revisão)
  const pluggySync=usePluggyAutoSync({
    ativo: Boolean(sb && session && loadStatus==="ok" && !offlineReadOnly && !(data && data.settings && data.settings.pluggyReview)),
    data, update,
  });

  const vKey=`${view.getFullYear()}-${String(view.getMonth()+1).padStart(2,"0")}`;
  // índice único por mês (mês da fatura, respeitando txEffectiveMonth): uma única passada por todos os
  // lançamentos alimenta entradas/saídas/investido/proventos/categoria (só o realizado) de cada mês, mais
  // a lista bruta de itens daquele mês (previsto incluso, pra quem precisar mostrar tudo). Balanço, Panorama
  // e Investimentos leem daqui em O(1) por mês, em vez de re-varrer txs inteiro dentro de laços de 6/24 meses.
  const monthIndex=useMemo(()=>{
    const idx={};
    const bucket=(mk)=>idx[mk]||(idx[mk]={entradas:0,saidas:0,investido:0,proventos:0,porCategoria:{},itens:[]});
    txs.forEach(t=>{
      const b=bucket(txEffectiveMonth(t,accounts));
      b.itens.push(t);
      if(!isRealized(t)) return;
      if(t.type==="ganho"){ b.entradas+=t.cents; if(t.category==="Proventos") b.proventos+=t.cents; }
      else if(t.type==="gasto"){ b.saidas+=t.cents; b.porCategoria[t.category]=(b.porCategoria[t.category]||0)+t.cents; }
      else if(t.type==="investimento"){ b.investido+=t.cents; }
    });
    return idx;
  },[txs,accounts]);
  const EMPTY_BUCKET={entradas:0,saidas:0,investido:0,proventos:0,porCategoria:{},itens:[]};
  const monthBucket=(mk)=>monthIndex[mk]||EMPTY_BUCKET;
  const monthItens=monthBucket(vKey).itens; // itens brutos do mês exibido (inclui previsto) — usados por Contas/Investimentos

  // saldo do mês: o realizado é o que conta pra valer; o previsto (lançamentos futuros ainda não ocorridos)
  // aparece separado, nunca somado ao saldo principal — só entra de fato quando marcado como pago
  const totals=useMemo(()=>{
    const b=monthBucket(vKey);
    let previstoInc=0,previstoExp=0,previstoInv=0;
    b.itens.forEach(t=>{
      if(isRealized(t)) return;
      if(t.type==="ganho") previstoInc+=t.cents;
      else if(t.type==="gasto") previstoExp+=t.cents;
      else if(t.type==="investimento") previstoInv+=t.cents;
    });
    return { inc:b.entradas, exp:b.saidas, inv:b.investido, saldo:b.entradas-b.saidas-b.investido, previstoInc,previstoExp,previstoInv,previstoSaldo:previstoInc-previstoExp-previstoInv };
  },[monthIndex,vKey]);
  const prevTotals=useMemo(()=>{
    const d=new Date(view.getFullYear(),view.getMonth()-1,1);
    const pk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const b=monthBucket(pk);
    return { saldo:b.entradas-b.saidas-b.investido };
  },[monthIndex,view]);
  // a lista mostra tudo (inclusive previsto, atenuado) — só os totais/históricos/gráficos excluem o previsto
  const grouped=useMemo(()=>{
    const g={};
    [...monthBucket(vKey).itens].sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:b.id.localeCompare(a.id)).forEach(t=>{(g[t.date]=g[t.date]||[]).push(t);});
    return g;
  },[monthIndex,vKey]);
  // base única para o orçamento: gastos no mês da fatura (flow), não no mês-calendário — evita o total do topo
  // divergir da soma das categorias quando há cartão com fechamento/vencimento configurado. só o realizado
  // conta pro orçamento — um gasto previsto ainda não aconteceu, não deveria comprometer o limite ainda.
  const flowSpentByCat=useMemo(()=>monthBucket(vKey).porCategoria,[monthIndex,vKey]);
  // mesma régua do resto do orçamento (mês da fatura, não da compra) — senão o mín/média/máx não é comparável ao valor exibido acima
  const catHistory=useMemo(()=>{
    const pm={};
    Object.entries(monthIndex).forEach(([mk,b])=>{
      Object.entries(b.porCategoria).forEach(([cat,cents])=>{ (pm[cat]=pm[cat]||{})[mk]=cents; });
    });
    const o={};
    for(const c in pm){ const v=Object.values(pm[c]); o[c]={min:Math.min(...v),max:Math.max(...v),avg:Math.round(v.reduce((a,b)=>a+b,0)/v.length)}; }
    return o;
  },[monthIndex]);
  // orçamento variável: usa a exceção do mês exibido quando existir, senão o padrão da categoria
  const budgetRows=useMemo(()=>budgetRowsFor(budgets,budgetExceptions,vKey,flowSpentByCat,catHistory),[budgets,budgetExceptions,vKey,flowSpentByCat,catHistory]);
  // alertas olham sempre o mês de HOJE, mesmo com outro mês aberto na tela
  const hojeMk=todayISO().slice(0,7);
  const budgetRowsHoje=useMemo(()=>hojeMk===vKey ? budgetRows : budgetRowsFor(budgets,budgetExceptions,hojeMk,monthBucket(hojeMk).porCategoria,catHistory),[budgetRows,budgets,budgetExceptions,hojeMk,vKey,monthIndex,catHistory]);
  const plannedTotal=useMemo(()=>budgetRows.reduce((s,r)=>s+r.limit,0),[budgetRows]);
  useBudgetAlerts({ rows:budgetRowsHoje, mk:hojeMk, ativo:loadStatus==="ok" && settings?.budgetAlerts!==false, notificar:Boolean(settings?.budgetNotify) });
  const alerts=budgetRows.filter(r=>r.status==="over"||r.status==="warn");
  const byCatChart=useMemo(()=>Object.entries(flowSpentByCat).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value,color:CAT_COLOR[name]||"var(--text-mut)"})),[flowSpentByCat]);
  const acctName=(id)=>accounts.find(a=>a.id===id);
  const sparkline=useMemo(()=>{
    const arr=[];
    for(let i=5;i>=0;i--){
      const d=new Date(view.getFullYear(),view.getMonth()-i,1);
      const mk=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const b=monthBucket(mk);
      arr.push(b.entradas-b.saidas-b.investido);
    }
    return arr;
  },[monthIndex,view]);

  function moveMonth(d){setView(v=>new Date(v.getFullYear(),v.getMonth()+d,1));}
  function selectMonth(d){setView(new Date(d.getFullYear(),d.getMonth(),1));setMonthPicker(false);}
  function goToday(){const t=new Date();selectMonth(t);}

  function exportData(silent){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`razao-backup-${todayISO()}.json`;a.click();URL.revokeObjectURL(url);setMenu(false);if(!silent)toast("Backup exportado.","success");}

  // importação: nunca troca os dados na hora — mostra um resumo (mesclar x substituir) antes de qualquer coisa
  const [importPreview,setImportPreview]=useState(null); // {incoming:{...contagens},current:{...contagens},raw}
  const [importMode,setImportMode]=useState("merge"); // merge|replace
  const [replaceConfirmText,setReplaceConfirmText]=useState("");
  const [resetConfirmText,setResetConfirmText]=useState("");
  // zera transações, contas e cartões pra recomeçar do zero (ex: depois de ligar o Open Finance,
  // sem lançamento de teste ou duplicado misturado com o que chega automático do banco). As conexões
  // do Open Finance (pluggy.items) NÃO são tocadas — senão a pessoa teria que revincular tudo nos
  // dashboards do Pluggy de novo. Metas, orçamentos e categorização aprendida também ficam de fora,
  // por não serem o que foi pedido.
  function resetFinanceiro(){
    update(d=>({ transactions:[], accounts:[] }));
    setResetConfirmText("");
    toast("Transações, contas e cartões apagados. Se você usa Open Finance, a próxima sincronização recria as contas sozinha.","success");
  }
  function importData(e){
    const f=e.target.files?.[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{
      let parsed;
      try{ parsed=JSON.parse(r.result); }
      catch(err){ toast("Arquivo inválido.","error"); return; }
      if(!parsed||typeof parsed!=="object"){ toast("Arquivo inválido.","error"); return; }
      setImportPreview({
        raw: parsed,
        incoming:{ transactions:(parsed.transactions||[]).length, accounts:(parsed.accounts||[]).length, goals:(parsed.goals||[]).length, holdings:(parsed.holdings||[]).length },
        current:{ transactions:txs.length, accounts:accounts.length, goals:goals.length, holdings:holdings.length },
      });
      setImportMode("merge"); setReplaceConfirmText("");
    };
    r.readAsText(f); setMenu(false);
    e.target.value="";
  }
  function applyImport(){
    if(!importPreview) return;
    // migrate() primeiro: um backup exportado antes do modelo atual (sem schemaVersion, sem status,
    // sem saldo inicial) precisa entrar já no formato certo, tanto ao substituir quanto ao mesclar.
    const raw = migrate(importPreview.raw);
    if(importMode==="replace"){
      if(replaceConfirmText.trim().toLowerCase()!=="substituir") return;
      exportData(true); // backup automático do estado atual antes de qualquer substituição
      setData(raw);
      toast("Dados substituídos. Um backup do estado anterior foi baixado.","success");
    } else {
      const mergeArr=(curr,inc)=>{ const ids=new Set(curr.map(x=>x.id)); return [...curr, ...inc.filter(x=>x&&x.id&&!ids.has(x.id))]; };
      setData(d=>({
        ...d,
        transactions: mergeArr(d.transactions, raw.transactions||[]),
        accounts: mergeArr(d.accounts, raw.accounts||[]),
        goals: mergeArr(d.goals, raw.goals||[]),
        holdings: mergeArr(d.holdings, raw.holdings||[]),
        budgets: { ...(raw.budgets||{}), ...d.budgets },
        budgetExceptions: { ...(raw.budgetExceptions||{}), ...d.budgetExceptions },
      }));
      toast("Dados mesclados.","success");
    }
    setImportPreview(null);
  }
  function exportCSV(){
    const esc=(v)=>{const s=String(v??"");return /[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
    const rows=[["ID","Data","Tipo","Categoria","Descricao","Conta","ContaDestino","Valor"]];
    txs.forEach(t=>{
      const acc=acctName(t.acctId);
      const toAcc=t.toAcctId?acctName(t.toAcctId):null;
      rows.push([t.id,t.date,TYPES[t.type].label,t.category||"",t.description||"",acc?acc.name:"",toAcc?toAcc.name:"",(t.cents/100).toFixed(2).replace(".",",")]);
    });
    const csv="﻿"+rows.map(r=>r.map(esc).join(";")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`razao-transacoes-${todayISO()}.csv`;a.click();URL.revokeObjectURL(url);
    setMenu(false);toast("CSV exportado.","success");
  }
  async function signOut(){ await sb.auth.signOut(); setMenu(false); }

  // gates
  if(recovery) return <RecoverySetPassword onDone={()=>setRecovery(false)}/>;
  if(sb && !authReady) return <SkeletonScreen/>;
  if(sb && !session) return <Auth/>;
  if(loadStatus==="carregando") return <SkeletonScreen/>;
  if(loadStatus==="erro") return <LoadErrorScreen message={loadError} onRetry={()=>setLoadNonce(n=>n+1)} onSignOut={sb?signOut:null}/>;

  const monthLabel=capFirst(view.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}));
  // cor de marca escolhida em Configurações > Personalização: sobrescreve --accent/--accent-deep
  // via style inline (maior especificidade que a regra .rz/.rz.dark do CSS), sem duplicar toda a
  // paleta — só o acento muda, o resto dos tokens do tema continua vindo do CSS normalmente
  const colorTheme = COLOR_THEME_MAP[settings?.colorTheme] || COLOR_THEME_MAP.aco;
  const themeVars = theme==="dark" ? colorTheme.dark : colorTheme.light;

  return (
    <AuthProvider session={session}>
    <DataProvider data={data} update={update} pluggySync={pluggySync}>
    <ThemeProvider theme={theme} setTheme={(t)=>update({theme:t})}>
    <div className={"rz "+theme} style={{"--accent":themeVars.accent,"--accent-deep":themeVars.deep}}>
      <div className={"topbar"+(scrolled?" scrolled":"")}>
        <div className="topbar-in">
          <div className="brandmark">
            <BrandMark/>
            <div className="brandtext"><b>Razão</b><span>finanças pessoais</span></div>
          </div>
          <div className="monthpill">
            <button className="mbtn" aria-label="Mês anterior" onClick={()=>moveMonth(-1)}><Icon name="seta-esquerda" size={16}/></button>
            <button className="monthlabel" ref={monthTriggerRef} aria-expanded={monthPicker} onClick={()=>setMonthPicker(p=>!p)}>{monthLabel}<Icon name="chevron-baixo" size={12}/></button>
            <button className="mbtn" aria-label="Próximo mês" onClick={()=>moveMonth(1)}><Icon name="seta-direita" size={16}/></button>
            {monthPicker &&
              <div className="monthpop" ref={monthPopRef}>
                <div className="mpyear">
                  <button className="mbtn" aria-label="Ano anterior" onClick={()=>setPickerYear(y=>y-1)}><Icon name="seta-esquerda" size={14}/></button>
                  <b>{pickerYear}</b>
                  <button className="mbtn" aria-label="Próximo ano" onClick={()=>setPickerYear(y=>y+1)}><Icon name="seta-direita" size={14}/></button>
                </div>
                <div className="mpgrid">
                  {MONTH_NAMES.map((name,i)=>
                    <button key={name}
                      className={"mpm"+(pickerYear===view.getFullYear()&&i===view.getMonth()?" on":"")}
                      onClick={()=>selectMonth(new Date(pickerYear,i,1))}>{name}</button>)}
                </div>
                <button className="mptoday" onClick={goToday}>Ir para o mês atual</button>
              </div>}
          </div>
          <div className="topr">
            {saveState!=="idle" &&
              <span className={"saveind"+(saveState==="erro"?" err":"")}>
                <i/>
                <span>{saveState==="saving"?"Salvando…":saveState==="saved"?"Salvo":"Falha ao salvar"}</span>
                {saveState==="erro" && <button className="saveretry" onClick={retrySaveNow}>Tentar de novo</button>}
              </span>}
            <ThemeToggle/>
            <button className={"iconbtn"+(curSection.key==="config"?" on":"")} aria-label="Configurações" onClick={()=>setTab("preferencias")}><Icon name="config" size={17}/></button>
            <input ref={fileRef} type="file" accept="application/json" style={{display:"none"}} onChange={importData}/>
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="shell">
          <nav className="sidebar" aria-label="Navegação principal">
            <div className="navgroup">
              {NAV_SECTIONS.map(sec=>{
                const on=curSection.key===sec.key;
                return (
                  <button key={sec.key} className={"navitem"+(on?" on":"")} data-tip={sec.label} aria-current={on?"page":undefined} onClick={()=>goSection(sec)}>
                    <span className="navic"><Icon name={sec.icon} size={18}/></span><span className="navlbl">{sec.label}</span>
                  </button>);
              })}
            </div>
            <div className="navfooter">
              <span className="navavatar">{session?session.user.email[0].toUpperCase():<Icon name="contas" size={14}/>}</span>
              <span className="navlbl2">
                <b>{session?session.user.email.split("@")[0]:"Modo local"}</b>
                <small>{session?"Conta conectada":"Somente neste aparelho"}</small>
                <small className="ver">versão {APP_VERSION}</small>
              </span>
            </div>
          </nav>

          <div className="tabcontent">
            {curSection.views.length>1 &&
              <div className="subnav" role="tablist" aria-label={curSection.label}>
                {curSection.views.map(([k,l])=>
                  <button key={k} role="tab" aria-selected={tab===k} className={tab===k?"on":""} onClick={()=>setTab(k)}>{l}</button>)}
              </div>}
            {!sb && <div className="banner">Modo local: os dados ficam só neste aparelho. Configure o Supabase no início do arquivo para ter login e sincronização entre dispositivos.</div>}
            {offlineReadOnly && <div className="banner err">Sem conexão — mostrando a última versão salva. Alterações não serão gravadas até a conexão voltar.</div>}
            {novaVersao &&
              <div className="banner upd">
                <span>Uma versão mais nova do Razão já foi baixada. Recarregue quando quiser para usá-la.</span>
                <button className="sbtn" onClick={()=>window.location.reload()}><Icon name="brilho" size={14}/> Atualizar agora</button>
              </div>}
            {tab==="geral" && <HomeDashboard {...{txs,accounts,monthIndex,vKey,monthLabel,totals,budgetRows,pluggy}}/>}
            {tab==="geral" && <div className="sectionhead">Panorama completo</div>}
            {tab==="geral" && <Geral {...{txs,accounts,holdings,view,onSelectMonth:selectMonth,monthIndex,update,patrimonyHistory,recaps,aiModel:settings?.aiModel||"rapido"}}/>}
            {tab==="balanco" && <Balanco {...{grouped,monthLabel,totals,prevTotals,sparkline,plannedTotal,alerts,byCatChart,acctName,txs,view,accounts,onSelectMonth:selectMonth,update,isDesktop,onEditMobile:openEditMobile,monthIndex,categoryMemory,hourlyWageCents:settings?.hourlyWageCents||0,budgetRows,aiModel:settings?.aiModel||"rapido",pendingFilter,onConsumePendingFilter:()=>setPendingFilter(null)}}/>}
            {tab==="orcamento" && <Orcamento {...{budgetRows,budgets,budgetExceptions,update,plannedTotal,totalSpent:totals.exp,monthLabel,txs,view,accounts,budgetNotify:Boolean(settings?.budgetNotify)}}/>}
            {tab==="metas" && <Metas {...{goals,update,txs}}/>}
            {tab==="investimentos" && <Investimentos {...{holdings,update,monthIndex,monthLabel,txs,view,onSelectMonth:selectMonth}}/>}
            {tab==="extrato" && <Extrato {...{accounts,update,txs,aiModel:settings?.aiModel||"rapido",pluggy,categoryMemory,autoSync:pluggySync,revisarAntes:settings?.pluggyReview}}/>}
            {tab==="perguntar" && <Perguntar {...{txs,accounts}}/>}
            {tab==="contas" && <Contas {...{accounts,update,monthTx:monthItens,txs}}/>}
            {tab==="ajuda" && <Ajuda helpTarget={helpTarget} onConsumeTarget={()=>setHelpTarget(null)}/>}
            {tab==="preferencias" &&
              <div className="card prefs">
                <h3>Preferências</h3>
                <div className="sub">Aparência, dados e conta. Contas e bancos ficam na tela ao lado.</div>
                <div className="sub" style={{marginBottom:6}}>Tema</div>
                <div className="seg" style={{marginBottom:6}}>
                  <button className={theme!=="dark"?"on in":""} onClick={()=>update({theme:"light"})}><Icon name="sol" size={14}/> Claro</button>
                  <button className={theme==="dark"?"on in":""} onClick={()=>update({theme:"dark"})}><Icon name="lua" size={14}/> Escuro</button>
                </div>
                <div className="sheetdivider"/>
            <div className="sub" style={{marginBottom:6}}>Valor da sua hora de trabalho (opcional)</div>
            <Money cents={settings?.hourlyWageCents||0} onChange={v=>update(d=>({settings:{...d.settings,hourlyWageCents:v}}))} small/>
            <div className="hint">Preenchendo, os lançamentos passam a mostrar quantas horas de trabalho aquele valor representa. Deixe em R$ 0,00 para desligar.</div>
            <div className="sheetdivider"/>
            <div className="sub" style={{marginBottom:6}}>Avisos</div>
            <label className="toggle">
              <input type="checkbox" checked={settings?.budgetAlerts!==false} onChange={e=>update(d=>({settings:{...d.settings,budgetAlerts:e.target.checked}}))}/>
              Avisar quando uma categoria passar de 80% e de 100% do orçamento
            </label>
            {sb &&
              <React.Fragment>
                <label className="toggle">
                  <input type="checkbox" checked={Boolean(settings?.emailSummary)} onChange={e=>update(d=>({settings:{...d.settings,emailSummary:e.target.checked}}))}/>
                  Receber por e-mail o resumo do mês, todo dia 1
                </label>
                <div className="hint" style={{marginTop:-6}}>Vai para {session?session.user.email:"o e-mail da sua conta"}: renda, despesas, resultado e as categorias que passaram do limite. Depende do envio de e-mails estar configurado no servidor (ver api/monthly-summary.js).</div>
              </React.Fragment>}
            <div className="sheetdivider"/>
            <div className="sub" style={{marginBottom:6}}>Open Finance (bancos conectados)</div>
            <label className="toggle">
              <input type="checkbox" checked={Boolean(settings?.pluggyReview)} onChange={e=>update(d=>({settings:{...d.settings,pluggyReview:e.target.checked}}))}/>
              Revisar os lançamentos do banco antes de salvar
            </label>
            <div className="hint" style={{marginTop:-6}}>{settings?.pluggyReview
              ? "Ligado: a sincronização fica manual (em Gastos › Importar do banco) e tudo passa pela lista de revisão antes de entrar."
              : "Desligado (padrão): o app sincroniza sozinho ao abrir e a cada 6 horas enquanto estiver aberto, e grava direto, sem duplicar. Lançamentos ainda pendentes no banco entram quando forem efetivados."}</div>
            <div className="sheetdivider"/>
            <div className="sub" style={{marginBottom:6}}>Motor de IA usado para ler extratos e faturas</div>
            <div className="seg" style={{marginBottom:6}}>
              {Object.entries(AI_MODELS).map(([k,m])=>
                <button key={k} className={(settings?.aiModel||"rapido")===k?"on in":""} onClick={()=>update(d=>({settings:{...d.settings,aiModel:k}}))}>{m.label}</button>)}
            </div>
            <div className="hint">{AI_MODELS[settings?.aiModel||"rapido"].hint} Se um documento vier bagunçado ou com muitas linhas erradas, troque para "Cuidadoso" e mande de novo só aquele arquivo.</div>
            <div className="sheetdivider"/>
            <div className="sub" style={{marginBottom:8}}>Cor de marca do site</div>
            <div className="colorgrid">
              {COLOR_THEMES.map(t=>{
                const active=(settings?.colorTheme||"aco")===t.id;
                const swatch = theme==="dark" ? t.dark.accent : t.light.accent;
                return (
                  <button key={t.id} type="button" className={"colorswatch"+(active?" on":"")}
                    style={{"--sw":swatch}} title={t.name} aria-label={"Usar cor "+t.name} aria-pressed={active}
                    onClick={()=>update(d=>({settings:{...d.settings,colorTheme:t.id}}))}>
                    {active && <Icon name="check" size={14}/>}
                  </button>
                );
              })}
            </div>
            <div className="hint">{COLOR_THEME_MAP[settings?.colorTheme||"aco"].name} — usada em botões, navegação ativa e destaques. As cores de ganho, gasto, investimento e aviso não mudam com a escolha aqui.</div>
            <div className="sheetdivider"/>
            <div className="kv"><span className="kk">Versão do app</span><span className="vv">{APP_VERSION}</span></div>
            <div className="kv"><span className="kk">Atualizado em</span><span className="vv">{fmtDateBR(APP_BUILD)}</span></div>
            {novaVersao
              ? <button className="sbtn primary" style={{marginTop:10}} onClick={()=>window.location.reload()}><Icon name="brilho" size={14}/> Instalar a versão nova</button>
              : <div className="hint">Você está na versão mais recente que este aparelho baixou. Quando sair uma nova, um aviso aparece aqui e no topo da tela.</div>}
            <div className="sheetdivider"/>
            <div className="sub" style={{marginBottom:6,color:"var(--neg)"}}>Zona de risco</div>
            <div className="hint" style={{marginTop:0}}>
              Apaga todas as transações, contas e cartões cadastrados — útil para começar do zero depois de ligar o Open Finance, sem lançamento de teste misturado com o que chega automático do banco.
              As conexões do Open Finance continuam vinculadas (não precisa reconectar no Pluggy), e metas, orçamentos e categorização aprendida não são afetados.
              Isso não pode ser desfeito por aqui — vale <button type="button" className="saveretry" style={{fontSize:"inherit"}} onClick={()=>exportData()}>exportar um backup</button> antes.
            </div>
            <input className="fld" value={resetConfirmText} onChange={e=>setResetConfirmText(e.target.value)} placeholder='Digite "apagar"' style={{margin:"10px 0 4px"}}/>
            <button className="sbtn danger" style={{marginTop:6}} disabled={resetConfirmText.trim().toLowerCase()!=="apagar"} onClick={resetFinanceiro}>
              <Icon name="excluir" size={14}/> Apagar transações, contas e cartões
            </button>
                <div className="sheetdivider"/>
                {sb &&
              <React.Fragment>
                <div className="sub" style={{marginBottom:6}}>Tabelas relacionais no Supabase</div>
                <div className="hint" style={{marginTop:0}}>
                  {mirrorStatus.status==="ok" ? `Sincronizadas ${tempoDesde(new Date(mirrorStatus.at).toISOString())}: contas, movimentos e orçamentos ficam também em bank_accounts, movements e budgets, prontos para consulta por SQL.`
                    : mirrorStatus.status==="ausente" ? "Ainda não instaladas. Rode uma vez o arquivo supabase/migrations/20261007000000_tabelas_relacionais.sql no SQL Editor do Supabase; até lá o app segue normal, só com o registro principal."
                    : mirrorStatus.status==="erro" ? `A última cópia para as tabelas falhou (${mirrorStatus.error}). Seus dados principais estão salvos; o app tenta de novo no próximo salvamento.`
                    : "Conferindo na próxima vez que algo for salvo…"}
                </div>
                <div className="sheetdivider"/>
              </React.Fragment>}
            <div className="sub" style={{marginBottom:8}}>Backup dos dados</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button className="sbtn" onClick={()=>exportData()}><Icon name="baixar" size={14}/> Exportar backup (.json)</button>
                  <button className="sbtn" onClick={exportCSV}><Icon name="baixar" size={14}/> Exportar dados (.csv)</button>
                  <button className="sbtn" onClick={()=>fileRef.current?.click()}><Icon name="enviar" size={14}/> Importar backup</button>
                </div>
                {sb &&
                  <React.Fragment>
                    <div className="sheetdivider"/>
                    <div className="sub" style={{marginBottom:8}}>Conta</div>
                    {session && <div className="kv"><span className="kk">Conectado como</span><span className="vv" style={{wordBreak:"break-all"}}>{session.user.email}</span></div>}
                    <button className="sbtn danger" style={{marginTop:10}} onClick={signOut}><Icon name="sair" size={14}/> Sair da conta</button>
                  </React.Fragment>}
              </div>}
          </div>
        </div>
      </div>

      <nav className="bottomnav" aria-label="Navegação">
        {(()=>{const sec=NAV_SECTIONS.find(x=>x.key==="home");return <button className={curSection.key===sec.key?"on":""} onClick={()=>goSection(sec)} aria-label={sec.label}><Icon name={sec.icon} size={20}/><span>{sec.label}</span></button>;})()}
        {(()=>{const sec=NAV_SECTIONS.find(x=>x.key==="gastos");return <button className={curSection.key===sec.key?"on":""} onClick={()=>goSection(sec)} aria-label={sec.label}><Icon name={sec.icon} size={20}/><span>{sec.label}</span></button>;})()}
        <button className="fab" ref={fabRef} aria-label="Novo movimento" onClick={openAdd}><Icon name="adicionar" size={22}/></button>
        {(()=>{const sec=NAV_SECTIONS.find(x=>x.key==="orcamento");return <button className={curSection.key===sec.key?"on":""} onClick={()=>goSection(sec)} aria-label={sec.label}><Icon name={sec.icon} size={20}/><span>{sec.label}</span></button>;})()}
        {(()=>{const sec=NAV_SECTIONS.find(x=>x.key==="investimentos");return <button className={curSection.key===sec.key?"on":""} onClick={()=>goSection(sec)} aria-label={sec.label}><Icon name={sec.icon} size={20}/><span>{sec.label}</span></button>;})()}
      </nav>

      {/* no computador não há barra inferior: o "novo movimento" fica num botão flutuante fixo, visível em todas as telas */}
      <button className="fabfloat" ref={fabDeskRef} aria-label="Novo movimento" onClick={openAdd}><Icon name="adicionar" size={20}/><span>Novo movimento</span></button>



      <Sheet open={sheetOpen} onClose={()=>setSheetOpen(false)} title={sheetEditTx?"Editar movimento":"Novo movimento"} returnFocusRef={isDesktop?fabDeskRef:fabRef}>
        <TransactionForm accounts={accounts} txs={txs} update={update} editTx={sheetEditTx} propagateIds={sheetPropagateIds} onDone={()=>setSheetOpen(false)} categoryMemory={categoryMemory} autoFocus/>
      </Sheet>

      <ConflictDialog open={!!conflict} message={conflict?conflict.message:""} onReload={reloadFromServer} onKeep={keepThisScreen} onClose={()=>setConflict(null)}/>

      <Sheet open={!!importPreview} onClose={()=>setImportPreview(null)} title="Importar backup">
        {importPreview &&
          <React.Fragment>
            <p style={{fontSize:13,color:"var(--text-mut)",marginBottom:14,lineHeight:1.5}}>Compare o que tem no arquivo com o que já existe aqui antes de aplicar.</p>
            <div className="kv"><span className="kk">Lançamentos</span><span className="vv">{importPreview.current.transactions} atual · {importPreview.incoming.transactions} no arquivo</span></div>
            <div className="kv"><span className="kk">Contas</span><span className="vv">{importPreview.current.accounts} atual · {importPreview.incoming.accounts} no arquivo</span></div>
            <div className="kv"><span className="kk">Metas</span><span className="vv">{importPreview.current.goals} atual · {importPreview.incoming.goals} no arquivo</span></div>
            <div className="kv"><span className="kk">Ativos</span><span className="vv">{importPreview.current.holdings} atual · {importPreview.incoming.holdings} no arquivo</span></div>
            <div className="seg" style={{margin:"16px 0 12px"}}>
              <button className={importMode==="merge"?"on in":""} onClick={()=>setImportMode("merge")}>Mesclar</button>
              <button className={importMode==="replace"?"on out":""} onClick={()=>setImportMode("replace")}>Substituir tudo</button>
            </div>
            {importMode==="merge"
              ? <p className="hint">Mantém tudo o que já existe aqui e adiciona só os itens do arquivo que ainda não existem (comparando por id).</p>
              : <React.Fragment>
                  <p className="hint" style={{color:"var(--neg)"}}>Isso apaga os dados atuais e os troca pelos do arquivo. Um backup do estado atual é baixado automaticamente antes. Para confirmar, digite "substituir" abaixo.</p>
                  <input className="fld" value={replaceConfirmText} onChange={e=>setReplaceConfirmText(e.target.value)} placeholder='Digite "substituir"' style={{margin:"10px 0 4px"}}/>
                </React.Fragment>}
            <button className="submit" style={{marginTop:14}} onClick={applyImport} disabled={importMode==="replace"&&replaceConfirmText.trim().toLowerCase()!=="substituir"}>
              {importMode==="replace"?"Substituir tudo":"Mesclar dados"}
            </button>
          </React.Fragment>}
      </Sheet>

      <ToastHost/>
      <ConfirmHost/>
      <SeriesScopeHost/>
      <WelcomeTour/>
    </div>
    </ThemeProvider>
    </DataProvider>
    </AuthProvider>
  );
}

export { App };
