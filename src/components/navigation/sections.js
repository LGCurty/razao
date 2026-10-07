/* components/navigation/sections.js — seções (barra inferior do celular) e grupos do menu lateral. */
/* SEÇÕES: as 5 da barra inferior do celular. Cada uma agrupa uma ou mais telas, trocadas pelo seletor no
   topo da seção. As chaves das telas ("geral", "balanco"…) são as mesmas em todo o app, então goToTab()/
   openHelp() e os links internos seguem funcionando. */
const NAV_SECTIONS = [
  { key:"home", label:"Home", icon:"casa", views:[["geral","Resumo"],["panorama","Panorama"],["perguntar","Assistente"]] },
  { key:"gastos", label:"Gastos", icon:"calendario", views:[["balanco","Lançamentos"],["extrato","Importar do banco"]] },
  { key:"orcamento", label:"Orçamento", icon:"orcamento", views:[["orcamento","Orçamento"]] },
  { key:"investimentos", label:"Investimentos", icon:"investimentos", views:[["investimentos","Carteira"],["metas","Metas"]] },
  { key:"config", label:"Configurações", icon:"config", views:[["contas","Contas e bancos"],["preferencias","Preferências"],["ajuda","Ajuda"]] },
];
const sectionOfView = (v)=>NAV_SECTIONS.find(sec=>sec.views.some(([k])=>k===v))||NAV_SECTIONS[0];

/* GRUPOS do menu lateral (inspirado no OTAMERICA Sentinel): no celular abre pelo botão ☰ do topo; no
   computador fica fixo à esquerda. Cada item leva a uma tela (view), opcionalmente com um filtro, ou
   dispara uma ação (action). "count" diz qual contador mostrar ao lado e "tone" a cor dele. */
const NAV_GROUPS = [
  { label:"Painel", items:[
    { view:"geral", label:"Home", icon:"casa" },
    { view:"panorama", label:"Panorama", icon:"grafico" },
  ]},
  { label:"Movimentos", items:[
    { view:"balanco", label:"Lançamentos", icon:"calendario", count:"movimentos" },
    { view:"extrato", label:"Importar do banco", icon:"enviar" },
  ]},
  { label:"Orçamento", items:[
    { view:"orcamento", label:"Orçamento do mês", icon:"orcamento", filtro:null },
    { view:"orcamento", label:"Dentro do limite", icon:"check", filtro:"ok", count:"orcOk", tone:"ok" },
    { view:"orcamento", label:"Atenção", icon:"alerta", filtro:"warn", count:"orcWarn", tone:"warn" },
    { view:"orcamento", label:"Estourados", icon:"x-circulo", filtro:"over", count:"orcOver", tone:"over" },
  ]},
  { label:"Investimentos", items:[
    { view:"investimentos", label:"Carteira", icon:"investimentos", count:"ativos" },
    { view:"metas", label:"Metas", icon:"metas", count:"metas" },
  ]},
  { label:"Ferramentas", items:[
    { action:"novo", label:"Novo movimento", icon:"adicionar" },
    { view:"perguntar", label:"Assistente IA", icon:"assistente" },
    { view:"ajuda", label:"Manual do usuário", icon:"livro" },
  ]},
  { label:"Configurações", items:[
    { view:"contas", label:"Contas e bancos", icon:"banco", count:"bancosErro", tone:"over" },
    { view:"preferencias", label:"Preferências", icon:"config" },
  ]},
];

// título de cada tela, para o cabeçalho
const VIEW_TITLES = {
  geral:"Home", panorama:"Panorama", balanco:"Lançamentos", extrato:"Importar do banco", orcamento:"Orçamento",
  investimentos:"Carteira", metas:"Metas", perguntar:"Assistente IA", contas:"Contas e bancos",
  preferencias:"Preferências", ajuda:"Manual do usuário",
};

export { NAV_SECTIONS, sectionOfView, NAV_GROUPS, VIEW_TITLES };
