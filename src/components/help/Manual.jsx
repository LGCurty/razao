/* components/help/Manual.jsx — Manual do usuário (menu › Ferramentas): o manual com exemplos ao vivo sobre dados fictícios. */
import React, { useEffect, useState } from "react";
import { Donut, Legend, ProgressBar } from "../common/Charts";
import { Icon } from "../common/Icon";
import { Money } from "../common/Input";
import { replayTour } from "./WelcomeTour";
import { TxRow } from "../movements/MovementList";
import { CAT_COLOR, CAT_ICON, CLASS_COLOR } from "../../domain/categories";
import { TYPES, isRealized } from "../../domain/types";
import { brl } from "../../utils/formatters";

/* ================================================================================
   MANUAL DE USO (Ajuda) — Fase 7. Tudo aqui roda sobre DEMO_DATA, um conjunto
   fictício isolado do estado real: nenhum exemplo desta aba lê, grava ou altera os
   dados de verdade. Os poucos formulários "ao vivo" usam estado local só deles,
   nunca update() nem chamadas de IA reais — e dizem isso explicitamente.
   ================================================================================ */
const DEMO_DATA = (()=>{
  const acc1={id:"demo-a1",name:"Conta Corrente",kind:"conta",color:"#3B63C4",openingBalance:150000,openingDate:"2026-01-05"};
  const acc2={id:"demo-c1",name:"Cartão Roxo",kind:"cartao",color:"#A57BE0",closingDay:20,dueDay:28,limit:300000,openingBalance:0,openingDate:""};
  const accounts=[acc1,acc2];
  const today=new Date();
  const iso=(dt)=>new Date(dt.getTime()-dt.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const d=(daysAgo)=>{ const x=new Date(today); x.setDate(x.getDate()-daysAgo); return iso(x); };
  const transactions=[
    { id:"demo-t1", type:"ganho", cents:450000, category:"Salário Mensal", description:"Salário", date:d(20), acctId:acc1.id, status:"realizado" },
    { id:"demo-t2", type:"gasto", cents:8900, category:"Vida Diária", description:"Mercado #casa", date:d(18), acctId:acc1.id, status:"realizado" },
    { id:"demo-t3", type:"gasto", cents:3200, category:"Transporte", description:"Uber #trabalho", date:d(15), acctId:acc2.id, status:"realizado" },
    { id:"demo-t4", type:"gasto", cents:5500, category:"Entretenimento", description:"Cinema", date:d(10), acctId:acc2.id, status:"realizado" },
    { id:"demo-t5", type:"investimento", cents:60000, category:"Renda Fixa", description:"Aporte mensal", date:d(9), acctId:acc1.id, status:"realizado" },
    { id:"demo-t6", type:"transferencia", cents:35000, category:"", description:"Pagamento da fatura", date:d(5), acctId:acc1.id, toAcctId:acc2.id, status:"realizado" },
    { id:"demo-t7", type:"gasto", cents:12000, category:"Contas", description:"Internet", date:d(3), acctId:acc1.id, status:"realizado" },
    { id:"demo-t8", type:"ganho", cents:15000, category:"Renda extra", description:"Bico de fim de semana", date:iso(new Date(today.getTime()+3*86400000)), acctId:acc1.id, status:"previsto" },
  ];
  const budgets={ "Vida Diária":100000, "Entretenimento":40000 };
  const goals=[{ id:"demo-g1", name:"Viagem", target:500000, saved:120000, deadline:iso(new Date(today.getFullYear(),today.getMonth()+6,1)), linkedCategory:null }];
  const holdings=[{ id:"demo-h1", name:"Tesouro Selic 2029", cls:"Renda Fixa", invested:200000, current:214000 }];
  return { accounts, transactions, budgets, goals, holdings };
})();
const DEMO_ACCOUNTS = DEMO_DATA.accounts.map(a=>{
  let balance=a.openingBalance||0;
  DEMO_DATA.transactions.filter(isRealized).forEach(t=>{
    if(t.type==="transferencia"){
      if(t.acctId===a.id) balance-=t.cents;
      if(t.toAcctId===a.id) balance+=t.cents;
    } else if(t.acctId===a.id){
      balance+=t.cents*TYPES[t.type].sign;
    }
  });
  return { ...a, balance };
});
const DEMO_ACCT_NAME=(id)=>DEMO_ACCOUNTS.find(a=>a.id===id);
const DEMO_BY_CAT = (()=>{
  const m={};
  DEMO_DATA.transactions.filter(t=>isRealized(t)&&t.type==="gasto").forEach(t=>{ m[t.category]=(m[t.category]||0)+t.cents; });
  return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value,color:CAT_COLOR[name]||"var(--text-mut)"}));
})();
const DEMO_BUDGET_ROWS = Object.entries(DEMO_DATA.budgets).map(([cat,limit])=>{
  const spent=DEMO_DATA.transactions.filter(t=>isRealized(t)&&t.type==="gasto"&&t.category===cat).reduce((s,t)=>s+t.cents,0);
  const pct=limit>0?spent/limit:0;
  return { cat, limit, spent, pct, status: pct>=1?"over":pct>=0.8?"warn":"ok" };
});
const DEMO_PATRIMONIO = DEMO_ACCOUNTS.filter(a=>a.kind==="conta").reduce((s,a)=>s+a.balance,0) + DEMO_DATA.holdings.reduce((s,h)=>s+h.current,0);
const DEMO_BY_CLASS = (()=>{
  const m={};
  DEMO_DATA.holdings.forEach(h=>{ m[h.cls]=(m[h.cls]||0)+h.current; });
  return Object.entries(m).map(([name,value])=>({name,value,color:CLASS_COLOR[name]||"var(--text-mut)"}));
})();

function HelpExample({ label, children }){
  return (
    <div className="helpexample">
      <div className="helpexamplelabel"><Icon name="olho" size={12}/> Exemplo com dados fictícios{label?` — ${label}`:""} (não altera os seus dados)</div>
      {children}
    </div>
  );
}
/* diagramas SVG: só usados onde um componente ao vivo não faz sentido (dependem de gesto de toque ou de
   um contexto de tela cheia no celular) — desenhados com os mesmos tokens de cor/tipografia do app */
function SwipeDiagram(){
  return (
    <svg viewBox="0 0 320 70" width="100%" height="70" style={{maxWidth:340,display:"block"}} role="img" aria-label="Diagrama: arraste um lançamento para a esquerda para revelar editar e excluir">
      <rect x="4" y="8" width="230" height="54" rx="12" fill="var(--surface)" stroke="var(--hairline)"/>
      <circle cx="30" cy="35" r="12" fill="var(--neg-bg)"/>
      <text x="54" y="31" fontSize="12" fill="var(--text)" fontFamily="Inter,sans-serif">Mercado</text>
      <text x="54" y="46" fontSize="10" fill="var(--text-mut)" fontFamily="Inter,sans-serif">Vida Diária</text>
      <rect x="238" y="8" width="78" height="54" rx="12" fill="var(--neg-bg)"/>
      <text x="277" y="40" fontSize="10" fill="var(--neg)" textAnchor="middle" fontFamily="Inter,sans-serif">Excluir</text>
      <path d="M175 65 L145 65" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#swipearrow)"/>
      <defs><marker id="swipearrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="var(--accent)"/></marker></defs>
    </svg>
  );
}
function BottomNavDiagram(){
  const left=[["Home",40],["Gastos",110]];
  const right=[["Orçamento",250],["Investimentos",310]];
  return (
    <svg viewBox="0 0 350 76" width="100%" height="76" style={{maxWidth:360,display:"block"}} role="img" aria-label="Diagrama: barra inferior do celular com o botão de adicionar lançamento no centro">
      <rect x="0" y="6" width="350" height="56" rx="14" fill="var(--surface)" stroke="var(--hairline)"/>
      {left.map(([label,x])=>(
        <g key={label}><circle cx={x} cy="34" r="10" fill="none" stroke="var(--text-mut)" strokeWidth="1.5"/><text x={x} y="58" fontSize="8" fill="var(--text-mut)" textAnchor="middle" fontFamily="Inter,sans-serif">{label}</text></g>
      ))}
      <circle cx="175" cy="34" r="22" fill="var(--accent)"/>
      <line x1="175" y1="25" x2="175" y2="43" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="166" y1="34" x2="184" y2="34" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
      {right.map(([label,x])=>(
        <g key={label}><circle cx={x} cy="34" r="10" fill="none" stroke="var(--text-mut)" strokeWidth="1.5"/><text x={x} y="58" fontSize="8" fill="var(--text-mut)" textAnchor="middle" fontFamily="Inter,sans-serif">{label}</text></g>
      ))}
      <text x="175" y="72" fontSize="9" fill="var(--text-mut)" textAnchor="middle" fontFamily="Inter,sans-serif">o botão central abre "novo lançamento" em qualquer aba</text>
    </svg>
  );
}

const HELP_SECTIONS=[
  {id:"primeiros-passos",n:1,title:"Primeiros passos",kw:"criar conta entrar login instalar tela inicial modo local esqueci senha primeira vez recuperar"},
  {id:"registrar-lancamentos",n:2,title:"Registrar lançamentos",kw:"lançamento gasto ganho investimento transferência valor categoria tags repetir parcelar botão adicionar fab central"},
  {id:"contas-cartoes",n:3,title:"Contas e cartões",kw:"conta cartão saldo inicial fechamento vencimento limite fatura mês seguinte competência caixa"},
  {id:"transferencias",n:4,title:"Transferências",kw:"transferência mover dinheiro pagar fatura cartão"},
  {id:"orcamento-ajuda",n:5,title:"Orçamento",kw:"orçamento limite categoria mês histórico barra aviso estourou exceção"},
  {id:"metas-ajuda",n:6,title:"Metas",kw:"meta guardar dinheiro prazo objetivo poupança ligada categoria real"},
  {id:"investimentos-ajuda",n:7,title:"Investimentos",kw:"investimento ativo aporte provento carteira selic cdi ipca independência financeira"},
  {id:"extrato-ajuda",n:8,title:"Importar do banco",kw:"extrato inteligente extrato pdf recibo foto print imagem importar colar texto duplicata auditoria fatura nota de corretagem corretora ativos carteira vários múltiplos bancos open finance pluggy conectar banco sincronizar automático lote arrastar progresso ia modelo transferência entre bancos pagamento de fatura trocar conta em massa"},
  {id:"assistente-ajuda",n:9,title:"Assistente",kw:"assistente perguntar pergunta ia inteligência artificial"},
  {id:"busca-filtros",n:10,title:"Busca e filtros",kw:"busca buscar filtro filtros chip categoria conta data valor status previsto realizado tag"},
  {id:"panorama-ajuda",n:11,title:"Home e Panorama",kw:"home resumo panorama menu busca buscar lupa patrimônio comprometimento parcelamento indicador tag gasto por tag banco central"},
  {id:"backup-seguranca",n:12,title:"Exportação, backup e segurança",kw:"exportação excel xlsx planilha relatório pdf imprimir compartilhar whatsapp backup exportar importar json csv mesclar substituir segurança senha dados bancários"},
  {id:"faq",n:13,title:"Perguntas frequentes",kw:"saldo não bate fatura sumiu esqueci senha offline internet dúvida"},
];
function HelpSection({ id, n, title, purpose, steps, tip, children }){
  return (
    <div className="card helpsection" id={"help-"+id}>
      <div className="helpn">Seção {n} de {HELP_SECTIONS.length}</div>
      <h4>{title}</h4>
      <p style={{fontSize:13,color:"var(--text-mut)",lineHeight:1.5,marginBottom:steps?.length?10:0}}>{purpose}</p>
      {steps?.length>0 && <ol className="helpsteps">{steps.map((s,i)=><li key={i}>{s}</li>)}</ol>}
      {children}
      {tip && <div className="helptip"><Icon name="brilho" size={14} style={{flex:"0 0 auto"}}/><span>{tip}</span></div>}
    </div>
  );
}

/* mini-formulário de exemplo: mesmos campos do formulário real de lançamento, mas com estado 100% local
   — "Salvar" não chama update() nem grava nada, é só pra mostrar como o fluxo funciona */
function DemoTxForm(){
  const [type,setType]=useState("gasto");
  const [cents,setCents]=useState(4590);
  const [desc,setDesc]=useState("Mercado #casa");
  const [saved,setSaved]=useState(false);
  return (
    <div className="add" style={{padding:0,border:"none"}}>
      <div className="seg" style={{marginBottom:10}}>
        {Object.entries(TYPES).filter(([k])=>k!=="transferencia").map(([k,v])=><button key={k} className={(type===k?"on ":"")+v.cls} onClick={()=>setType(k)}>{v.label}</button>)}
      </div>
      <Money cents={cents} onChange={setCents} small/>
      <input className="fld" style={{marginTop:10}} placeholder="Descrição — use #tags" value={desc} onChange={e=>setDesc(e.target.value)}/>
      <button className="sbtn primary" style={{marginTop:10}} onClick={()=>{setSaved(true);setTimeout(()=>setSaved(false),1600);}}>{saved?<><Icon name="check" size={14}/> Salvo (exemplo)</>:"Salvar lançamento (exemplo)"}</button>
    </div>
  );
}

function Ajuda({ helpTarget, onConsumeTarget }){
  const [search,setSearch]=useState("");
  const q=search.trim().toLowerCase();
  const visible=(id)=>{
    if(!q) return true;
    const meta=HELP_SECTIONS.find(s=>s.id===id);
    return meta.title.toLowerCase().includes(q) || meta.kw.includes(q);
  };
  useEffect(()=>{
    if(!helpTarget) return;
    setSearch("");
    const t=setTimeout(()=>{ document.getElementById("help-"+helpTarget)?.scrollIntoView({behavior:"smooth",block:"start"}); },80);
    onConsumeTarget();
    return ()=>clearTimeout(t);
  },[helpTarget]);
  const jump=(id)=>document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"});

  return (
    <div className="helpwrap">
      <nav className="helpnav" aria-label="Seções do manual">
        {HELP_SECTIONS.map(s=><button key={s.id} onClick={()=>jump("help-"+s.id)}>{s.n}. {s.title}</button>)}
        <button onClick={()=>jump("help-glossario")}>Glossário</button>
      </nav>
      <div className="helpcontent">
        <div className="card">
          <h3>Manual de uso</h3>
          <div className="sub">Tudo o que você precisa pra usar o Razão, com exemplos ao vivo — dados fictícios, nunca os seus.</div>
          <div className="searchfield">
            <span className="searchicon"><Icon name="buscar" size={16}/></span>
            <input className="fld" placeholder="Buscar no manual…" value={search} onChange={e=>setSearch(e.target.value)}/>
            {search && <button className="clearbtn" aria-label="Limpar busca" onClick={()=>setSearch("")}><Icon name="fechar" size={14}/></button>}
          </div>
          <button className="sbtn" style={{marginTop:12}} onClick={replayTour}><Icon name="brilho" size={14}/> Rever o tour de boas-vindas</button>
        </div>

        {visible("primeiros-passos") &&
          <HelpSection id="primeiros-passos" n={1} title="Primeiros passos"
            purpose="Como começar a usar o Razão, com ou sem conta na nuvem."
            steps={[
              "Ao abrir o app pela primeira vez, você pode criar uma conta com e-mail e senha, ou continuar em Modo local (os dados ficam só neste aparelho, sem sincronizar entre dispositivos).",
              "Se criar conta, confirme o e-mail recebido — ao confirmar, você volta automaticamente para o app já autenticado.",
              "Esqueceu a senha? Use \"Esqueci minha senha\" na tela de entrada para receber um link de redefinição por e-mail.",
              "No celular, para instalar como app: abra o menu do navegador e escolha \"Adicionar à tela inicial\" (ou \"Instalar app\", dependendo do navegador).",
            ]}
            tip="Modo local e conta na nuvem não são um sorteio único — dá pra criar conta depois e importar um backup exportado do modo local (veja a seção 12).">
            <HelpExample label="tela de entrada (ilustrativa)">
              <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:280}}>
                <input className="fld" placeholder="seu@email.com" readOnly/>
                <input className="fld" placeholder="Senha" type="password" readOnly/>
                <button className="submit" type="button" tabIndex={-1}>Entrar</button>
                <button className="sbtn" type="button" tabIndex={-1} style={{justifyContent:"center"}}>Continuar em Modo local</button>
              </div>
            </HelpExample>
          </HelpSection>}

        {visible("registrar-lancamentos") &&
          <HelpSection id="registrar-lancamentos" n={2} title="Registrar lançamentos"
            purpose="Os quatro tipos de lançamento e os campos do formulário."
            steps={[
              "Escolha o tipo: Despesa, Renda, Investimento ou Transferência. Depois o valor, a categoria, o banco/conta, a data e o método de pagamento (Pix, crédito, débito, dinheiro, boleto…) — o método já vem sugerido pela conta.",
              "Digite o valor sem vírgula — os dois últimos dígitos viram os centavos automaticamente (ex: 1590 vira R$ 15,90).",
              "Escolha a categoria, ou deixe a IA sugerir enquanto você digita a descrição (ela também aprende com o que você já categorizou antes).",
              "Use #tags na descrição pra marcar lançamentos que quer acompanhar juntos depois (ex: #viagem) — elas viram chips clicáveis na lista.",
              "Marque \"Repetir / Parcelar\" pra criar vários lançamentos de uma vez: fixo repete o mesmo valor todo mês, parcelado divide o valor total.",
            ]}
            tip="No celular, arraste um lançamento da lista para a esquerda pra revelar os botões de editar e excluir.">
            <HelpExample label="formulário de lançamento"><DemoTxForm/></HelpExample>
            <HelpExample label="arrastar para editar/excluir (mobile)"><SwipeDiagram/></HelpExample>
            <HelpExample label="atalho do botão central (mobile)"><BottomNavDiagram/></HelpExample>
          </HelpSection>}

        {visible("contas-cartoes") &&
          <HelpSection id="contas-cartoes" n={3} title="Contas e cartões"
            purpose="A diferença entre conta e cartão, saldo inicial, e por que um gasto no cartão pode aparecer no mês seguinte."
            steps={[
              "Conta: dinheiro que você já tem (corrente, poupança, carteira). Cartão: dinheiro que você ainda vai pagar, numa fatura.",
              "Saldo inicial é o que você já tinha antes de começar a registrar aqui — sem ele, o saldo mostrado no app não bate com o do banco.",
              "Em cartões, configure o dia de fechamento e de vencimento: isso decide em qual fatura (mês) cada compra entra.",
              "Pague a fatura por uma Transferência da conta para o cartão (seção 4) — isso zera o valor devido.",
            ]}
            tip="Isso é competência × caixa: o gasto pertence ao mês da fatura (competência), não ao mês em que o cartão foi passado (caixa). Uma compra de 25/07 com fechamento dia 20 cai na fatura de agosto, não de julho.">
            <HelpExample label="lista de contas">
              {DEMO_ACCOUNTS.map(a=>(
                <div className="acct" key={a.id}>
                  <div className="adot" style={{background:a.color}}><Icon name={a.kind==="cartao"?"cartao":"banco"} size={16}/></div>
                  <div style={{flex:1}}>
                    <div className="aname">{a.name}</div>
                    <div className="akind">{a.kind==="cartao"?`Cartão · fecha dia ${a.closingDay} · vence dia ${a.dueDay}`:"Conta"}</div>
                  </div>
                  <span className="num" style={{fontSize:15,fontWeight:500,color:a.balance>=0?"var(--pos)":"var(--neg)"}}>{brl(a.balance)}</span>
                </div>
              ))}
            </HelpExample>
          </HelpSection>}

        {visible("transferencias") &&
          <HelpSection id="transferencias" n={4} title="Transferências"
            purpose="Mover dinheiro entre suas próprias contas, e como isso paga a fatura do cartão."
            steps={[
              "Escolha o tipo Transferência, a conta de origem e a de destino.",
              "Uma transferência não conta como gasto nem ganho no seu total do mês — ela só move saldo entre contas.",
              "Pra pagar a fatura do cartão: transfira da conta corrente para o cartão, no valor da fatura.",
            ]}
            tip="Transferir para o cartão reduz o valor da fatura em aberto na hora — dá pra conferir em Configurações › Contas e bancos.">
            <HelpExample label="lançamento de transferência">
              <TxRow t={DEMO_DATA.transactions.find(t=>t.type==="transferencia")} cls="trf" acc={null} isTrf shifted={false} flowLabel={null}
                acctName={DEMO_ACCT_NAME} onEdit={()=>{}} onDelete={()=>{}} onMarkPaid={()=>{}}/>
            </HelpExample>
          </HelpSection>}

        {visible("orcamento-ajuda") &&
          <HelpSection id="orcamento-ajuda" n={5} title="Orçamento"
            purpose="Definir quanto você quer gastar em cada categoria e acompanhar o andamento."
            steps={[
              "Escolha a categoria e o valor limite.",
              "Decida se o limite vale só para o mês atual (sazonal, ex: dezembro) ou para todos os meses (padrão).",
              "A barra mostra o quanto já foi gasto; fica amarela perto do limite e vermelha ao estourar.",
              "O histórico (mín/média/máx dos últimos meses) ajuda a definir um limite realista.",
            ]}
            tip="Gastos no cartão contam no orçamento pelo mês da fatura, não pelo mês da compra — a mesma régua da seção 3.">
            <HelpExample label="categoria com orçamento">
              {DEMO_BUDGET_ROWS.map(r=>(
                <div className="budrow" key={r.cat}>
                  <div className="bh">
                    <span className="bname"><Icon name={CAT_ICON[r.cat]||"outros"} size={15}/> {r.cat}
                      {r.status==="over" && <span className="tag over">estourou</span>}
                      {r.status==="warn" && <span className="tag warn">atenção</span>}
                      {r.status==="ok" && <span className="tag ok">no limite</span>}
                    </span>
                    <span className="bval">{brl(r.spent)} <span style={{color:"var(--text-mut)"}}>/ {brl(r.limit)}</span></span>
                  </div>
                  <ProgressBar spent={r.spent} limit={r.limit} status={r.status}/>
                </div>
              ))}
            </HelpExample>
          </HelpSection>}

        {visible("metas-ajuda") &&
          <HelpSection id="metas-ajuda" n={6} title="Metas"
            purpose="Criar objetivos de longo prazo (viagem, reserva de emergência) e acompanhar o progresso."
            steps={[
              "Defina um nome, o valor total e, opcionalmente, um prazo — o app calcula quanto guardar por mês pra chegar lá.",
              "Use \"Guardar dinheiro\" pra somar manualmente um valor ao progresso.",
              "Ou ligue a meta a uma categoria real (de ganho ou investimento): todo lançamento real daquela categoria passa a somar automaticamente, sem precisar avisar a meta.",
            ]}
            tip="Uma meta ligada a categoria soma o manual + o automático — os dois juntos, nunca em dobro.">
            <HelpExample label="meta com progresso">
              {DEMO_DATA.goals.map(g=>{
                const pct=Math.min(100,g.saved/g.target*100);
                return (
                  <div className="goal" key={g.id}>
                    <div className="gh">
                      <div>
                        <div className="gname"><Icon name="metas" size={16}/> {g.name}</div>
                        <div className="gsub">{pct.toFixed(0)}% concluído · prazo {new Date(g.deadline+"T00:00:00").toLocaleDateString("pt-BR",{month:"short",year:"numeric"})}</div>
                      </div>
                    </div>
                    <div className="bar"><i style={{width:pct+"%",background:"var(--inv)"}}/></div>
                    <div className="gv"><span className="num">{brl(g.saved)}</span><span className="num" style={{color:"var(--text-mut)"}}>{brl(g.target)}</span></div>
                  </div>);
              })}
            </HelpExample>
          </HelpSection>}

        {visible("investimentos-ajuda") &&
          <HelpSection id="investimentos-ajuda" n={7} title="Investimentos"
            purpose="Cadastrar sua carteira, acompanhar aportes, proventos e indicadores de mercado."
            steps={[
              "Cadastre cada ativo com o valor aplicado e o valor atual — a diferença é o rendimento.",
              "Lançamentos do tipo Investimento contam como aporte do mês; do tipo Renda na categoria \"Proventos\" contam como provento.",
              "Selic, CDI e IPCA (Banco Central) aparecem na Home, atualizados uma vez por dia.",
              "Independência Financeira mostra quanto os proventos médios dos últimos 6 meses cobririam dos seus gastos médios.",
            ]}
            tip="100% de Independência Financeira significa: se você parasse de trabalhar, os proventos médios sozinhos cobririam seus gastos médios.">
            <HelpExample label="composição da carteira">
              <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap"}}>
                <Donut data={DEMO_BY_CLASS} size={130} centerLabel="carteira"/>
                <div style={{flex:1,minWidth:160}}><Legend data={DEMO_BY_CLASS}/></div>
              </div>
            </HelpExample>
          </HelpSection>}

        {visible("extrato-ajuda") &&
          <HelpSection id="extrato-ajuda" n={8} title="Importar do banco"
            purpose="Fechar o mês inteiro de uma vez: conecte o banco pelo Open Finance ou jogue aqui todos os documentos dos seus bancos, cartões e corretora — a IA lê, identifica e classifica tudo."
            steps={[
              "Open Finance (o caminho curto): no cartão do topo, conecte o banco uma vez. A senha é digitada na tela do próprio Pluggy, o Razão nunca a vê, e o acesso é só de leitura. Depois é só clicar em Atualizar e os lançamentos chegam sem PDF nenhum, já separados entre conta e cartão. Se o botão não aparecer, falta configurar as credenciais do Pluggy no servidor — a própria tela explica o passo a passo.",
              "A conta e o cartão de cada banco conectado são criados sozinhos na primeira sincronização — não precisa cadastrar nada em Contas e bancos antes. Nas sincronizações seguintes, o app reconhece o mesmo banco pelo número da conta/cartão, sem criar duplicata.",
              "Não precisa lembrar de clicar em Atualizar: toda vez que você abre esta aba, qualquer conexão sem sincronizar há mais de 20 horas atualiza sozinha. Isso só acontece com a aba aberta — o app não roda em segundo plano com o celular fechado, e nada é importado sem passar pela sua revisão.",
              "Se os seus bancos já estão conectados no Meu Pluggy (meu.pluggy.ai), use \"Já uso o Meu Pluggy\": cole o itemId de cada conexão e pronto, sem passar pela tela de conectar de novo. O app confere o id antes de guardar. Vale lembrar que o itemId precisa ter sido criado pela mesma aplicação do Pluggy configurada no servidor.",
              "Atualizar duas vezes no mesmo mês não duplica nada: cada lançamento importado guarda o id que tem no Pluggy, e o que já entrou é ignorado na busca seguinte — o app avisa quantos ficaram de fora.",
              "Conectado o banco, o resto da tela continua valendo para o que o Open Finance não cobre: notas de corretagem, recibos, prints e bancos que você não quer conectar.",
              "Arraste (ou escolha) TODOS os documentos do mês de uma vez: extratos, faturas de cartão, notas de corretagem e recibos. Vale PDF, foto e print de tela do app do banco — um print é lido como documento inteiro, não como um lançamento só.",
              "Enquanto a IA lê, o painel mostra em que documento ela está, a fase da leitura e a porcentagem de conclusão da fila inteira.",
              "Para cada arquivo, a IA decide o que ele é, de qual banco vem, e casa com a conta ou cartão que você já cadastrou. Na primeira vez você pode precisar corrigir a conta; ao importar, o app guarda o número da conta/cartão daquele documento e passa a reconhecer sozinho nos meses seguintes.",
              "Precisa trocar a conta de vários lançamentos? A barra no topo da revisão aplica conta (ou categoria) em todos os itens marcados de uma vez, mesmo entre documentos diferentes. O seletor no cabeçalho de cada documento troca só os dele.",
              "Nota de corretagem: cada ativo comprado vira um aporte na data de liquidação (quando o dinheiro sai de verdade), as taxas viram um gasto, e aparece um painel para mandar os ativos direto para a sua carteira em Investimentos.",
              "Cada linha vira um tipo: gasto, ganho, investimento ou transferência. Pagamento de fatura e transferência entre os seus bancos viram transferência (saem de uma conta e entram na outra), então não contam como gasto novo.",
              "Gastos que aparecem numa fatura entram no cartão daquela fatura — é isso que faz o gasto pesar no mês em que a fatura vence, e não no dia da compra.",
              "Revise: desmarque o que não quiser, ajuste conta, tipo e categoria. Depois importe tudo com um clique, ou documento por documento.",
              "Duplicatas vêm desmarcadas sozinhas — tanto as que já existem no seu histórico quanto as que aparecem em dois documentos (o caso clássico: o pagamento da fatura, que sai no extrato da conta e chega na fatura do cartão).",
              "Em Contas, o botão de auditoria de fatura ainda existe, para conferir um cartão específico contra o que já está registrado.",
            ]}
            tip="Se a IA estiver fora do ar ou sem cota, o PDF ainda é lido localmente pelo leitor embutido (só reconhece gasto e ganho, sem identificar banco nem transferência). Em Configurações › Preferências dá para trocar o motor de IA entre Rápido e Cuidadoso — vale mudar para Cuidadoso quando alguma fatura vier com muitas linhas erradas. Arquivos acima de 3 MB podem não caber numa leitura só.">
            <HelpExample label="a IA lendo a fila de documentos">
              <div className="aithink">
                <div className="aiorb"><i/><i/><i/><span className="core"/></div>
                <div className="aibody">
                  <div className="aititle"><span>Analisando seus documentos</span><span className="aipct">62%</span></div>
                  <div className="aiphase">2 de 3 concluídos · IA lendo o documento: fatura-cartao-julho.pdf</div>
                  <div className="aibar"><i style={{width:"62%"}}/><span/></div>
                </div>
              </div>
            </HelpExample>
            <HelpExample label="documento identificado e classificado">
              <div className="dochead">
                <span className="badge fatura">Fatura</span>
                <b style={{fontSize:13}}>Nubank</b>
                <span style={{fontSize:12,color:"var(--text-mut)"}}>01/07/2026 a 31/07/2026 · 24 lançamentos · total R$ 1.842,30</span>
              </div>
              <div className="docbody">
                <div className="itemrow">
                  <input type="checkbox" checked readOnly tabIndex={-1}/>
                  <div style={{flex:1,minWidth:0,fontSize:13}}>
                    10/07/2026 · Pagamento recebido <span className="tag ok" style={{marginLeft:6}}>pagamento de fatura</span>
                    <div className="mm" style={{marginTop:4}}>Vira transferência: sai da Conta Corrente e entra no Cartão Roxo — não conta como gasto.</div>
                  </div>
                </div>
                <div className="itemrow">
                  <input type="checkbox" checked readOnly tabIndex={-1}/>
                  <div style={{flex:1,minWidth:0,fontSize:13}}>
                    12/07/2026 · Mercado XYZ (3/10)
                    <div className="mm" style={{marginTop:4}}>Vira despesa em Vida Diária, no Cartão Roxo.</div>
                  </div>
                </div>
              </div>
            </HelpExample>
          </HelpSection>}

        {visible("assistente-ajuda") &&
          <HelpSection id="assistente-ajuda" n={9} title="Assistente"
            purpose="Pergunte em linguagem natural sobre os seus lançamentos."
            steps={[
              "Digite uma pergunta como \"quanto gastei com Uber esse ano?\" ou \"qual foi meu maior gasto em julho?\".",
              "A resposta é gerada só a partir dos seus dados — se não houver informação suficiente, o assistente diz isso em vez de inventar um número.",
            ]}
            tip="Perguntas específicas (com categoria, período ou valor) tendem a dar respostas melhores do que perguntas muito abertas.">
            <HelpExample label="pergunta e resposta">
              <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Você perguntou: quanto gastei com Vida Diária esse mês?</div>
              <div style={{fontSize:14,lineHeight:1.6,color:"var(--text-mut)"}}>No exemplo, R$ 89,00 em Vida Diária — um único lançamento, o mercado do dia 18.</div>
            </HelpExample>
          </HelpSection>}

        {visible("busca-filtros") &&
          <HelpSection id="busca-filtros" n={10} title="Busca e filtros"
            purpose="Encontrar lançamentos específicos em todo o histórico, não só no mês exibido."
            steps={[
              "Em Gastos, digite na busca por descrição ou por #tag — o resultado aparece enquanto você digita.",
              "Abra Filtros pra combinar conta, tipo, categoria, tags, intervalo de datas, status (previsto/realizado) e faixa de valor.",
              "Toque em qualquer lançamento para abrir a ficha completa (conta, banco, forma de pagamento, mês da fatura, parcela, origem) com Editar, Duplicar, Marcar como pago e Excluir — com \"Desfazer\" por alguns segundos.",
              "Lista ou Cartões: o botão acima dos lançamentos troca a lista por dia por uma grade de cartões (faixa colorida pelo tipo, \"PREVISTO\" em âmbar), que dá para ordenar por data ou por maior valor. A escolha fica guardada no aparelho.",
              "No Orçamento, toque no nome de uma categoria para ver a ficha dela: gasto, limite, quanto ainda dá para gastar, histórico e os lançamentos do mês.",
              "Cada filtro ativo vira um chip removível; \"Limpar tudo\" reseta de uma vez.",
              "Clicar numa categoria no gráfico, ou numa tag na lista, também aplica o filtro correspondente.",
            ]}
            tip="O contador de resultados e a soma aparecem junto da busca, sempre que algum filtro está ativo.">
            <HelpExample label="filtros ativos como chips">
              <div className="chiprow" style={{marginTop:0}}>
                <div className="filterchip"><span>Categoria: Vida Diária</span><button aria-label="Remover" type="button" tabIndex={-1}><Icon name="fechar" size={12}/></button></div>
                <div className="filterchip"><span>#viagem</span><button aria-label="Remover" type="button" tabIndex={-1}><Icon name="fechar" size={12}/></button></div>
              </div>
            </HelpExample>
          </HelpSection>}

        {visible("panorama-ajuda") &&
          <HelpSection id="panorama-ajuda" n={11} title="Home e Panorama"
            purpose="A Home resume o mês; o Panorama (botão “Ver o panorama completo” ou menu ☰ › Painel) é a visão consolidada de todos os meses e contas, com os indicadores extras."
            steps={[
              "Menu ☰ (no topo, no celular): todas as telas em grupos, com contadores — lançamentos do mês e orçamentos dentro do limite, em atenção e estourados. Tocar em \"Atenção\" ou \"Estourados\" já abre o orçamento filtrado.",
              "Lupa (busca): acha qualquer movimento de qualquer mês por descrição, categoria, conta, #tag ou valor (\"85\" acha de R$ 85,00 a R$ 85,99; \"85,50\" acha o valor exato). Tocar no resultado abre o movimento.",
              "Análise interativa (topo do Panorama): escolha Gastos ou Renda e o período (3, 6, 12 meses ou tudo). Toque numa barra de categoria, conta ou mês para filtrar os outros gráficos; os filtros aparecem em \"Filtros ativos\" e saem no ×. \"Ver os N lançamentos\" abre a lista com os mesmos filtros.",
              "Saldo por conta soma tudo desde o início; Patrimônio estimado soma contas (sem cartão) + carteira de investimentos.",
              "Histórico de patrimônio guarda um retrato automático do total ao fim de cada mês, num gráfico.",
              "Contas a pagar e lembretes lista o que está previsto pra vencer nos próximos 7 dias, ou já atrasado.",
              "Gasto por tag soma, em todo o período, o quanto foi gasto em lançamentos marcados com cada #tag.",
              "Recap automático: a IA resume sozinha a semana e o mês assim que eles terminam, sem precisar pedir.",
            ]}
            tip="Independência Financeira, indicadores do Banco Central e o recap automático dependem de ter histórico e/ou internet — sem isso, esses cartões simplesmente não aparecem.">
            <HelpExample label="patrimônio estimado">
              <div className="kv"><span className="kk">Em contas</span><span className="vv">{brl(DEMO_ACCOUNTS.filter(a=>a.kind==="conta").reduce((s,a)=>s+a.balance,0))}</span></div>
              <div className="kv"><span className="kk">Em investimentos</span><span className="vv" style={{color:"var(--inv)"}}>{brl(DEMO_DATA.holdings.reduce((s,h)=>s+h.current,0))}</span></div>
              <div className="kv"><span className="kk"><b>Total</b></span><span className="vv" style={{fontSize:18,fontWeight:600}}>{brl(DEMO_PATRIMONIO)}</span></div>
            </HelpExample>
          </HelpSection>}

        {visible("backup-seguranca") &&
          <HelpSection id="backup-seguranca" n={12} title="Exportação, backup e segurança"
            purpose="Como exportar, importar e onde os seus dados realmente ficam."
            steps={[
              "Menu ☰ › Ferramentas › Exportação: escolha o período (mês aberto, intervalo ou tudo), tipo, conta, categoria e status, e baixe em Excel (.xlsx, já com datas, valores em R$, filtro e cabeçalho fixo) ou CSV. No celular dá para mandar direto pelo compartilhamento (WhatsApp, Drive, e-mail).",
              "Relatório do mês em PDF: resumo, orçamento, gastos por categoria, saldos e todos os lançamentos do mês aberto. Abre a impressão do aparelho — escolha \"Salvar como PDF\".",
              "Em Lançamentos, o botão de baixar ao lado de Lista/Cartões exporta exatamente o que está na tela (resultado da busca e dos filtros).",
              "Exporte um backup .json completo (dá pra reimportar depois) ou um .csv (pra abrir em planilha).",
              "Ao importar um backup, escolha Mesclar (soma ao que já existe) ou Substituir tudo (apaga o atual e usa só o importado — pede confirmação digitada).",
              "Com conta na nuvem, os dados ficam no banco de dados do projeto (Supabase); em Modo local, ficam só neste aparelho.",
              "O Razão nunca pede login do seu banco, senha de cartão ou qualquer credencial bancária — todo lançamento é digitado ou importado por você.",
            ]}
            tip="Um backup antigo, de uma versão anterior do app, sempre importa sem erro — o app atualiza o formato dele sozinho ao carregar.">
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button className="sbtn" type="button" tabIndex={-1}><Icon name="baixar" size={14}/> Exportar backup (.json)</button>
              <button className="sbtn" type="button" tabIndex={-1}><Icon name="enviar" size={14}/> Importar backup</button>
            </div>
          </HelpSection>}

        {visible("faq") &&
          <HelpSection id="faq" n={13} title="Perguntas frequentes" purpose="">
            <div className="kv" style={{alignItems:"flex-start"}}><span className="kk">Por que meu saldo não bate com o do banco?</span><span className="vv" style={{textAlign:"right",maxWidth:"55%"}}>Provavelmente falta configurar o saldo inicial da conta (seção 3) — o valor que você já tinha antes de começar a registrar aqui.</span></div>
            <div className="kv" style={{alignItems:"flex-start"}}><span className="kk">Por que o gasto do cartão sumiu deste mês?</span><span className="vv" style={{textAlign:"right",maxWidth:"55%"}}>Ele não sumiu — foi pra fatura certa, que pode ser o mês seguinte dependendo do dia de fechamento (seção 3).</span></div>
            <div className="kv" style={{alignItems:"flex-start"}}><span className="kk">Esqueci a senha, e agora?</span><span className="vv" style={{textAlign:"right",maxWidth:"55%"}}>Use "Esqueci minha senha" na tela de entrada (seção 1) pra receber um link de redefinição por e-mail.</span></div>
            <div className="kv" style={{alignItems:"flex-start"}}><span className="kk">Funciona sem internet?</span><span className="vv" style={{textAlign:"right",maxWidth:"55%"}}>Sim — o app abre offline com o último estado salvo, em modo somente leitura até a conexão voltar. Em Modo local funciona 100% offline o tempo todo.</span></div>
          </HelpSection>}

        <div className="card" id="help-glossario">
          <h3>Glossário</h3>
          <div className="kv"><span className="kk">Competência</span><span className="vv" style={{textAlign:"right",maxWidth:"60%"}}>O mês "dono" de um gasto — no cartão, é o mês da fatura, não da compra.</span></div>
          <div className="kv"><span className="kk">Caixa</span><span className="vv" style={{textAlign:"right",maxWidth:"60%"}}>O mês em que o dinheiro de fato saiu ou entrou.</span></div>
          <div className="kv"><span className="kk">Provento</span><span className="vv" style={{textAlign:"right",maxWidth:"60%"}}>Ganho recebido por causa de um investimento (dividendo, juro, rendimento).</span></div>
          <div className="kv"><span className="kk">Aporte</span><span className="vv" style={{textAlign:"right",maxWidth:"60%"}}>Dinheiro que você coloca num investimento.</span></div>
          <div className="kv"><span className="kk">Rendimento</span><span className="vv" style={{textAlign:"right",maxWidth:"60%"}}>A diferença entre o valor atual de um ativo e o que foi aportado nele.</span></div>
          <div className="kv"><span className="kk">Patrimônio</span><span className="vv" style={{textAlign:"right",maxWidth:"60%"}}>Saldo das contas (sem cartão) somado ao valor atual da carteira de investimentos.</span></div>
          <div className="kv"><span className="kk">Independência financeira</span><span className="vv" style={{textAlign:"right",maxWidth:"60%"}}>Quanto os proventos médios cobririam dos gastos médios, se você parasse de trabalhar.</span></div>
        </div>
      </div>
    </div>
  );
}
Ajuda = React.memo(Ajuda);

export { DEMO_DATA, DEMO_ACCOUNTS, DEMO_ACCT_NAME, DEMO_BY_CAT, DEMO_BUDGET_ROWS, DEMO_PATRIMONIO, DEMO_BY_CLASS, HelpExample, SwipeDiagram, BottomNavDiagram, HELP_SECTIONS, HelpSection, DemoTxForm, Ajuda };
