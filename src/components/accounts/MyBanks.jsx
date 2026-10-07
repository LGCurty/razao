/* components/accounts/MyBanks.jsx — "Minhas contas": cada banco conectado pelo Open Finance com saldo, status
   da sincronização e as ações Reconectar, Tentar novamente e Remover, mais "+ Adicionar conta". */
import React, { useEffect, useMemo, useState } from "react";
import { useData } from "../../context/DataContext";
import { askConfirm, toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { goToTab } from "../navigation/navEvents";
import { PLUGGY_ITEM_STATUS, abrirPluggyConnect, comConexao, pluggyApi } from "../../services/pluggyService";
import { sb } from "../../services/supabaseService";
import { saldosPorConta } from "../../utils/calculations";
import { brl, tempoDesde } from "../../utils/formatters";

/* situação de uma conexão para a tela, juntando o estado da sincronização em andamento (memória) com o
   que ficou gravado na própria conexão (lastStatus/lastError, que sobrevivem a recarregar o app) */
function situacaoDaConexao(c, e, online){
  const st=PLUGGY_ITEM_STATUS[String(c.lastStatus||"").toUpperCase()];
  if(e && e.fase==="sincronizando") return { tipo:"sincronizando", texto:"Sincronizando…" };
  if((e && e.fase==="reconectar") || (st && st.reconectar)) return { tipo:"reconectar", texto:(e && e.erro) || st.label };
  if(!online || (e && e.fase==="offline")) return { tipo:"offline", texto:"Sem internet — sincroniza quando a conexão voltar." };
  if(e && e.fase==="erro") return { tipo:"erro", texto:e.erro };
  if(e && e.fase==="parcial") return { tipo:"parcial", texto:e.erro };
  if(!e && c.lastError) return { tipo:"erro", texto:c.lastError };
  if(c.lastSyncAt) return { tipo:"ok", texto:`Sincronizado ${tempoDesde(c.lastSyncAt)}`, aviso:e && e.erro };
  return { tipo:"nunca", texto:"Ainda não sincronizado" };
}
const TAG={ ok:"ok", sincronizando:"ok", parcial:"warn", offline:"warn", nunca:"warn", erro:"over", reconectar:"over" };
const ROTULO={ ok:"Em dia", sincronizando:"Sincronizando", parcial:"Parcial", offline:"Offline", nunca:"Pendente", erro:"Erro", reconectar:"Reconectar" };

function useOnline(){
  const [online,setOnline]=useState(typeof navigator==="undefined" || navigator.onLine!==false);
  useEffect(()=>{
    const on=()=>setOnline(true), off=()=>setOnline(false);
    window.addEventListener("online",on); window.addEventListener("offline",off);
    return ()=>{ window.removeEventListener("online",on); window.removeEventListener("offline",off); };
  },[]);
  return online;
}

function MyBanks({ accounts, txs }){
  const { data, update, pluggySync } = useData();
  const conexoes=(data && data.pluggy && data.pluggy.items)||[];
  const estado=(pluggySync && pluggySync.estado)||{};
  const online=useOnline();
  const [abrindo,setAbrindo]=useState("");   // "" | "nova" | itemId sendo reconectado
  const saldos=useMemo(()=>Object.fromEntries(saldosPorConta(txs,accounts).map(a=>[a.id,a])),[txs,accounts]);

  const logado=Boolean(sb);
  const configurado=pluggySync ? pluggySync.configurado : null;
  const podeConectar=logado && configurado===true && online;

  async function conectar(itemId){
    if(abrindo) return;
    setAbrindo(itemId||"nova");
    try{
      await abrirPluggyConnect({
        itemId,
        onSuccess:(nova)=>{
          update(d=>({pluggy:{...d.pluggy, items:comConexao(d.pluggy.items,nova)}}));
          toast(`${nova.connectorName} ${itemId?"reconectado":"conectado"}. Buscando os lançamentos…`,"success");
          // busca já, sem esperar o próximo ciclo da sincronização automática
          if(pluggySync) setTimeout(()=>pluggySync.sincronizarAgora(nova.id),800);
        },
        onError:(msg)=>toast(msg,"error"),
      });
    }catch(err){ toast(err.message||"Não foi possível abrir a conexão.","error"); }
    finally{ setAbrindo(""); }
  }

  async function tentarDeNovo(c){
    if(!pluggySync) return;
    const r=await pluggySync.sincronizarAgora(c.id);
    if(r && !r.ok && r.erro) toast(r.erro,"error");
  }

  function remover(c){
    askConfirm({
      title:`Remover ${c.connectorName}?`,
      message:"O acesso do app aos dados desse banco é encerrado no Pluggy e a sincronização para. As contas e os lançamentos que já vieram continuam aqui.",
      confirmLabel:"Remover",
      onConfirm:async()=>{
        try{ await pluggyApi("delete_item",{itemId:c.id}); }catch(e){ /* mesmo se falhar lá, tiramos daqui */ }
        update(d=>({
          pluggy:{...d.pluggy, items:d.pluggy.items.filter(i=>i.id!==c.id)},
          // as contas deixam de ser "do banco": o saldo volta a ser o calculado pelos lançamentos
          accounts:d.accounts.map(a=>a.pluggyItemId===c.id ? (({pluggyItemId,bankBalance,bankBalanceAt,...resto})=>resto)(a) : a),
        }));
        toast(`${c.connectorName} removido.`,"success");
      },
    });
  }

  const rodando=Boolean(pluggySync && pluggySync.rodando);
  return (
    <div className="card mybanks">
      <h3>
        Minhas contas
        {conexoes.length>0 && podeConectar &&
          <button className="sbtn" onClick={()=>conectar()} disabled={!!abrindo}><Icon name="adicionar" size={14}/> Adicionar conta</button>}
      </h3>
      <div className="sub">Bancos conectados pelo Open Finance. Sincronizam sozinhos a cada 6 horas enquanto o app está aberto; se um falhar, o app tenta de novo em 5 minutos (até 3 vezes).</div>

      {!online && <div className="banner" style={{marginBottom:10}}>Sem internet agora. Os dados que você já tem continuam aqui, e a sincronização volta sozinha quando a conexão voltar.</div>}

      {conexoes.length===0 &&
        <div className="mbempty">
          <p className="hint" style={{marginTop:0}}>Nenhum banco conectado. Conecte uma vez e os lançamentos chegam sozinhos, sem PDF e sem digitar — a senha é digitada na tela do próprio Pluggy, o Razão nunca a vê.</p>
          {podeConectar
            ? <button className="sbtn primary" onClick={()=>conectar()} disabled={!!abrindo}>
                {abrindo ? <><i className="mbspin"/> Abrindo…</> : <><Icon name="adicionar" size={14}/> Adicionar conta</>}
              </button>
            : <p className="hint">{!logado ? "Entre com a sua conta para conectar um banco." : configurado===false ? "O Open Finance ainda não foi configurado no servidor — veja o passo a passo em Movimentos › Importar do banco." : configurado===null ? "Verificando o Open Finance…" : ""}</p>}
        </div>}

      {conexoes.map(c=>{
        const e=estado[c.id];
        const sit=situacaoDaConexao(c, e, online);
        const contas=accounts.filter(a=>a.pluggyItemId===c.id);
        const totalBanco=contas.filter(a=>a.kind==="conta").reduce((s,a)=>s+((saldos[a.id]&&saldos[a.id].saldo)||0),0);
        const ocupado=rodando || !!abrindo;
        return (
          <div className="mbbank" key={c.id} data-status={sit.tipo}>
            <div className="mbhead">
              {c.connectorImage
                ? <img className="mblogo" src={c.connectorImage} alt="" loading="lazy"/>
                : <span className="mblogo"><Icon name="banco" size={16}/></span>}
              <div className="mbinfo">
                <div className="mbname">{c.connectorName} <span className={"tag "+TAG[sit.tipo]}>{ROTULO[sit.tipo]}</span></div>
                <div className={"mbstatus "+sit.tipo}>
                  {sit.tipo==="sincronizando" && <i className="mbspin"/>}{sit.texto}
                </div>
                {sit.aviso && <div className="mbstatus parcial">{sit.aviso}</div>}
              </div>
              <div className="mbsaldo num">{contas.some(a=>a.kind==="conta") ? brl(totalBanco) : ""}</div>
            </div>

            {contas.length>0 &&
              <div className="mbcontas">
                {contas.map(a=>{
                  const s=saldos[a.id];
                  return (
                    <div className="mbconta" key={a.id}>
                      <Icon name={a.kind==="cartao"?"cartao":"banco"} size={13}/>
                      <span className="mbcnome">{a.name}</span>
                      <span className="num">{a.kind==="cartao" ? "cartão" : s ? brl(s.saldo) : ""}</span>
                    </div>
                  );
                })}
              </div>}

            <div className="mbacoes">
              {sit.tipo==="reconectar"
                ? <button className="sbtn primary" disabled={ocupado||!podeConectar} onClick={()=>conectar(c.id)}>
                    {abrindo===c.id ? <><i className="mbspin"/> Abrindo…</> : <><Icon name="banco" size={13}/> Reconectar</>}
                  </button>
                : <button className="sbtn" disabled={ocupado||!online||!(pluggySync&&pluggySync.ativo)} onClick={()=>tentarDeNovo(c)}>
                    <Icon name="atualizar" size={13}/> {sit.tipo==="erro"||sit.tipo==="parcial" ? "Tentar novamente" : "Sincronizar agora"}
                  </button>}
              {sit.tipo!=="reconectar" &&
                <button className="sbtn" disabled={ocupado||!podeConectar} onClick={()=>conectar(c.id)} title="Abrir o Pluggy de novo para trocar a senha ou renovar o consentimento">Reconectar</button>}
              <button className="sbtn danger" disabled={ocupado} onClick={()=>remover(c)} aria-label={"Remover "+c.connectorName}><Icon name="excluir" size={13}/> Remover</button>
            </div>
          </div>
        );
      })}

      {conexoes.length>0 &&
        <p className="hint" style={{marginBottom:0}}>
          Prefere revisar cada lançamento antes de salvar? Ligue em Preferências, ou use <button className="linkbtn" onClick={()=>goToTab("extrato")}>Importar do banco</button>.
        </p>}
    </div>
  );
}

export { MyBanks, situacaoDaConexao };
