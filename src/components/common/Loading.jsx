/* components/common/Loading.jsx — telas de carregamento, de erro de carregamento e o diálogo de conflito entre aparelhos. */
import React from "react";
import { BrandMark, Icon } from "./Icon";
import { Sheet } from "./Modal";

/* ---- skeletons / estado vazio ---- */
function Skeleton({ w="100%", h=14, r=8, style }){
  return <div className="skel" style={{ width:w, height:h, borderRadius:r, ...style }}/>;
}
function SkeletonScreen(){
  return (
    <div className="rz dark">
      <div className="topbar"><div className="topbar-in">
        <div className="brandmark"><BrandMark/><div className="brandtext"><Skeleton w={64} h={16}/></div></div>
        <Skeleton w={140} h={34} r={999} style={{margin:"0 auto"}}/>
        <Skeleton w={38} h={38} r={11}/>
      </div></div>
      <div className="wrap"><div className="shell">
        <div className="sidebar" style={{display:"none"}}/>
        <div className="tabcontent">
          <div className="card g-12"><Skeleton w={120} h={11}/><Skeleton w={220} h={38} style={{margin:"10px 0 16px"}}/><Skeleton w="100%" h={48} r={12}/></div>
          <div className="card g-6"><Skeleton w="50%" h={13}/><Skeleton w="100%" h={90} style={{marginTop:14}} r={12}/></div>
          <div className="card g-6"><Skeleton w="50%" h={13}/><Skeleton w="100%" h={90} style={{marginTop:14}} r={12}/></div>
        </div>
      </div></div>
    </div>
  );
}
function LoadErrorScreen({ message, onRetry, onSignOut }){
  return (
    <div className="rz dark">
      <div className="wrap" style={{maxWidth:460,paddingTop:110,textAlign:"center"}}>
        <div className="bigicon" style={{display:"flex",justifyContent:"center",marginBottom:16,color:"var(--neg)"}}><Icon name="alerta" size={40}/></div>
        <h2 style={{fontFamily:"'Sora',sans-serif",fontSize:20,marginBottom:8}}>Não foi possível carregar seus dados</h2>
        <p style={{color:"var(--text-mut)",fontSize:14,marginBottom:10,lineHeight:1.5}}>Isso costuma ser uma falha de conexão temporária. Seus dados salvos não foram apagados — tentar de novo deve resolver.</p>
        <p className="mono" style={{fontSize:11,color:"var(--text-mut)",opacity:.7,marginBottom:24,wordBreak:"break-word"}}>{message}</p>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button className="sbtn primary" onClick={onRetry}>Tentar de novo</button>
          {onSignOut && <button className="sbtn" onClick={onSignOut}>Sair da conta</button>}
        </div>
      </div>
    </div>
  );
}
function ConflictDialog({ open, message, onReload, onKeep, onClose }){
  return (
    <Sheet open={open} onClose={onClose} title="Dados alterados em outro dispositivo">
      <p style={{fontSize:14,color:"var(--text-mut)",lineHeight:1.5,marginBottom:20}}>
        {message||"Seus dados foram alterados em outro dispositivo. Para não perder nada, escolha uma opção:"}
      </p>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <button className="sbtn primary" style={{justifyContent:"center"}} onClick={onReload}>Recarregar (descarta o que está na tela)</button>
        <button className="sbtn danger" style={{justifyContent:"center"}} onClick={onKeep}>Manter o desta tela (grava por cima)</button>
      </div>
    </Sheet>
  );
}

export { Skeleton, SkeletonScreen, LoadErrorScreen, ConflictDialog };
