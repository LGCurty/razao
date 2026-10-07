/* components/movements/OpenFinance.jsx — conexão com bancos pelo Pluggy dentro de Importar do banco. */
import React, { useEffect, useRef, useState } from "react";
import { askConfirm, toast } from "../common/Feedback";
import { Icon } from "../common/Icon";
import { PLUGGY_ITEM_STATUS, PLUGGY_UUID, abrirPluggyConnect, comConexao, diasDesdeUltimaSync, pluggyApi, syncPluggyConnection } from "../../services/pluggyService";
import { sb } from "../../services/supabaseService";
import { fmtDateBR } from "../../utils/formatters";

/* ---- Open Finance: bancos conectados ----
   Fica no topo da aba "Importar do banco" porque é a mesma tarefa (trazer o mês do banco para cá),
   só que sem arquivo nenhum. O resultado cai na MESMA lista de revisão da leitura por IA. */
function OpenFinance({ accounts, update, pluggy, categoryMemory, jaImportados, onResultado, autoSync, revisarAntes }){
  const conexoes=pluggy?.items||[];
  const [configurado,setConfigurado]=useState(null); // null = ainda perguntando ao servidor
  const [busy,setBusy]=useState("");                 // "" | "conectando" | id da conexão sincronizando
  const [etapa,setEtapa]=useState({label:"",pct:0});
  const [erro,setErro]=useState("");
  const [periodo,setPeriodo]=useState("auto");
  const [aberto,setAberto]=useState(false);
  const [colando,setColando]=useState(false);  // formulário de itemId do Meu Pluggy
  const [itemIdTxt,setItemIdTxt]=useState("");
  const vivo=useRef(true);
  useEffect(()=>()=>{ vivo.current=false; },[]);

  useEffect(()=>{
    let cancelado=false;
    pluggyApi("status")
      .then(r=>{ if(!cancelado) setConfigurado(Boolean(r.configurado)); })
      .catch(()=>{ if(!cancelado) setConfigurado(false); });
    return ()=>{ cancelado=true; };
  },[]);

  const logado=Boolean(sb);
  // com o app em modo local não há como provar quem está pedindo os dados do banco, e o servidor
  // recusa — melhor dizer isso antes da pessoa clicar do que deixar o erro aparecer depois
  const podeConectar = configurado===true && logado;

  /* a sincronização automática (ao abrir o app e a cada 6h, com novas tentativas) roda no nível do app
     — ver usePluggyAutoSync. Esta tela só dispara na mão. Com "revisar antes de salvar" ligado em
     Preferências, o resultado vem para a lista de revisão daqui, como sempre foi; desligado (padrão),
     a busca manual usa o mesmo caminho da automática e já grava direto. */
  const revisar=Boolean(revisarAntes);
  const dias=(conexao)=> periodo==="auto" ? diasDesdeUltimaSync(conexao) : Number(periodo);

  async function sincronizar(conexao){
    if(busy) return;
    if(!revisar && autoSync){
      setErro(""); setBusy(conexao.id); setEtapa({label:`Sincronizando ${conexao.connectorName}…`,pct:0.5});
      try{
        const r=await autoSync.sincronizarAgora(conexao.id, { dias:dias(conexao) });
        if(r && !r.ok && vivo.current) setErro(r.erro||"Não foi possível buscar os dados do banco.");
      }finally{ if(vivo.current){ setBusy(""); setEtapa({label:"",pct:0}); } }
      return;
    }
    setErro(""); setBusy(conexao.id);
    try{
      const r=await syncPluggyConnection({
        conexao, accounts, categoryMemory, jaImportados, dias:dias(conexao),
        onEtapa:(label,pct)=>{ if(vivo.current) setEtapa({label,pct}); },
      });
      if(!vivo.current) return;
      if(r.novas.length){
        update(d=>({accounts:[...d.accounts,...r.novas.filter(a=>!d.accounts.some(x=>x.id===a.id))]}));
        toast(`${r.novas.length===1?"Conta criada":"Contas criadas"} automaticamente: ${r.novas.map(a=>a.name).join(", ")}.`,"success");
      }
      const jaEstavam = r.ignorados>0 ? ` ${r.ignorados} já ${r.ignorados===1?"tinha sido importado":"tinham sido importados"} antes.` : "";
      if(r.rows.length===0){
        toast(`Nenhum lançamento novo no ${conexao.connectorName} nesse período.${jaEstavam}`,"default");
      } else {
        onResultado({docs:r.docs,rows:r.rows});
        toast(`${r.rows.length} lançamento${r.rows.length===1?"":"s"} do ${conexao.connectorName} para revisar.${jaEstavam}`,"success");
      }
      update(d=>({pluggy:{...d.pluggy,items:d.pluggy.items.map(i=>i.id===conexao.id
        ? {...i,lastSyncAt:new Date().toISOString(),lastStatus:r.status,contas:r.contas.length,lastError:""} : i)}}));
      if(r.aviso) setErro(r.aviso);
    }catch(err){
      if(err.reconectar) update(d=>({pluggy:{...d.pluggy,items:d.pluggy.items.map(i=>i.id===conexao.id?{...i,lastStatus:err.itemStatus||i.lastStatus}:i)}}));
      if(vivo.current) setErro(err.message||"Não foi possível buscar os dados do banco.");
    }finally{
      if(vivo.current){ setBusy(""); setEtapa({label:"",pct:0}); }
    }
  }

  async function conectar(itemId){
    if(busy) return;
    setErro(""); setBusy("conectando"); setEtapa({label:"Abrindo a conexão segura…",pct:0.3});
    try{
      await abrirPluggyConnect({
        itemId,
        onSuccess:(nova)=>{
          update(d=>({pluggy:{...d.pluggy, items:comConexao(d.pluggy.items,nova)}}));
          toast(`${nova.connectorName} ${itemId?"reconectado":"conectado"}. Buscando os lançamentos…`,"success");
          // sem revisão, a busca vai pelo mesmo motor da sincronização automática (que não deixa duas
          // rodarem juntas). Com revisão ligada, a pessoa clica em "Atualizar" quando quiser ver a lista.
          if(autoSync && !revisar) setTimeout(()=>autoSync.sincronizarAgora(nova.id),800);
        },
        onError:(msg)=>{ if(vivo.current) setErro(msg); },
      });
      if(vivo.current){ setBusy(""); setEtapa({label:"",pct:0}); }
    }catch(err){
      if(vivo.current){ setErro(err.message||"Não foi possível abrir a conexão."); setBusy(""); setEtapa({label:"",pct:0}); }
    }
  }

  /* Quem já conectou os bancos no Meu Pluggy (meu.pluggy.ai) não precisa do widget: basta colar aqui
     o itemId de cada conexão. O app confere o id na API antes de guardar, para não deixar você com
     um id errado salvo e um erro só aparecendo na hora de atualizar. */
  async function adicionarPorId(){
    const id=itemIdTxt.trim().toLowerCase();
    if(!PLUGGY_UUID.test(id)){ setErro("Esse itemId não tem o formato certo. Ele parece com 11111111-2222-3333-4444-555555555555."); return; }
    if(conexoes.some(c=>c.id===id)){ setErro("Essa conexão já está na lista."); return; }
    setErro(""); setBusy("conectando"); setEtapa({label:"Conferindo a conexão…",pct:0.4});
    try{
      const info=await pluggyApi("item",{itemId:id});
      if(!vivo.current) return;
      const nova={
        id, connectorName:info.connector?.name||"Banco", connectorImage:info.connector?.imageUrl||"",
        createdAt:new Date().toISOString(), lastSyncAt:"", lastStatus:info.status||"",
      };
      update(d=>({pluggy:{...d.pluggy,items:[...d.pluggy.items.filter(i=>i.id!==id),nova]}}));
      setColando(false); setItemIdTxt("");
      setBusy(""); setEtapa({label:"",pct:0});
      toast(`${nova.connectorName} adicionado. Buscando os lançamentos…`,"success");
      sincronizar(nova);
    }catch(err){
      if(vivo.current){
        // o Pluggy só deixa uma aplicação enxergar os itens que ELA MESMA criou — um itemId de uma
        // conexão feita no Meu Pluggy pertence à aplicação do Meu Pluggy, não à sua (mesmo que o
        // itemId esteja copiado certinho). "não achado" aqui quase sempre é isso, não erro de digitação.
        setErro(err.status===404
          ? "O Pluggy não encontrou essa conexão nesta aplicação. Se ela foi feita no Meu Pluggy, é esperado: o Meu Pluggy usa uma aplicação diferente da sua, e o Pluggy não deixa uma aplicação ler conexões de outra. Para trazer esse banco pelo Razão, use \"Conectar meu banco\" acima (cria a conexão direto na sua aplicação) — e se aparecer aviso de conta demo/sandbox, é preciso liberar acesso a dados reais para a sua aplicação em dashboard.pluggy.ai."
          : (err.message||"Não foi possível conferir essa conexão."));
        setBusy(""); setEtapa({label:"",pct:0});
      }
    }
  }

  function remover(conexao){
    askConfirm({
      title:`Desconectar ${conexao.connectorName}?`,
      message:"O acesso do app aos dados desse banco é encerrado no Pluggy. Os lançamentos que você já importou continuam aqui.",
      confirmLabel:"Desconectar",
      onConfirm:async()=>{
        try{ await pluggyApi("delete_item",{itemId:conexao.id}); }catch(e){ /* mesmo se falhar lá, tiramos daqui */ }
        update(d=>({pluggy:{...d.pluggy,items:d.pluggy.items.filter(i=>i.id!==conexao.id)}}));
        toast("Banco desconectado.","success");
      },
    });
  }

  if(configurado===null && conexoes.length===0) return null; // ainda perguntando: não pisca na tela

  return (
    <div className="card">
      <h3>
        <span style={{display:"flex",alignItems:"center",gap:8}}>Open Finance <span className="tag ok">direto do banco</span></span>
        {conexoes.length>0 &&
          <button className="sbtn" disabled={!!busy} onClick={()=>conectar()}><Icon name="adicionar" size={14}/> Conectar outro</button>}
      </h3>
      <div className="sub">Conecte o banco uma vez e os lançamentos chegam sozinhos, sem PDF e sem digitar. A senha do banco é digitada na tela do próprio Pluggy — o Razão nunca vê sua senha e o acesso é só de leitura.</div>

      {configurado===false &&
        <div className="banner" style={{marginBottom:0}}>
          <b>Falta ligar o Open Finance neste app.</b> É de graça para uso pessoal e leva alguns minutos:
          crie uma aplicação em <span className="num">dashboard.pluggy.ai</span>, copie o Client ID e o Client Secret e
          salve como variáveis de ambiente na Vercel com os nomes <span className="num">PLUGGY_CLIENT_ID</span> e <span className="num">PLUGGY_CLIENT_SECRET</span> (Settings › Environment Variables).
          Depois é só refazer o deploy. As credenciais ficam só no servidor — nunca no navegador.
          {!aberto && <><br/><button className="sbtn" style={{marginTop:10}} onClick={()=>setAberto(true)}>Ver o passo a passo</button></>}
          {aberto &&
            <ol style={{margin:"10px 0 0",paddingLeft:18,lineHeight:1.7,fontSize:13}}>
              <li>Entre em <span className="num">dashboard.pluggy.ai</span> e crie a sua conta.</li>
              <li>Em "Applications", crie uma aplicação e copie o <b>Client ID</b> e o <b>Client Secret</b>.</li>
              <li>Na Vercel, abra o projeto do Razão em Settings › Environment Variables.</li>
              <li>Adicione <span className="num">PLUGGY_CLIENT_ID</span> e <span className="num">PLUGGY_CLIENT_SECRET</span> com esses valores.</li>
              <li>Opcional, mas recomendado: adicione <span className="num">PLUGGY_ALLOWED_USERS</span> com o seu e-mail, para só a sua conta poder conectar bancos.</li>
              <li>Clique em Redeploy. Volte aqui e o botão "Conectar meu banco" aparece.</li>
            </ol>}
        </div>}

      {configurado===true && !logado &&
        <div className="banner" style={{marginBottom:0}}>Entre com a sua conta para conectar um banco. No modo local o app não consegue provar quem está pedindo os dados, e o Open Finance fica desligado por segurança.</div>}

      {conexoes.length>0 &&
        <div className="uplist" style={{marginTop:4}}>
          {conexoes.map(c=>{
            const st=PLUGGY_ITEM_STATUS[String(c.lastStatus||"").toUpperCase()];
            const sincronizando=busy===c.id;
            return (
              <div className="uprow" key={c.id}>
                <Icon name="banco" size={15} style={{color:"var(--accent)",flex:"0 0 auto"}}/>
                <div className="upinfo">
                  <div className="upname">{c.connectorName}</div>
                  {sincronizando && <div className="uprowbar"><i style={{width:`${Math.max(4,etapa.pct*100)}%`}}/></div>}
                </div>
                <span className="dstat">
                  {sincronizando
                    ? <React.Fragment><i className="dspin"/> {etapa.label}</React.Fragment>
                    : st && !st.ok
                      ? <span style={{color:"var(--warn)"}}>Precisa de atenção</span>
                      : c.lastSyncAt ? `atualizado em ${fmtDateBR(c.lastSyncAt.slice(0,10))}` : "nunca atualizado"}
                </span>
                {st && st.reconectar
                  ? <button className="sbtn ofact" disabled={!!busy} onClick={()=>conectar(c.id)}>Reconectar</button>
                  : <button className="sbtn ofact" disabled={!!busy} onClick={()=>sincronizar(c)}><Icon name="atualizar" size={13}/> Atualizar</button>}
                <button className="sbtn iconsbtn" aria-label={"Desconectar "+c.connectorName} disabled={!!busy} onClick={()=>remover(c)}><Icon name="fechar" size={13}/></button>
              </div>
            );
          })}
        </div>}

      {erro && <p className="hint" style={{color:"var(--neg)",marginTop:10}}>{erro}</p>}

      {podeConectar &&
        <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
          {conexoes.length===0 &&
            <button className="sbtn primary" disabled={!!busy} onClick={()=>conectar()}>
              {busy==="conectando" ? <React.Fragment><i className="dspin"/> Abrindo…</React.Fragment> : <React.Fragment><Icon name="banco" size={14}/> Conectar meu banco</React.Fragment>}
            </button>}
          <button className="sbtn" disabled={!!busy} onClick={()=>{ setColando(v=>!v); setErro(""); }}>
            <Icon name="editar" size={14}/> {colando?"Cancelar":"Já uso o Meu Pluggy"}
          </button>
          {conexoes.length>0 &&
            <React.Fragment>
              <span className="hint" style={{margin:0}}>Buscar:</span>
              <select className="fld" style={{width:"auto",padding:"7px 10px",fontSize:13}} value={periodo} onChange={e=>setPeriodo(e.target.value)}>
                <option value="auto">Desde a última atualização</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="365">Últimos 12 meses</option>
              </select>
            </React.Fragment>}
        </div>}

      {podeConectar && colando &&
        <div style={{marginTop:12}}>
          <p className="hint" style={{marginTop:0}}>
            Se os seus bancos já estão conectados em <span className="num">meu.pluggy.ai</span>, não precisa conectar de novo:
            abra a conexão lá, copie o <b>itemId</b> e cole aqui. Um itemId por vez — repita para cada banco.
          </p>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <input className="fld" style={{flex:"1 1 320px",fontFamily:"'IBM Plex Mono',monospace",fontSize:13}}
              placeholder="11111111-2222-3333-4444-555555555555"
              value={itemIdTxt} onChange={e=>setItemIdTxt(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!busy) adicionarPorId(); }}
              aria-label="itemId da conexão no Meu Pluggy"/>
            <button className="sbtn primary" disabled={!!busy||!itemIdTxt.trim()} onClick={adicionarPorId}>
              {busy==="conectando" ? <React.Fragment><i className="dspin"/> Conferindo…</React.Fragment> : "Adicionar"}
            </button>
          </div>
          <p className="hint" style={{marginBottom:0}}>
            O itemId só funciona aqui se tiver sido criado pela <b>mesma aplicação</b> do Pluggy cujo Client ID está configurado no servidor.
          </p>
        </div>}

      {conexoes.length>0 &&
        <p className="hint" style={{marginBottom:0}}>Nada entra no app sozinho: o que vem do banco aparece na revisão abaixo, e você confirma. Lançamentos ainda não efetivados vêm marcados como "conferir".</p>}
    </div>
  );
}

export { OpenFinance };
