/* components/help/WelcomeTour.jsx — tour de boas-vindas na primeira visita. */
import React, { useEffect, useState } from "react";
import { Sheet } from "../common/Modal";

let tourListener=null;
function replayTour(){ tourListener && tourListener(); }
const TOUR_STEPS=[
  { title:"Bem-vindo ao Razão", text:"Um jeito rápido de registrar e entender seu dinheiro, sem planilha. Vamos ver o essencial em poucos passos." },
  { title:"O caminho mais rápido: importar do banco", text:"Baixe os PDFs do mês no site do seu banco e do seu cartão e jogue todos de uma vez em \"Importar do banco\". A IA descobre de qual banco é cada arquivo, separa gasto, entrada, pagamento de fatura e transferência entre bancos — você só confere e importa." },
  { title:"Ou registre na mão, quando preferir", text:"Gastos, ganhos, investimentos e transferências — use o botão de adicionar (o + central no celular, ou o botão \"Novo movimento\" no canto da tela, no computador)." },
  { title:"Acompanhe pela Home e por Gastos", text:"A Home mostra o resumo e o histórico completo desde o início; Gastos mostra mês a mês, com gráficos, busca e filtros." },
  { title:"Nomeie suas contas com o banco de verdade", text:"Em Contas, troque \"Conta principal\" pelo nome real (Nubank, Itaú, Inter). É por esse nome que a importação reconhece sozinha de quem é cada PDF. Aproveite e configure fechamento e vencimento dos cartões: assim um gasto no cartão conta na fatura do mês certo, não no mês da compra." },
  { title:"Precisa de ajuda?", text:"A Ajuda (em Configurações) tem um manual completo com exemplos ao vivo, e o ícone \"?\" nos cartões principais leva direto pra seção certa." },
];
function WelcomeTour(){
  const [open,setOpen]=useState(false);
  const [step,setStep]=useState(0);
  useEffect(()=>{
    tourListener=()=>{ setStep(0); setOpen(true); };
    try{ if(!localStorage.getItem("razao_tour_seen")){ setStep(0); setOpen(true); } }catch(_){}
    return ()=>{ tourListener=null; };
  },[]);
  function finish(){ setOpen(false); try{ localStorage.setItem("razao_tour_seen","1"); }catch(_){} }
  const s=TOUR_STEPS[step];
  return (
    <Sheet open={open} onClose={finish} title="">
      <div className="tourstep">Passo {step+1} de {TOUR_STEPS.length}</div>
      <h4 style={{fontFamily:"'Sora',sans-serif",fontSize:17,marginBottom:8}}>{s.title}</h4>
      <p style={{fontSize:14,lineHeight:1.6,color:"var(--text-mut)"}}>{s.text}</p>
      <div className="tourdots">{TOUR_STEPS.map((_,i)=><i key={i} className={i===step?"on":""}/>)}</div>
      <div style={{display:"flex",gap:10}}>
        {step<TOUR_STEPS.length-1
          ? <React.Fragment>
              <button className="sbtn" style={{flex:1,justifyContent:"center"}} onClick={finish}>Pular</button>
              <button className="sbtn primary" style={{flex:1,justifyContent:"center"}} onClick={()=>setStep(x=>x+1)}>Próximo</button>
            </React.Fragment>
          : <button className="sbtn primary" style={{flex:1,justifyContent:"center"}} onClick={finish}>Concluir</button>}
      </div>
    </Sheet>
  );
}

export { tourListener, replayTour, TOUR_STEPS, WelcomeTour };
